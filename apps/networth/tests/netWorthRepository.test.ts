import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EncryptingRepository,
  InMemoryRepository,
  type EncryptedRepository,
} from '@platform/data';
import { PortableRecordCipher } from '@platform/security';
import {
  ASSETS,
  LIABILITIES,
  listAssets,
  listLiabilities,
  saveAsset,
  saveLiability,
} from '../src/data/netWorthRepository';
import { computeNetWorth } from '../src/domain/assets';

/**
 * Net Worth over the real persistence path.
 *
 * The point of these is not that a list round-trips — `EncryptingRepository`
 * already has tests for that. It is that this application's own data access
 * goes through the encryption boundary, so a name and a value written by a user
 * are ciphertext by the time they reach whatever is storing them. The in-memory
 * store here stands exactly where `FirebaseRepository` stands in production, and
 * is inspected directly to prove what it received.
 */
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));
const DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 13 + 7) % 256);
const NOW = 1_700_000_000_000;

function harness(dataKey: () => Promise<Uint8Array | null> = async () => DEK) {
  const store = new InMemoryRepository();
  const repository: EncryptedRepository = new EncryptingRepository({
    inner: store,
    cipher: new PortableRecordCipher(randomBytes),
    dataKey,
    userId: 'alice-uid',
    appName: 'Net Worth',
  });
  return { store, repository };
}

describe('reading and writing net worth records', () => {
  it('writes an asset and reads it back as a domain object', async () => {
    const { repository } = harness();
    const saved = await saveAsset(
      repository,
      { name: 'Savings account', category: 'cash', value: 240000, includeInNetWorth: true },
      NOW,
    );
    expect(saved.id).toHaveLength(20);
    expect(await listAssets(repository)).toEqual([saved]);
  });

  it('carries a portfolio through to the net-worth calculation', async () => {
    const { repository } = harness();
    await saveAsset(
      repository,
      { name: 'Flat', category: 'property', value: 7_200_000, includeInNetWorth: true },
      NOW,
    );
    await saveLiability(
      repository,
      { name: 'Home loan', category: 'homeLoan', outstanding: 4_100_000 },
      NOW,
    );
    const net = computeNetWorth(await listAssets(repository), await listLiabilities(repository));
    expect(net.net).toBe(3_100_000);
  });

  it('advances the revision on an update rather than resetting it', async () => {
    // The Security Rules check that a revision moves forward by exactly one; a
    // write that reset it would be refused on the server and only there.
    const { store, repository } = harness();
    const saved = await saveAsset(
      repository,
      { name: 'Index fund', category: 'mutualFunds', value: 100, includeInNetWorth: true },
      NOW,
    );
    await saveAsset(repository, { ...saved, value: 200 }, NOW + 1000);
    const stored = await store.get(ASSETS, saved.id);
    expect(stored?.revision).toBe(2);
    expect((await listAssets(repository))[0]?.value).toBe(200);
  });

  it('hides tombstoned records from the dashboard', async () => {
    const { repository, store } = harness();
    const saved = await saveAsset(
      repository,
      { name: 'Sold car', category: 'other', value: 1, includeInNetWorth: true },
      NOW,
    );
    await store.delete(ASSETS, saved.id, NOW + 1);
    expect(await listAssets(repository)).toEqual([]);
  });
});

describe('what the store underneath actually receives', () => {
  it('never sees a plaintext domain field', async () => {
    const { store, repository } = harness();
    await saveAsset(
      repository,
      { name: 'Sovereign gold bonds', category: 'gold', value: 310000, includeInNetWorth: true },
      NOW,
    );
    await saveLiability(
      repository,
      { name: 'Card outstanding', category: 'creditCard', outstanding: 48000 },
      NOW,
    );

    for (const collection of [ASSETS, LIABILITIES]) {
      const stored = await store.list(collection);
      expect(stored).toHaveLength(1);
      const document = stored[0] as Record<string, unknown>;
      // Exactly the fields the Security Rules allow, and nothing else.
      expect(Object.keys(document).sort()).toEqual(['deletedAt', 'enc', 'id', 'revision', 'updatedAt']);
      const serialised = JSON.stringify(document);
      for (const secret of ['Sovereign gold bonds', 'gold', '310000', 'Card outstanding', '48000']) {
        expect(serialised).not.toContain(secret);
      }
    }
  });

  it('produces an envelope of exactly the shape firestore.rules requires', async () => {
    const { store, repository } = harness();
    const saved = await saveAsset(
      repository,
      { name: 'EPF', category: 'retirement', value: 940000, includeInNetWorth: true },
      NOW,
    );
    const stored = (await store.get(ASSETS, saved.id)) as unknown as {
      enc: Record<string, unknown>;
    };
    expect(Object.keys(stored.enc).sort()).toEqual(['alg', 'ct', 'iv', 'v']);
    expect(stored.enc.v).toBe(1);
    expect(stored.enc.alg).toBe('AES-GCM');
  });

  it('fails closed when the data key is unavailable, and writes nothing', async () => {
    // A keystore invalidated between two operations is the case Gate 2 exists
    // for. There is no branch that stores the record in the clear instead.
    const { store, repository } = harness(async () => null);
    await expect(
      saveAsset(
        repository,
        { name: 'Emergency fund', category: 'deposits', value: 500000, includeInNetWorth: true },
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'DATA_KEY_UNAVAILABLE' });
    expect(await store.list(ASSETS)).toEqual([]);
  });

  it('fails the whole read rather than hiding a record it cannot open', async () => {
    const { store, repository } = harness();
    await saveAsset(
      repository,
      { name: 'Direct equity', category: 'equity', value: 620000, includeInNetWorth: true },
      NOW,
    );
    // Something else wrote a document without an envelope — the shape a
    // plaintext write would leave behind.
    await store.put(ASSETS, { id: 'foreign', updatedAt: NOW, revision: 1, deletedAt: null });
    await expect(listAssets(repository)).rejects.toMatchObject({
      code: 'RECORD_NOT_ENCRYPTED',
    });
  });
});
