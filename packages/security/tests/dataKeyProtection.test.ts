import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toBase64 } from '../src/crypto/base64';
import { custodyAddressFor } from '../src/custodyAddress';
import {
  createDataKeyLifecycle,
  type DataKeyLifecycle,
  type RecoveryEscrowStore,
} from '../src/dataKeyLifecycle';
import { SecurityErrorCode } from '../src/errors';
import { createKeyCustody, type CustodyStorage } from '../src/keyCustody';
import { MIN_KDF_ITERATIONS } from '../src/kdfPolicy';
import {
  acceptPairing,
  createPairingOffer,
  derivePairingAgreement,
  type PairingSessionDocument,
} from '../src/pairing';
import type { ProtectionTier } from '../src/protectionTier';
import { decryptRecordPayload, encryptRecordPayload } from '../src/recordCrypto';
import type { RecoveryEscrowDocument } from '../src/recoveryEscrow';
import { P256KeyAgreement } from '../src/services/KeyAgreement';
import { PortableRecordCipher } from '../src/services/PortableRecordCipher';
import { WebCryptoService } from '../src/services/WebCryptoService';
import type { EncryptionContext } from '../src/types/crypto';

/**
 * The passphrase inside the lifecycle, not the primitive.
 *
 * `dataKeyWrapper.test.ts` proves the construction: that a wrapper opens under
 * the right passphrase and under nothing else. What is at stake here is
 * everything around it — what gets written where, what survives the passphrase
 * being forgotten, and what a passphrase must never be allowed to touch.
 *
 * Two of these matter more than the rest. **Recovery must be unaffected**: the
 * passphrase is protection for a device, and if forgetting it could cost a
 * person their records it would be a liability rather than a defence.
 * **The passphrase must not be persisted or emitted anywhere** — not in
 * custody, not in the escrow, not in a log line, not in a pairing envelope, not
 * over the network — because every one of those is a place it would outlive the
 * moment it was typed.
 */

const crypto = new WebCryptoService(MIN_KDF_ITERATIONS);
const CONTEXT: EncryptionContext = { userId: 'alice-uid', appName: 'networth' };
const APP = CONTEXT.appName;
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

const agreement = new P256KeyAgreement(randomBytes);
const cipher = new PortableRecordCipher(randomBytes);

/**
 * Distinctive enough that finding it anywhere is unambiguous.
 *
 * A generic passphrase could appear in a haystack by coincidence; this one
 * cannot, so a hit in stored bytes or a log line is a real leak and not a
 * substring collision.
 */
const PASSPHRASE = 'zq7-marmalade-quorum-vessel';
const NEXT_PASSPHRASE = 'xt4-obsidian-lantern-thicket';

class FakeCustodyStorage implements CustodyStorage {
  readonly entries = new Map<string, string>();
  constructor(readonly protection: ProtectionTier = 'os-keystore') {}
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

/** Stands in for Firestore: the only thing in the lifecycle that leaves the device. */
class FakeEscrowStore implements RecoveryEscrowStore {
  document: RecoveryEscrowDocument | null = null;
  saves = 0;
  async load(): Promise<unknown | null> {
    return this.document === null ? null : { ...this.document };
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
  /** Every byte this lifecycle has caused to be written, anywhere. */
  everythingStored(): string;
}

function harness(
  custodyStorage = new FakeCustodyStorage(),
  escrowStore = new FakeEscrowStore(),
): Harness {
  return {
    lifecycle: createDataKeyLifecycle({
      custody: createKeyCustody(custodyStorage, { owner: CONTEXT.userId }),
      escrowStore,
      crypto,
      context: CONTEXT,
      randomBytes,
    }),
    custodyStorage,
    escrowStore,
    everythingStored: () =>
      JSON.stringify([...custodyStorage.entries.entries()]) + JSON.stringify(escrowStore.document),
  };
}

/** Set up, then put a passphrase in front of the key. The normal starting point. */
async function protectedDevice(): Promise<Harness & { recoveryCode: string; key: number[] }> {
  const h = harness();
  const { recoveryCode } = await h.lifecycle.initialize();
  const key = Array.from((await h.lifecycle.load()) as Uint8Array);
  await h.lifecycle.protect(PASSPHRASE);
  return { ...h, recoveryCode, key };
}

/** A restart: same storage, a lifecycle that has never held the opened key. */
function restart(h: Harness): DataKeyLifecycle {
  return createDataKeyLifecycle({
    custody: createKeyCustody(h.custodyStorage, { owner: CONTEXT.userId }),
    escrowStore: h.escrowStore,
    crypto,
    context: CONTEXT,
    randomBytes,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('A — putting a passphrase on a device that has a key', () => {
  it('leaves the key itself untouched, so nothing needs re-encrypting', async () => {
    const { lifecycle, key } = await protectedDevice();
    expect(Array.from((await lifecycle.load()) as Uint8Array)).toEqual(key);
  });

  it('does not sign the user out of their own data', async () => {
    // Protecting is a settings action taken mid-session. Locking the app as a
    // side effect of it would be a surprise, and would teach people that
    // turning protection on costs them something.
    const { lifecycle } = await protectedDevice();
    expect(await lifecycle.status()).toBe('ready');
    expect(await lifecycle.isProtected()).toBe(true);
  });

  it('refuses on a device with no key, rather than making one', async () => {
    const { lifecycle } = harness();
    await expect(lifecycle.protect(PASSPHRASE)).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_UNAVAILABLE,
    });
    // And no key was minted on the way past.
    expect(await lifecycle.status()).toBe('needs-setup');
  });

  it('refuses a weak passphrase, leaving the key unprotected rather than half-protected', async () => {
    const h = harness();
    await h.lifecycle.initialize();
    const before = h.custodyStorage.entries.get(custodyAddressFor(CONTEXT.userId));

    await expect(h.lifecycle.protect('x')).rejects.toMatchObject({
      code: SecurityErrorCode.PASSPHRASE_TOO_WEAK,
    });

    expect(h.custodyStorage.entries.get(custodyAddressFor(CONTEXT.userId))).toBe(before);
    expect(await h.lifecycle.isProtected()).toBe(false);
  });
});

describe('B — a restart, which is the state the whole thing is for', () => {
  it('comes back locked, not ready and not empty', async () => {
    const h = await protectedDevice();
    const fresh = restart(h);

    expect(await fresh.status()).toBe('locked');
    // Not `needs-setup`. That is the distinction the whole state exists for:
    // a caller told "no key" offers to create one, over the top of this.
    expect(await fresh.status()).not.toBe('needs-setup');
  });

  it('will not hand out the key until the passphrase is given', async () => {
    const h = await protectedDevice();
    const fresh = restart(h);

    await expect(fresh.load()).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_LOCKED,
    });

    const opened = await fresh.unlock(PASSPHRASE);
    expect(Array.from(opened)).toEqual(h.key);
    expect(await fresh.status()).toBe('ready');
    expect(Array.from((await fresh.load()) as Uint8Array)).toEqual(h.key);
  });

  it('a wrong passphrase yields no key and does not disturb what is stored', async () => {
    const h = await protectedDevice();
    const fresh = restart(h);
    const before = h.everythingStored();

    await expect(fresh.unlock('zq7-marmalade-quorum-vessl')).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });

    expect(h.everythingStored()).toBe(before);
    expect(await fresh.status()).toBe('locked');
    await expect(fresh.load()).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_LOCKED,
    });
  });

  it('locking again puts it back, without a second passphrase prompt costing the key', async () => {
    const h = await protectedDevice();
    const fresh = restart(h);
    await fresh.unlock(PASSPHRASE);

    fresh.lock();
    expect(await fresh.status()).toBe('locked');
    // Still openable: locking forgets the opened copy, it does not destroy it.
    expect(Array.from(await fresh.unlock(PASSPHRASE))).toEqual(h.key);
  });
});

describe('C — the passphrase is never written anywhere', () => {
  it('is absent from custody and from the escrow, in every form', async () => {
    const h = await protectedDevice();
    const stored = h.everythingStored();

    for (const form of [
      PASSPHRASE,
      toBase64(new TextEncoder().encode(PASSPHRASE)),
      Buffer.from(PASSPHRASE).toString('hex'),
    ]) {
      expect(stored).not.toContain(form);
    }
    // Nor the key it protects, which is the other half of the point.
    expect(stored).not.toContain(toBase64(Uint8Array.from(h.key)));
  });

  it('is absent after unlocking and after changing it', async () => {
    const h = await protectedDevice();
    const fresh = restart(h);
    await fresh.unlock(PASSPHRASE);
    await fresh.changePassphrase(PASSPHRASE, NEXT_PASSPHRASE);

    const stored = h.everythingStored();
    expect(stored).not.toContain(PASSPHRASE);
    expect(stored).not.toContain(NEXT_PASSPHRASE);
  });

  it('stores exactly one thing, under the same custody key as before', async () => {
    // Protection is a different envelope in the same slot, not a second secret
    // in a second place. A second slot is a second thing to leak and a second
    // thing to forget to clear.
    const h = await protectedDevice();
    expect([...h.custodyStorage.entries.keys()]).toEqual([custodyAddressFor(CONTEXT.userId)]);
  });

  it('is not recoverable from what is stored, even knowing the key', async () => {
    // Somebody who has already got the DEK by other means still cannot read
    // the passphrase back out — there is no verifier, digest or hint to work
    // against, which is what keeps an offline guess expensive.
    const h = await protectedDevice();
    const envelope = JSON.parse(
      h.custodyStorage.entries.get(custodyAddressFor(CONTEXT.userId)) as string,
    ) as { v: number; w: { version: number; wrappedKey: Record<string, unknown> } };

    expect(envelope.v).toBe(2);
    expect(Object.keys(envelope.w).sort()).toEqual(['version', 'wrappedKey']);
    expect(Object.keys(envelope.w.wrappedKey).sort()).toEqual(
      ['algorithm', 'ciphertext', 'iterations', 'iv', 'salt', 'version'].sort(),
    );
  });
});

describe('D — the passphrase is never logged', () => {
  /** Every console channel, including the ones a crash reporter mirrors. */
  function watchConsole() {
    const calls: unknown[] = [];
    for (const channel of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, channel).mockImplementation((...args: unknown[]) => {
        calls.push(...args);
      });
    }
    return calls;
  }

  it('emits nothing containing it on the success paths', async () => {
    const calls = watchConsole();
    const h = await protectedDevice();
    const fresh = restart(h);
    await fresh.unlock(PASSPHRASE);
    await fresh.changePassphrase(PASSPHRASE, NEXT_PASSPHRASE);

    const emitted = calls.map((value) => String(value)).join('\n');
    expect(emitted).not.toContain(PASSPHRASE);
    expect(emitted).not.toContain(NEXT_PASSPHRASE);
  });

  it('emits nothing containing it on the failure paths, where it would be a hint', async () => {
    const calls = watchConsole();
    const h = await protectedDevice();
    const fresh = restart(h);

    await expect(fresh.unlock('zq7-marmalade-quorum-vessl')).rejects.toThrow();
    await expect(fresh.protect('x')).rejects.toThrow();

    const emitted = calls.map((value) => String(value)).join('\n');
    expect(emitted).not.toContain('zq7-marmalade');
  });

  it('keeps it out of the thrown error too, which is what gets reported', async () => {
    // A crash reporter serialises the error, not the console. An attempt that
    // carried the passphrase in `message` or `cause` would ship it to whatever
    // ingests reports.
    const h = await protectedDevice();
    const fresh = restart(h);

    const captured = await fresh.unlock('zq7-marmalade-quorum-vessl').catch((error: unknown) => error);
    const error = captured as Error;
    const serialised = [
      error.message,
      error.stack ?? '',
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ].join('\n');
    expect(serialised).not.toContain('zq7-marmalade');
  });
});

describe('E — recovery is unaffected, which is the condition of shipping this at all', () => {
  it('the recovery code still opens the key after the device was protected', async () => {
    const h = await protectedDevice();
    // The device is gone. A fresh install: custody empty, escrow intact.
    h.custodyStorage.entries.clear();
    const fresh = restart(h);

    expect(await fresh.status()).toBe('needs-recovery');
    const recovered = await fresh.recover(h.recoveryCode);

    // Byte-identical to the key that existed before the passphrase went on.
    expect(Array.from(recovered)).toEqual(h.key);
  });

  it('the recovered key still decrypts records written before protection', async () => {
    const h = harness();
    const { recoveryCode } = await h.lifecycle.initialize();
    const key = (await h.lifecycle.load()) as Uint8Array;

    const recordContext = {
      userId: CONTEXT.userId,
      appName: APP,
      collection: 'assets',
      recordId: 'asset-1',
    };
    const envelope = await encryptRecordPayload(
      { name: 'House', value: 42 },
      key,
      recordContext,
      cipher,
    );

    await h.lifecycle.protect(PASSPHRASE);
    h.custodyStorage.entries.clear();
    const fresh = restart(h);
    const recovered = await fresh.recover(recoveryCode);

    // The record opens under the recovered key, with its original additional
    // data. The passphrase changed how the key is *held*, not the key, and not
    // one byte of any record's envelope.
    expect(await decryptRecordPayload(envelope, recovered, recordContext, cipher)).toEqual({
      name: 'House',
      value: 42,
    });
  });

  it('a forgotten passphrase costs the device and nothing else', async () => {
    const h = await protectedDevice();
    const stuck = restart(h);
    // Whatever they type, this device is shut.
    await expect(stuck.unlock('not-the-passphrase-at-all')).rejects.toThrow();

    // A fresh install plus the recovery code, and the data is back.
    h.custodyStorage.entries.clear();
    expect(Array.from(await restart(h).recover(h.recoveryCode))).toEqual(h.key);
  });

  it('writes no new escrow when protecting, unlocking or changing the passphrase', async () => {
    const h = await protectedDevice();
    expect(h.escrowStore.saves).toBe(1);

    const fresh = restart(h);
    await fresh.unlock(PASSPHRASE);
    await fresh.changePassphrase(PASSPHRASE, NEXT_PASSPHRASE);

    // Still the one written at setup. The escrow is keyed by the recovery code
    // and has nothing to say about a passphrase; rewriting it here would be a
    // chance to break recovery for no gain.
    expect(h.escrowStore.saves).toBe(1);
  });

  it('refuses to recover over a protected key, rather than dropping the protection', async () => {
    const h = await protectedDevice();
    const fresh = restart(h);

    await expect(fresh.recover(h.recoveryCode)).rejects.toMatchObject({
      code: SecurityErrorCode.KEY_CUSTODY_INVALID,
    });
    // Still protected. Recovering here would have replaced a protected key
    // with an unprotected one, silently, on a device the user still holds.
    expect(await fresh.isProtected()).toBe(true);
  });
});

describe('F — nothing about the passphrase reaches the server', () => {
  it('the escrow document is byte-identical before and after protection', async () => {
    const h = harness();
    await h.lifecycle.initialize();
    const before = JSON.stringify(h.escrowStore.document);

    await h.lifecycle.protect(PASSPHRASE);
    const fresh = restart(h);
    await fresh.unlock(PASSPHRASE);
    await fresh.changePassphrase(PASSPHRASE, NEXT_PASSPHRASE);

    expect(JSON.stringify(h.escrowStore.document)).toBe(before);
  });

  it('makes no network call at all while protecting or unlocking', async () => {
    // The lifecycle's only sink is the escrow store, and the assertion above
    // covers what it holds. This covers the other direction: that no code path
    // introduced here talks to anything directly.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const h = await protectedDevice();
      const fresh = restart(h);
      await fresh.unlock(PASSPHRASE);
      await fresh.changePassphrase(PASSPHRASE, NEXT_PASSPHRASE);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('G — pairing neither carries the passphrase nor is weakened by it', () => {
  /** Both sides of a pairing, run for real, to the point where a key can be wrapped. */
  async function pairingTransport(): Promise<{
    session: PairingSessionDocument;
    transportKey: Uint8Array;
    responderTransportKey: Uint8Array;
    context: { userId: string; appName: string; sessionId: string };
  }> {
    const now = 1_000_000;
    const offered = createPairingOffer({ appName: APP, now, randomBytes, agreement });
    const accepted = acceptPairing({ session: offered.session, now, agreement });
    const session: PairingSessionDocument = {
      ...offered.session,
      responderPublicKey: accepted.responderPublicKey,
      initiatorPublicKey: toBase64(offered.keyPair.publicKey),
    };
    const context = { userId: CONTEXT.userId, appName: APP, sessionId: session.id };
    const derive = (privateKey: Uint8Array) =>
      derivePairingAgreement({
        session,
        privateKey,
        userId: CONTEXT.userId,
        now,
        agreement,
      }).transportKey;
    return {
      session,
      transportKey: derive(offered.keyPair.privateKey),
      responderTransportKey: derive(accepted.keyPair.privateKey),
      context,
    };
  }

  it('an unlocked protected device can still export, and the envelope holds no passphrase', async () => {
    const h = await protectedDevice();
    const { transportKey, context } = await pairingTransport();

    const envelope = await h.lifecycle.exportForPairing({ transportKey, context, cipher });
    const serialised = JSON.stringify(envelope);

    expect(serialised).not.toContain(PASSPHRASE);
    // Only the wrapped key and its metadata: a passphrase field could not hide
    // among these even if one were added.
    expect(Object.keys(envelope).sort()).toEqual(['alg', 'ct', 'iv', 'v']);
  });

  it('a locked device cannot hand out a key it has not opened itself', async () => {
    const h = await protectedDevice();
    const fresh = restart(h);
    const { transportKey, context } = await pairingTransport();

    await expect(
      fresh.exportForPairing({ transportKey, context, cipher }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DATA_KEY_LOCKED });
  });

  it('refuses to adopt over a protected key, rather than pairing the protection away', async () => {
    const h = await protectedDevice();
    const { session, transportKey, context } = await pairingTransport();

    await expect(
      h.lifecycle.adoptPairedKey({ session, transportKey, context, cipher, now: 1_000_000 }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.KEY_CUSTODY_INVALID });
    expect(await h.lifecycle.isProtected()).toBe(true);
  });

  it('protection is per-device: the paired device gets a key, not a passphrase', async () => {
    // What a person expects, and the honest description of what happens: the
    // passphrase guards *this* device's copy. A second device they own gets its
    // own copy and can put its own passphrase on it, or not.
    const h = await protectedDevice();
    expect(await h.lifecycle.isProtected()).toBe(true);

    const second = harness();
    expect(await second.lifecycle.isProtected()).toBe(false);
    expect(await second.lifecycle.status()).toBe('needs-setup');
  });
});

describe('H — the protected envelope is not a way around anything', () => {
  it('a corrupt wrapper is unusable, not absent', async () => {
    const h = await protectedDevice();
    const raw = JSON.parse(h.custodyStorage.entries.get(custodyAddressFor(CONTEXT.userId)) as string) as {
      v: number;
      w: unknown;
    };
    h.custodyStorage.entries.set(custodyAddressFor(CONTEXT.userId), JSON.stringify({ v: 2, w: 'not an object' }));
    void raw;

    const fresh = restart(h);
    // `unusable`, so the gate shows a dead end. Reporting `needs-setup` here
    // would offer to mint a key over the one that is stored.
    expect(await fresh.status()).toBe('unusable');
    await expect(fresh.load()).rejects.toThrow();
  });

  it('a wrapper from another user does not open on this one', async () => {
    const mine = await protectedDevice();

    // Custody is addressed by owner now, so the *storage* layer already keeps
    // Mallory away from this record — asserted separately below. That would
    // quietly retire the assertion this test exists for, which is about the
    // AAD rather than the address. So the custody here is deliberately given
    // Alice's owner: Mallory genuinely reads Alice's stored bytes, and the only
    // thing left to refuse her is the tag.
    const theirs = createDataKeyLifecycle({
      custody: createKeyCustody(mine.custodyStorage, { owner: CONTEXT.userId }),
      escrowStore: mine.escrowStore,
      crypto,
      context: { userId: 'mallory-uid', appName: APP },
      randomBytes,
    });

    // Same bytes on disk, same passphrase typed, different user: the AAD binds
    // the wrapper to an identity, so this is a tag failure and not a key.
    await expect(theirs.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
  });

  it('and with her own identity she cannot reach the record at all', async () => {
    // The newer, stronger property, stated as its own case rather than folded
    // into the one above: an ordinary second user addresses her own slot, so
    // Alice's wrapper is not merely unopenable, it is invisible.
    const mine = await protectedDevice();
    const mallory = createDataKeyLifecycle({
      custody: createKeyCustody(mine.custodyStorage, { owner: 'mallory-uid' }),
      escrowStore: mine.escrowStore,
      crypto,
      context: { userId: 'mallory-uid', appName: APP },
      randomBytes,
    });

    expect(await mallory.isProtected()).toBe(false);
    await expect(mallory.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_UNAVAILABLE,
    });
  });

  it('changing the passphrase requires the current one even on an open session', async () => {
    const h = await protectedDevice();
    // The device is unlocked and sitting on a table. That must not be enough
    // to reseat the protection under a passphrase the owner does not know.
    await expect(
      h.lifecycle.changePassphrase('not-the-current-one', NEXT_PASSPHRASE),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });

    // And the original still works.
    expect(Array.from(await restart(h).unlock(PASSPHRASE))).toEqual(h.key);
  });

  it('after a change, only the new passphrase opens it, and the key is the same', async () => {
    const h = await protectedDevice();
    await h.lifecycle.changePassphrase(PASSPHRASE, NEXT_PASSPHRASE);

    const fresh = restart(h);
    await expect(fresh.unlock(PASSPHRASE)).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
    expect(Array.from(await fresh.unlock(NEXT_PASSPHRASE))).toEqual(h.key);
  });
});

describe('I — an install that predates the passphrase', () => {
  it('keeps working untouched, and is never asked for one', async () => {
    // The compatibility case. A v1 envelope is what every existing install has
    // and what setup, recovery and pairing still write; nothing about this
    // feature reaches into one.
    const h = harness();
    await h.lifecycle.initialize();
    const stored = JSON.parse(h.custodyStorage.entries.get(custodyAddressFor(CONTEXT.userId)) as string) as {
      v: number;
      k: string;
    };

    expect(stored.v).toBe(1);
    expect(typeof stored.k).toBe('string');
    expect(await h.lifecycle.status()).toBe('ready');
    expect(await h.lifecycle.isProtected()).toBe(false);
    expect(await restart(h).status()).toBe('ready');
  });

  it('recovery and pairing still write the unprotected form', async () => {
    // Deliberate: both are moments at which a key *arrives* on a device, and
    // neither has a passphrase to hand. Requiring one would put a forgettable
    // secret in front of recovery — the one thing it must never be.
    const h = await protectedDevice();
    h.custodyStorage.entries.clear();
    const fresh = restart(h);
    await fresh.recover(h.recoveryCode);

    const stored = JSON.parse(h.custodyStorage.entries.get(custodyAddressFor(CONTEXT.userId)) as string) as {
      v: number;
    };
    expect(stored.v).toBe(1);
    expect(await fresh.isProtected()).toBe(false);
  });
});
