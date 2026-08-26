import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PortableRecordCipher,
  SecurityErrorCode,
  type RecordCipher,
} from '@platform/security';
import {
  EncryptingRepository,
  ENCRYPTED_FIELD,
  type DataKeySource,
} from '../src/services/EncryptingRepository';
import { InMemoryRepository } from '../src/services/InMemoryRepository';
import type { QueryOptions, SyncableRecord } from '../src/types/record';
import type { Repository } from '../src/types/repository';

/**
 * The persistence boundary.
 *
 * `recordCrypto.test.ts` proves the cryptography. What is at stake here is
 * whether a plaintext domain field can reach a repository call at all, and what
 * happens on every path where the key or the envelope is not what it should be.
 */

const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

const cipher: RecordCipher = new PortableRecordCipher(randomBytes);
const DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 256);
const OTHER_DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);

const ASSET: SyncableRecord = {
  id: 'a1',
  updatedAt: 1000,
  revision: 1,
  deletedAt: null,
  name: 'Savings',
  amount: 1234.56,
};

/** Records exactly what the layer below was handed. */
class SpyRepository implements Repository {
  readonly inner = new InMemoryRepository();
  readonly written: SyncableRecord[] = [];

  async get(collection: string, id: string) {
    return this.inner.get(collection, id);
  }
  async list(collection: string, options?: QueryOptions) {
    return this.inner.list(collection, options);
  }
  async put(collection: string, record: SyncableRecord) {
    this.written.push(record);
    return this.inner.put(collection, record);
  }
  async delete(collection: string, id: string, deletedAt: number) {
    return this.inner.delete(collection, id, deletedAt);
  }
  async purgeAll() {
    return this.inner.purgeAll();
  }
}

function build(dataKey: DataKeySource = async () => DEK) {
  const spy = new SpyRepository();
  const repository = new EncryptingRepository({
    inner: spy,
    cipher,
    dataKey,
    userId: 'alice-uid',
    appName: 'networth',
  });
  return { repository, spy };
}

describe('what crosses the persistence boundary', () => {
  it('hands the layer below ciphertext and sync metadata, nothing else', async () => {
    const { repository, spy } = build();
    await repository.put('assets', ASSET);

    expect(spy.written).toHaveLength(1);
    const stored = spy.written[0] as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(
      ['deletedAt', 'id', 'revision', 'updatedAt', ENCRYPTED_FIELD].sort(),
    );
    // The metadata the rules and queries read is intact and clear.
    expect(stored.id).toBe('a1');
    expect(stored.revision).toBe(1);
    expect(stored.updatedAt).toBe(1000);
    expect(stored.deletedAt).toBeNull();
  });

  it('lets no domain field or value through in any form', async () => {
    const { repository, spy } = build();
    await repository.put('assets', ASSET);

    const serialised = JSON.stringify(spy.written[0]);
    expect(serialised).not.toContain('Savings');
    expect(serialised).not.toContain('1234.56');
    expect(serialised).not.toContain('name');
    expect(serialised).not.toContain('amount');
  });

  it('round-trips the record back through decryption', async () => {
    const { repository } = build();
    await repository.put('assets', ASSET);
    expect(await repository.get('assets', 'a1')).toEqual(ASSET);
  });

  it('handles many records independently', async () => {
    const { repository } = build();
    const records = ['a1', 'a2', 'a3'].map((id, i) => ({
      ...ASSET, id, name: `Account ${i}`, amount: i * 100,
    }));
    for (const record of records) await repository.put('assets', record);

    for (const record of records) {
      expect(await repository.get('assets', record.id)).toEqual(record);
    }
    const listed = await repository.list('assets');
    expect(listed).toHaveLength(3);
    expect(listed.map((r) => r.name).sort()).toEqual(['Account 0', 'Account 1', 'Account 2']);
  });

  it('returns null for a record that is not there, without touching a key', async () => {
    let asked = 0;
    const { repository } = build(async () => {
      asked += 1;
      return DEK;
    });
    expect(await repository.get('assets', 'missing')).toBeNull();
    expect(asked).toBe(0);
  });
});

describe('failing closed', () => {
  it('refuses to write or read when there is no key', async () => {
    const { repository, spy } = build(async () => null);
    await expect(repository.put('assets', ASSET)).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_UNAVAILABLE,
    });
    // Nothing reached the layer below.
    expect(spy.written).toHaveLength(0);
  });

  it('refuses to read when custody has become unusable', async () => {
    // Written while the key was available; the key is then gone.
    const spy = new SpyRepository();
    let key: Uint8Array | null = DEK;
    const repository = new EncryptingRepository({
      inner: spy, cipher, dataKey: async () => key,
      userId: 'alice-uid', appName: 'networth',
    });
    await repository.put('assets', ASSET);

    key = null;
    await expect(repository.get('assets', 'a1')).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_UNAVAILABLE,
    });
  });

  it('propagates a custody read that throws rather than treating it as absence', async () => {
    const { repository } = build(async () => {
      throw new Error('keystore key invalidated');
    });
    await expect(repository.get('assets', 'a1')).resolves.toBeNull();
    await expect(repository.put('assets', ASSET)).rejects.toThrow();
  });

  it('refuses a stored record that carries no envelope', async () => {
    // The silent-plaintext-fallback case, stated as a test: a document with
    // domain fields and no `enc` is never handed back as if it were the
    // user's data.
    const spy = new SpyRepository();
    await spy.put('assets', ASSET);
    const repository = new EncryptingRepository({
      inner: spy, cipher, dataKey: async () => DEK,
      userId: 'alice-uid', appName: 'networth',
    });
    await expect(repository.get('assets', 'a1')).rejects.toMatchObject({
      code: SecurityErrorCode.RECORD_NOT_ENCRYPTED,
    });
    await expect(repository.list('assets')).rejects.toMatchObject({
      code: SecurityErrorCode.RECORD_NOT_ENCRYPTED,
    });
  });

  it('refuses a record written under a different key', async () => {
    const spy = new SpyRepository();
    const mine = new EncryptingRepository({
      inner: spy, cipher, dataKey: async () => DEK,
      userId: 'alice-uid', appName: 'networth',
    });
    await mine.put('assets', ASSET);

    const theirs = new EncryptingRepository({
      inner: spy, cipher, dataKey: async () => OTHER_DEK,
      userId: 'alice-uid', appName: 'networth',
    });
    await expect(theirs.get('assets', 'a1')).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
  });

  it('refuses a record moved between users, applications or collections', async () => {
    const spy = new SpyRepository();
    const mine = new EncryptingRepository({
      inner: spy, cipher, dataKey: async () => DEK,
      userId: 'alice-uid', appName: 'networth',
    });
    await mine.put('assets', ASSET);
    const stored = spy.written[0]!;

    const wrong = [
      { userId: 'bob-uid', appName: 'networth', collection: 'assets' },
      { userId: 'alice-uid', appName: 'expense', collection: 'assets' },
      { userId: 'alice-uid', appName: 'networth', collection: 'liabilities' },
    ];
    for (const { userId, appName, collection } of wrong) {
      const other = new SpyRepository();
      await other.put(collection, stored);
      const repository = new EncryptingRepository({
        inner: other, cipher, dataKey: async () => DEK, userId, appName,
      });
      await expect(
        repository.get(collection, 'a1'),
        `${userId}/${appName}/${collection}`,
      ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
    }
  });

  it('refuses a record whose id no longer matches its ciphertext', async () => {
    const spy = new SpyRepository();
    const repository = new EncryptingRepository({
      inner: spy, cipher, dataKey: async () => DEK,
      userId: 'alice-uid', appName: 'networth',
    });
    await repository.put('assets', ASSET);
    // Copy the sealed payload onto a different document id.
    await spy.put('assets', { ...spy.written[0]!, id: 'a2' });

    await expect(repository.get('assets', 'a2')).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
  });

  it('fails the whole list when one record cannot be opened', async () => {
    // Not a silent drop: a tampered record must not look like a deleted one.
    const spy = new SpyRepository();
    const repository = new EncryptingRepository({
      inner: spy, cipher, dataKey: async () => DEK,
      userId: 'alice-uid', appName: 'networth',
    });
    await repository.put('assets', ASSET);
    await repository.put('assets', { ...ASSET, id: 'a2' });

    const sealed = spy.written[1] as unknown as Record<string, { ct: string }>;
    const envelope = sealed[ENCRYPTED_FIELD]!;
    await spy.put('assets', {
      ...(sealed as unknown as SyncableRecord),
      [ENCRYPTED_FIELD]: { ...envelope, ct: (envelope.ct[0] === 'A' ? 'B' : 'A') + envelope.ct.slice(1) },
    } as SyncableRecord);

    await expect(repository.list('assets')).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
  });
});

describe('operations that touch no payload', () => {
  it('passes a tombstone and a purge straight through', async () => {
    const { repository, spy } = build();
    await repository.put('assets', ASSET);
    await repository.delete('assets', 'a1', 2000);

    const stored = await spy.get('assets', 'a1');
    expect(stored?.deletedAt).toBe(2000);
    // Still sealed; deleting never decrypted anything.
    expect(stored).toHaveProperty(ENCRYPTED_FIELD);

    await repository.purgeAll();
    expect(await spy.get('assets', 'a1')).toBeNull();
  });
});
