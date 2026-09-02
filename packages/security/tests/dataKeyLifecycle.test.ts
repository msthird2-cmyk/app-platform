import { webcrypto } from 'node:crypto';
import { custodyAddressFor } from '../src/custodyAddress';
import { describe, expect, it } from 'vitest';
import { toBase64 } from '../src/crypto/base64';
import {
  createDataKeyLifecycle,
  type DataKeyLifecycle,
  type RecoveryEscrowStore,
} from '../src/dataKeyLifecycle';
import { SecurityErrorCode } from '../src/errors';
import { createKeyCustody, type CustodyStorage } from '../src/keyCustody';
import { MIN_KDF_ITERATIONS } from '../src/kdfPolicy';
import type { ProtectionTier } from '../src/protectionTier';
import { normalizeRecoveryCode } from '../src/recoveryCodes';
import type { RecoveryEscrowDocument } from '../src/recoveryEscrow';
import { WebCryptoService } from '../src/services/WebCryptoService';
import type { EncryptionContext } from '../src/types/crypto';


const TEST_OWNER = 'alice-uid';
/**
 * The lifecycle, not the primitives.
 *
 * `recoveryEscrow.test.ts` proves the cryptography. What is at stake here is
 * sequencing: that a key is created exactly once, that a restart does not make
 * a second one, that every failed recovery leaves custody exactly as it was,
 * and that an unreadable key never becomes an excuse to mint a replacement.
 */

const crypto = new WebCryptoService(MIN_KDF_ITERATIONS);
const CONTEXT: EncryptionContext = { userId: 'alice-uid', appName: 'networth' };
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

/** Gate 2 custody storage, with hooks for the failure cases. */
class FakeCustodyStorage implements CustodyStorage {
  readonly entries = new Map<string, string>();
  failGet: Error | null = null;
  constructor(readonly protection: ProtectionTier = 'os-keystore') {}
  async get(key: string) {
    if (this.failGet) throw this.failGet;
    return this.entries.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.entries.set(key, value);
  }
  async remove(key: string) {
    this.entries.delete(key);
  }
}

/** Stands in for Firestore. Records what was written, and how often. */
class FakeEscrowStore implements RecoveryEscrowStore {
  document: RecoveryEscrowDocument | null = null;
  saves = 0;
  loads = 0;
  failLoad: Error | null = null;

  async load(): Promise<unknown | null> {
    this.loads += 1;
    if (this.failLoad) throw this.failLoad;
    return this.document === null ? null : { ...this.document, createdAt: 1, updatedAt: 2 };
  }
  async save(document: RecoveryEscrowDocument): Promise<void> {
    this.saves += 1;
    this.document = document;
  }
}

interface Harness {
  lifecycle: DataKeyLifecycle;
  custodyStorage: FakeCustodyStorage;
  escrowStore: FakeEscrowStore;
}

function harness(
  custodyStorage = new FakeCustodyStorage(),
  escrowStore = new FakeEscrowStore(),
): Harness {
  const custody = createKeyCustody(custodyStorage, { owner: TEST_OWNER });
  return {
    lifecycle: createDataKeyLifecycle({
      custody,
      escrowStore,
      crypto,
      context: CONTEXT,
      randomBytes,
    }),
    custodyStorage,
    escrowStore,
  };
}

async function bytes(lifecycle: DataKeyLifecycle): Promise<number[]> {
  const key = await lifecycle.load();
  return key === null ? [] : Array.from(key);
}

describe('A — first-time setup', () => {
  it('generates a key, escrows it, and takes custody', async () => {
    const { lifecycle, custodyStorage, escrowStore } = harness();
    expect(await lifecycle.status()).toBe('needs-setup');

    const { recoveryCode } = await lifecycle.initialize();

    expect(await lifecycle.status()).toBe('ready');
    const key = await lifecycle.load();
    expect(key).not.toBeNull();
    expect((key as Uint8Array).length).toBe(32);

    // Custody holds it, and holds exactly one thing.
    expect([...custodyStorage.entries.keys()]).toEqual([custodyAddressFor(TEST_OWNER)]);
    // Firestore holds one escrow.
    expect(escrowStore.saves).toBe(1);
    expect(escrowStore.document).not.toBeNull();

    // The code is a real one, shown once.
    expect(normalizeRecoveryCode(recoveryCode)).toBe(recoveryCode);
  });

  it('puts neither the key nor the code in the escrow document', async () => {
    const { lifecycle, escrowStore } = harness();
    const { recoveryCode } = await lifecycle.initialize();
    const key = (await lifecycle.load()) as Uint8Array;

    const stored = JSON.stringify(escrowStore.document);
    expect(stored).not.toContain(toBase64(key));
    expect(stored).not.toContain(recoveryCode);
    expect(stored).not.toContain(recoveryCode.replace(/-/g, ''));

    // Only the agreed fields — no verifier, no hint, no hash.
    expect(Object.keys(escrowStore.document as object).sort()).toEqual([
      'algorithm', 'id', 'iterations', 'iv', 'kdf', 'salt', 'version', 'wrappedKey',
    ]);
  });

  it('draws a different key and code for every user', async () => {
    const first = harness();
    const second = harness();
    const a = await first.lifecycle.initialize();
    const b = await second.lifecycle.initialize();
    expect(a.recoveryCode).not.toBe(b.recoveryCode);
    expect(await bytes(first.lifecycle)).not.toEqual(await bytes(second.lifecycle));
  });

  it('writes the escrow before taking custody, so a crash is recoverable', async () => {
    // If custody fails after the escrow is stored, the next startup reports
    // needs-recovery and the code the user was just shown still works. The
    // other order would leave a working key with no way back, permanently.
    const custodyStorage = new FakeCustodyStorage();
    custodyStorage.set = async () => {
      throw new Error('keystore write failed');
    };
    const { lifecycle, escrowStore } = harness(custodyStorage);

    await expect(lifecycle.initialize()).rejects.toThrow();
    expect(escrowStore.saves).toBe(1);
    expect(await lifecycle.status()).toBe('needs-recovery');
  });
});

describe('B — restart', () => {
  it('loads the same key and creates nothing new', async () => {
    const custodyStorage = new FakeCustodyStorage();
    const escrowStore = new FakeEscrowStore();

    const first = harness(custodyStorage, escrowStore);
    await first.lifecycle.initialize();
    const original = await bytes(first.lifecycle);
    expect(original.length).toBe(32);

    // A restart is a new lifecycle over the storage that survived the process.
    const { lifecycle: restarted } = harness(custodyStorage, escrowStore);

    expect(await restarted.status()).toBe('ready');
    expect(await bytes(restarted)).toEqual(original);
    // No second key, and no second escrow.
    expect(escrowStore.saves).toBe(1);
    expect([...custodyStorage.entries.keys()]).toEqual([custodyAddressFor(TEST_OWNER)]);
  });

  it('does not read the escrow at all when a key is already held', async () => {
    // Startup on a healthy device must not depend on the network, and must
    // not touch the escrow it has no reason to look at.
    const custodyStorage = new FakeCustodyStorage();
    const escrowStore = new FakeEscrowStore();
    await harness(custodyStorage, escrowStore).lifecycle.initialize();

    const loadsAfterSetup = escrowStore.loads;
    const { lifecycle: restarted } = harness(custodyStorage, escrowStore);
    expect(await restarted.status()).toBe('ready');
    await restarted.load();
    expect(escrowStore.loads).toBe(loadsAfterSetup);
  });
});

describe('G — an existing key is never replaced', () => {
  it('refuses first-time setup when a key is already held', async () => {
    const { lifecycle, escrowStore } = harness();
    await lifecycle.initialize();
    const original = await bytes(lifecycle);

    await expect(lifecycle.initialize()).rejects.toMatchObject({
      code: SecurityErrorCode.KEY_CUSTODY_INVALID,
    });
    expect(await bytes(lifecycle)).toEqual(original);
    expect(escrowStore.saves).toBe(1);
  });

  it('refuses first-time setup when the stored key is unreadable', async () => {
    // The case that destroys data if it is mistaken for "no key yet".
    const custodyStorage = new FakeCustodyStorage();
    custodyStorage.entries.set(custodyAddressFor(TEST_OWNER), 'not json');
    const { lifecycle, escrowStore } = harness(custodyStorage);

    expect(await lifecycle.status()).toBe('unusable');
    await expect(lifecycle.initialize()).rejects.toMatchObject({
      code: SecurityErrorCode.KEY_CUSTODY_INVALID,
    });
    expect(escrowStore.saves).toBe(0);
    expect(custodyStorage.entries.get(custodyAddressFor(TEST_OWNER))).toBe('not json');
  });

  it('refuses first-time setup when the escrow cannot be read', async () => {
    // Unreachable is not absent. Offering setup here mints a second key for a
    // user who already has one.
    const { lifecycle, escrowStore } = harness();
    escrowStore.failLoad = new Error('offline');

    expect(await lifecycle.status()).toBe('unusable');
    await expect(lifecycle.initialize()).rejects.toThrow();
    expect(escrowStore.saves).toBe(0);
  });
});

describe('C — recovery', () => {
  async function setUpThenLoseTheDevice() {
    const { lifecycle, custodyStorage, escrowStore } = harness();
    const { recoveryCode } = await lifecycle.initialize();
    const original = await bytes(lifecycle);

    // Every trusted device is gone; the escrow in Firestore is not.
    custodyStorage.entries.clear();
    expect(await lifecycle.status()).toBe('needs-recovery');
    return { lifecycle, custodyStorage, escrowStore, recoveryCode, original };
  }

  it('restores the original key from the code alone', async () => {
    const { lifecycle, custodyStorage, recoveryCode, original } =
      await setUpThenLoseTheDevice();

    const recovered = await lifecycle.recover(recoveryCode);

    expect(Array.from(recovered)).toEqual(original);
    expect(await lifecycle.status()).toBe('ready');
    expect(await bytes(lifecycle)).toEqual(original);
    // Through Gate 2 custody, and nowhere else.
    expect([...custodyStorage.entries.keys()]).toEqual([custodyAddressFor(TEST_OWNER)]);
  });

  it('accepts the code as the user retypes it', async () => {
    const { lifecycle, recoveryCode, original } = await setUpThenLoseTheDevice();
    const typed = recoveryCode.toLowerCase().replace(/-/g, ' ');
    expect(Array.from(await lifecycle.recover(typed))).toEqual(original);
  });

  it('is idempotent, and then refuses to run over a usable key', async () => {
    const { lifecycle, custodyStorage, recoveryCode, original } =
      await setUpThenLoseTheDevice();

    await lifecycle.recover(recoveryCode);
    // Recovering again while the key is held is not recovery.
    await expect(lifecycle.recover(recoveryCode)).rejects.toMatchObject({
      code: SecurityErrorCode.KEY_CUSTODY_INVALID,
    });
    expect(await bytes(lifecycle)).toEqual(original);

    // Cleared again, the same code still works and yields the same bytes.
    custodyStorage.entries.clear();
    await lifecycle.recover(recoveryCode);
    expect(await bytes(lifecycle)).toEqual(original);
  });

  it('does not write a new escrow when recovering', async () => {
    const { lifecycle, escrowStore, recoveryCode } = await setUpThenLoseTheDevice();
    await lifecycle.recover(recoveryCode);
    expect(escrowStore.saves).toBe(1);
  });
});

describe('D — a wrong recovery code', () => {
  it('fails and leaves custody empty', async () => {
    const { lifecycle, custodyStorage } = harness();
    await lifecycle.initialize();
    custodyStorage.entries.clear();

    await expect(lifecycle.recover('AAAA-BBBB-CCCC')).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });

    expect(await lifecycle.status()).toBe('needs-recovery');
    expect(await lifecycle.load()).toBeNull();
    expect(custodyStorage.entries.size).toBe(0);
  });

  it('rejects a code of the wrong shape before deriving anything', async () => {
    const { lifecycle, custodyStorage } = harness();
    await lifecycle.initialize();
    custodyStorage.entries.clear();

    await expect(lifecycle.recover('nonsense')).rejects.toMatchObject({
      code: SecurityErrorCode.RECOVERY_CODE_INVALID,
    });
    expect(custodyStorage.entries.size).toBe(0);
  });
});

describe('E — missing escrow', () => {
  it('fails with RECOVERY_ESCROW_MISSING and generates nothing', async () => {
    const { lifecycle, custodyStorage, escrowStore } = harness();

    await expect(lifecycle.recover('K7QM-2XPD-9RTF')).rejects.toMatchObject({
      code: SecurityErrorCode.RECOVERY_ESCROW_MISSING,
    });

    expect(escrowStore.document).toBeNull();
    expect(escrowStore.saves).toBe(0);
    expect(custodyStorage.entries.size).toBe(0);
    expect(await lifecycle.load()).toBeNull();
    expect(await lifecycle.status()).toBe('needs-setup');
  });
});

describe('F — corrupt escrow', () => {
  it('fails and leaves custody empty for a tampered ciphertext', async () => {
    const { lifecycle, custodyStorage, escrowStore } = harness();
    const { recoveryCode } = await lifecycle.initialize();
    custodyStorage.entries.clear();

    const stored = escrowStore.document as RecoveryEscrowDocument;
    escrowStore.document = {
      ...stored,
      wrappedKey: (stored.wrappedKey[0] === 'A' ? 'B' : 'A') + stored.wrappedKey.slice(1),
    };

    await expect(lifecycle.recover(recoveryCode)).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
    expect(custodyStorage.entries.size).toBe(0);
    expect(await lifecycle.load()).toBeNull();
  });

  it('fails before deriving when the metadata is malformed', async () => {
    const { lifecycle, custodyStorage, escrowStore } = harness();
    const { recoveryCode } = await lifecycle.initialize();
    custodyStorage.entries.clear();
    const stored = escrowStore.document as RecoveryEscrowDocument;

    const broken: Array<[string, unknown]> = [
      ['version', 2],
      ['algorithm', 'AES-CBC'],
      ['iterations', 1],
      ['iterations', 'lots'],
      ['salt', null],
      ['wrappedKey', 42],
    ];
    for (const [field, value] of broken) {
      escrowStore.document = { ...stored, [field]: value } as RecoveryEscrowDocument;
      await expect(lifecycle.recover(recoveryCode), `${field}=${String(value)}`).rejects.toThrow();
      expect(custodyStorage.entries.size, `${field}=${String(value)}`).toBe(0);
    }
  });
});
