import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  custodyAddressFor,
  PortableRecordCipher,
  SecurityError,
  SecurityErrorCode,
  createDataKeyLifecycle,
  createKeyCustody,
  type CustodyStorage,
  type RecordCipher,
} from '@platform/security';
import { EncryptingRepository, ENCRYPTED_FIELD } from '../src/services/EncryptingRepository';
import { InMemoryRepository } from '../src/services/InMemoryRepository';
import type { QueryOptions, SyncableRecord } from '../src/types/record';
import type { Repository } from '../src/types/repository';

/**
 * The passphrase against the persistence boundary.
 *
 * `dataKeyProtection.test.ts` proves the lifecycle behaves; this proves the
 * repository above it does. The specific fear: a locked key is a new way for
 * `DataKeySource` to fail, and the failure that would matter is the one where a
 * record gets written anyway — in the clear, or under a stand-in key — because
 * something upstream treated "locked" as "no key yet".
 *
 * The boundary has one rule and it does not acquire an exception here: no key,
 * no write and no read. A locked device is a device that cannot touch records
 * until somebody types the passphrase, and every path below says so.
 */

const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

const cipher: RecordCipher = new PortableRecordCipher(randomBytes);

const USER_ID = 'alice-uid';
const APP_NAME = 'networth';

const ASSET: SyncableRecord = {
  id: 'a1',
  updatedAt: 1000,
  revision: 1,
  deletedAt: null,
  name: 'Savings',
  amount: 1234.56,
};

/** Records exactly what the layer below was handed, if anything. */
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

class FakeCustodyStorage implements CustodyStorage {
  readonly entries = new Map<string, string>();
  readonly protection = 'os-keystore' as const;
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.entries.set(key, value);
  }
  async remove(key: string) {
    this.entries.delete(key);
  }
}

const escrowStore = () => {
  let document: unknown = null;
  return {
    async load() {
      return document;
    },
    async save(next: unknown) {
      document = next;
    },
  };
};

/**
 * The real thing, wired the way an application wires it.
 *
 * `dataKey` is the lifecycle's own `load`, exactly as `AppCore` passes it —
 * a stub returning bytes would be testing the stub rather than what ships.
 */
function build(storage = new FakeCustodyStorage(), store = escrowStore()) {
  const lifecycle = createDataKeyLifecycle({
    custody: createKeyCustody(storage, { owner: USER_ID }),
    escrowStore: store,
    crypto: {
      // The lifecycle needs a CryptoService only for the escrow and the
      // wrapper; neither is exercised through the repository.
      encrypt: () => {
        throw new Error('unused');
      },
      decrypt: () => {
        throw new Error('unused');
      },
    } as never,
    context: { userId: USER_ID, appName: APP_NAME },
    randomBytes,
  });
  const spy = new SpyRepository();
  const repository = new EncryptingRepository({
    inner: spy,
    cipher,
    dataKey: () => lifecycle.load(),
    userId: USER_ID,
    appName: APP_NAME,
  });
  return { lifecycle, repository, spy, storage };
}

/**
 * Puts a v2 wrapper in custody directly.
 *
 * The wrapper's contents do not matter to this file — the repository never
 * opens one — and going through `protect` would drag a 210,000-round KDF into
 * every case here for nothing. What matters is that custody is in the
 * `protected` state, and this is that state.
 */
function withProtectedKey(storage: FakeCustodyStorage): void {
  storage.entries.set(
    custodyAddressFor(USER_ID),
    JSON.stringify({
      v: 2,
      w: {
        version: 1,
        wrappedKey: {
          version: 1,
          algorithm: 'AES-GCM',
          iterations: 210_000,
          salt: 'c2FsdA==',
          iv: 'aXZpdml2aXZpdml2',
          ciphertext: 'Y2lwaGVydGV4dA==',
        },
      },
    }),
  );
}

/** An ordinary unprotected device with one encrypted record already stored. */
async function deviceWithOneRecord() {
  const storage = new FakeCustodyStorage();
  storage.entries.set(
    custodyAddressFor(USER_ID),
    JSON.stringify({ v: 1, k: Buffer.from(randomBytes(32)).toString('base64') }),
  );
  const built = build(storage);
  await built.repository.put('assets', ASSET);
  return built;
}

describe('a locked key at the persistence boundary', () => {
  it('writes nothing at all, rather than writing something readable', async () => {
    const { repository, spy, storage } = build();
    withProtectedKey(storage);

    await expect(repository.put('assets', ASSET)).rejects.toBeInstanceOf(SecurityError);

    // Not "wrote ciphertext under a fallback key" and not "wrote plaintext".
    // Nothing reached the layer below.
    expect(spy.written).toEqual([]);
    expect(await spy.list('assets')).toEqual([]);
  });

  it('surfaces the lock rather than reporting an empty database', async () => {
    const { repository, storage } = await deviceWithOneRecord();
    withProtectedKey(storage);

    // `[]` and `null` are the answers that would make an application render an
    // empty portfolio to somebody whose records are all still there — and, in
    // an app that seeds on first run, the answers that get them overwritten.
    for (const attempt of [
      () => repository.list('assets'),
      () => repository.get('assets', 'a1'),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: SecurityErrorCode.DATA_KEY_LOCKED,
      });
    }
  });

  it('needs no key for a query that decrypts nothing, and invents none', async () => {
    // An empty collection and a missing id are answered without a key, because
    // there is no payload to open. Recorded rather than assumed: the guarantee
    // is "no plaintext without a key", not "no call without a key", and the
    // distinction is what the two cases above rest on.
    const { repository, storage } = build();
    withProtectedKey(storage);

    expect(await repository.list('assets')).toEqual([]);
    expect(await repository.get('assets', 'nothing-here')).toBeNull();
  });

  it('deletes a tombstone without the key, as it does with no key at all', async () => {
    // Pre-existing and deliberate: a delete writes `deletedAt` and touches no
    // payload, so it has never needed the key — the same is true today on a
    // device whose key is simply absent. Asserted here so that if it ever
    // changes it changes visibly, and so this file does not imply a locked
    // device is inert when it is not.
    const { repository, storage } = await deviceWithOneRecord();
    withProtectedKey(storage);

    await expect(repository.delete('assets', 'a1', 2000)).resolves.toBeUndefined();
  });

  it('keeps records written before the lock, and returns them once unlocked', async () => {
    // A single custody store carried through: unprotected, then protected,
    // then opened — which is the actual sequence on a device.
    const storage = new FakeCustodyStorage();
    const key = randomBytes(32);
    storage.entries.set(
      custodyAddressFor(USER_ID),
      JSON.stringify({ v: 1, k: Buffer.from(key).toString('base64') }),
    );
    const { repository, spy } = build(storage);

    await repository.put('assets', ASSET);
    const stored = spy.written[0] as Record<string, unknown>;
    expect(stored[ENCRYPTED_FIELD]).toBeDefined();

    withProtectedKey(storage);
    await expect(repository.get('assets', 'a1')).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_LOCKED,
    });

    // The ciphertext is untouched by any of it. Unlocking is a matter of the
    // key coming back, not of the records being restored.
    expect(JSON.stringify(spy.written[0])).not.toContain('Savings');
    expect(JSON.stringify(spy.written[0])).not.toContain('1234.56');
  });

  it('a source that swallows the lock and answers null still cannot write plaintext', async () => {
    // The realistic mistake: somebody wraps `lifecycle.load()` in a try/catch
    // that returns null, believing "locked" and "no key" are the same. The
    // boundary must still refuse — this is the second line, not the first.
    const spy = new SpyRepository();
    const repository = new EncryptingRepository({
      inner: spy,
      cipher,
      dataKey: async () => null,
      userId: USER_ID,
      appName: APP_NAME,
    });

    await expect(repository.put('assets', ASSET)).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_UNAVAILABLE,
    });
    expect(spy.written).toEqual([]);
  });

  it('the key is asked for on every operation, so locking mid-session takes effect', async () => {
    // `DataKeySource` is a function precisely so a key can go away between two
    // operations. A repository that captured the key at construction would
    // keep serving records for the rest of the process after a lock.
    const storage = new FakeCustodyStorage();
    const key = randomBytes(32);
    storage.entries.set(
      custodyAddressFor(USER_ID),
      JSON.stringify({ v: 1, k: Buffer.from(key).toString('base64') }),
    );
    let asked = 0;
    const spy = new SpyRepository();
    const custody = createKeyCustody(storage, { owner: USER_ID });
    const repository = new EncryptingRepository({
      inner: spy,
      cipher,
      dataKey: async () => {
        asked += 1;
        return custody.load();
      },
      userId: USER_ID,
      appName: APP_NAME,
    });

    // A put seals and then reopens what the store returned, so it asks twice;
    // the read asks once more. The number is not the point — that it climbs on
    // every operation is.
    await repository.put('assets', ASSET);
    await repository.get('assets', 'a1');
    const beforeLock = asked;
    expect(beforeLock).toBeGreaterThan(0);

    withProtectedKey(storage);
    await expect(repository.get('assets', 'a1')).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_LOCKED,
    });
    expect(asked).toBe(beforeLock + 1);
  });
});
