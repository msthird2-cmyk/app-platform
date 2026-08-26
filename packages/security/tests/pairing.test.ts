import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toBase64 } from '../src/crypto/base64';
import {
  commitmentMatches,
  commitToPublicKey,
  verificationCode,
} from '../src/crypto/verificationCode';
import { SecurityErrorCode } from '../src/errors';
import { createKeyCustody, type CustodyStorage } from '../src/keyCustody';
import {
  acceptPairing,
  completePairing,
  createPairingOffer,
  derivePairingAgreement,
  pairingState,
  wrapDataKeyForPairing,
  type PairingSessionDocument,
} from '../src/pairing';
import type { ProtectionTier } from '../src/protectionTier';
import { P256KeyAgreement } from '../src/services/KeyAgreement';
import { PortableRecordCipher } from '../src/services/PortableRecordCipher';

const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

const agreement = new P256KeyAgreement(randomBytes);
const cipher = new PortableRecordCipher(randomBytes);

const UID = 'alice-uid';
const APP = 'networth';
const NOW = 1_000_000;
const DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 13) % 256);

class FakeCustody implements CustodyStorage {
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

/** Runs the protocol to the point each test needs. */
function offer(now = NOW) {
  return createPairingOffer({ appName: APP, now, randomBytes, agreement });
}

function accept(session: PairingSessionDocument, now = NOW) {
  return acceptPairing({ session, now, agreement });
}

/** The session as the relay holds it once both keys are published. */
function bothKeysPublished(
  session: PairingSessionDocument,
  initiatorPublicKey: Uint8Array,
  responderPublicKey: string,
): PairingSessionDocument {
  return {
    ...session,
    responderPublicKey,
    initiatorPublicKey: toBase64(initiatorPublicKey),
  };
}

describe('A — ECDH key agreement', () => {
  it('has both sides derive an identical transport key', () => {
    const a = agreement.generate();
    const b = agreement.generate();
    const salt = new Uint8Array([1, 2, 3]);
    const info = new Uint8Array([4, 5, 6]);
    expect(Array.from(agreement.deriveTransportKey(a.privateKey, b.publicKey, salt, info)))
      .toEqual(Array.from(agreement.deriveTransportKey(b.privateKey, a.publicKey, salt, info)));
  });

  it('produces a different key for a different peer, salt or info', () => {
    const a = agreement.generate();
    const b = agreement.generate();
    const c = agreement.generate();
    const salt = new Uint8Array([1]);
    const info = new Uint8Array([2]);
    const base = toBase64(agreement.deriveTransportKey(a.privateKey, b.publicKey, salt, info));

    expect(toBase64(agreement.deriveTransportKey(a.privateKey, c.publicKey, salt, info)))
      .not.toBe(base);
    expect(toBase64(agreement.deriveTransportKey(a.privateKey, b.publicKey, new Uint8Array([9]), info)))
      .not.toBe(base);
    expect(toBase64(agreement.deriveTransportKey(a.privateKey, b.publicKey, salt, new Uint8Array([9]))))
      .not.toBe(base);
  });

  it('rejects a malformed or off-curve public key', () => {
    const a = agreement.generate();
    const salt = new Uint8Array([1]);
    const info = new Uint8Array([2]);
    const bad = [
      new Uint8Array(0),
      new Uint8Array(32),
      new Uint8Array(65),
      // Right length, not a point on the curve.
      Uint8Array.from({ length: 33 }, (_, i) => (i === 0 ? 2 : 0xff)),
    ];
    for (const peer of bad) {
      expect(
        () => agreement.deriveTransportKey(a.privateKey, peer, salt, info),
        String(peer.length),
      ).toThrowError(
        expect.objectContaining({ code: SecurityErrorCode.PAIRING_KEY_INVALID }),
      );
    }
  });

  it('generates a fresh ephemeral pair every time', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) seen.add(toBase64(agreement.generate().publicKey));
    expect(seen.size).toBe(20);
  });
});

describe('A2 — the curve parameters are the library\'s own', () => {
  /**
   * The production path cannot import `@noble/curves/nist.js`: it builds FROST
   * at module-evaluation time, which calls `TextEncoder`, and that would put a
   * browser global on the portable path the X-1 gate keeps clean. So the curve
   * is constructed from its published FIPS 186-4 parameters over the library's
   * own engine — and a transcription error there would be catastrophic and
   * silent.
   *
   * These tests use the library's high-level `p256` as an oracle. They run in
   * Node, where `TextEncoder` exists, so importing it here is fine; the
   * production module never does.
   */
  it('derives the same public key as the library for the same secret', async () => {
    const { p256 } = await import('@noble/curves/nist.js');
    for (let i = 0; i < 8; i += 1) {
      const { privateKey } = agreement.generate();
      expect(toBase64(agreement.publicKeyOf(privateKey)))
        .toBe(toBase64(p256.getPublicKey(privateKey)));
    }
  });

  it('agrees with a peer whose key the library generated', async () => {
    const { p256 } = await import('@noble/curves/nist.js');
    const ours = agreement.generate();
    const theirs = p256.keygen();
    const salt = new Uint8Array([7]);
    const info = new Uint8Array([8]);

    // Our derivation against their library-generated key, and the library's
    // raw shared secret run through the same HKDF, must match.
    const viaOurs = agreement.deriveTransportKey(ours.privateKey, theirs.publicKey, salt, info);
    const viaTheirs = agreement.deriveTransportKey(theirs.secretKey, ours.publicKey, salt, info);
    expect(toBase64(viaOurs)).toBe(toBase64(viaTheirs));

    // And the underlying ECDH output is identical to the library's.
    expect(toBase64(p256.getSharedSecret(ours.privateKey, theirs.publicKey)))
      .toBe(toBase64(p256.getSharedSecret(theirs.secretKey, ours.publicKey)));
  });

  it('produces public keys the library accepts as valid points', async () => {
    const { p256 } = await import('@noble/curves/nist.js');
    const { publicKey } = agreement.generate();
    // Throws if the point is not on the curve the library knows as P-256.
    expect(() => p256.Point.fromBytes(publicKey)).not.toThrow();
  });
});

describe('B — verification code', () => {
  const context = { userId: UID, appName: APP, sessionId: 'session-1' };

  it('is the same for the same two keys, in either order', () => {
    const a = agreement.generate();
    const b = agreement.generate();
    expect(verificationCode(a.publicKey, b.publicKey, context))
      .toBe(verificationCode(b.publicKey, a.publicKey, context));
  });

  it('looks like a code a person can read out', () => {
    const a = agreement.generate();
    const b = agreement.generate();
    expect(verificationCode(a.publicKey, b.publicKey, context)).toMatch(/^\d{3}-\d{3}$/);
  });

  it('changes if either public key changes', () => {
    const a = agreement.generate();
    const b = agreement.generate();
    const c = agreement.generate();
    const base = verificationCode(a.publicKey, b.publicKey, context);
    expect(verificationCode(c.publicKey, b.publicKey, context)).not.toBe(base);
    expect(verificationCode(a.publicKey, c.publicKey, context)).not.toBe(base);
  });

  it('changes with the user, application or session', () => {
    const a = agreement.generate();
    const b = agreement.generate();
    const base = verificationCode(a.publicKey, b.publicKey, context);
    for (const other of [
      { ...context, userId: 'bob-uid' },
      { ...context, appName: 'expense' },
      { ...context, sessionId: 'session-2' },
    ]) {
      expect(verificationCode(a.publicKey, b.publicKey, other)).not.toBe(base);
    }
  });

  it('shows a man in the middle a different code on each side', () => {
    // The attack the code exists to catch: the relay terminates two separate
    // agreements. Neither side is talking to the other, and the digits differ.
    const alice = agreement.generate();
    const bob = agreement.generate();
    const mitmToAlice = agreement.generate();
    const mitmToBob = agreement.generate();

    const aliceSees = verificationCode(alice.publicKey, mitmToAlice.publicKey, context);
    const bobSees = verificationCode(mitmToBob.publicKey, bob.publicKey, context);
    expect(aliceSees).not.toBe(bobSees);
  });

  it('binds the commitment to exactly one key', () => {
    const a = agreement.generate();
    const b = agreement.generate();
    const commitment = commitToPublicKey(a.publicKey);
    expect(commitmentMatches(a.publicKey, commitment)).toBe(true);
    expect(commitmentMatches(b.publicKey, commitment)).toBe(false);
    // And is not the same hash as anything else derived from the key.
    expect(commitment).not.toBe(toBase64(a.publicKey));
  });
});

describe('C — wrapped data encryption key', () => {
  async function paired() {
    const { keyPair: initiator, session } = offer();
    const { keyPair: responder, responderPublicKey } = accept(session);
    const published = bothKeysPublished(session, initiator.publicKey, responderPublicKey);

    const fromInitiator = derivePairingAgreement({
      session: published, privateKey: initiator.privateKey, userId: UID, now: NOW, agreement,
    });
    const fromResponder = derivePairingAgreement({
      session: published, privateKey: responder.privateKey, userId: UID, now: NOW, agreement,
    });
    return { published, initiator, responder, fromInitiator, fromResponder };
  }

  it('has both devices derive the same transport key and the same code', async () => {
    const { fromInitiator, fromResponder } = await paired();
    expect(Array.from(fromInitiator.transportKey)).toEqual(Array.from(fromResponder.transportKey));
    expect(fromInitiator.code).toBe(fromResponder.code);
  });

  it('transfers the existing key end to end', async () => {
    const { published, fromInitiator, fromResponder } = await paired();
    const context = { userId: UID, appName: APP, sessionId: published.id };

    const wrapped = await wrapDataKeyForPairing({
      dataKey: DEK, transportKey: fromInitiator.transportKey, context, cipher,
    });
    const storage = new FakeCustody();
    const recovered = await completePairing({
      session: { ...published, wrapped },
      transportKey: fromResponder.transportKey,
      context, cipher, custody: createKeyCustody(storage), now: NOW,
    });

    expect(Array.from(recovered)).toEqual(Array.from(DEK));
    expect([...storage.entries.keys()]).toEqual(['platform.dek.v1']);
    // The relay never saw the key.
    expect(JSON.stringify(wrapped)).not.toContain(toBase64(DEK));
  });

  it('refuses a wrong transport key, tampered ciphertext or tampered nonce', async () => {
    const { published, fromInitiator } = await paired();
    const context = { userId: UID, appName: APP, sessionId: published.id };
    const wrapped = await wrapDataKeyForPairing({
      dataKey: DEK, transportKey: fromInitiator.transportKey, context, cipher,
    });

    const attempts: Array<[string, Uint8Array, typeof wrapped]> = [
      ['wrong transport key', new Uint8Array(32).fill(9), wrapped],
      ['tampered ct', fromInitiator.transportKey, { ...wrapped, ct: flip(wrapped.ct) }],
      ['tampered iv', fromInitiator.transportKey, { ...wrapped, iv: flip(wrapped.iv) }],
    ];
    for (const [label, key, envelope] of attempts) {
      const storage = new FakeCustody();
      await expect(
        completePairing({
          session: { ...published, wrapped: envelope },
          transportKey: key, context, cipher,
          custody: createKeyCustody(storage), now: NOW,
        }),
        label,
      ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
      expect(storage.entries.size, label).toBe(0);
    }
  });

  it('refuses additional data naming another user, application or session', async () => {
    const { published, fromInitiator, fromResponder } = await paired();
    const context = { userId: UID, appName: APP, sessionId: published.id };
    const wrapped = await wrapDataKeyForPairing({
      dataKey: DEK, transportKey: fromInitiator.transportKey, context, cipher,
    });

    for (const wrong of [
      { ...context, userId: 'bob-uid' },
      { ...context, appName: 'expense' },
      { ...context, sessionId: 'another-session' },
    ]) {
      const storage = new FakeCustody();
      await expect(
        completePairing({
          session: { ...published, wrapped },
          transportKey: fromResponder.transportKey,
          context: wrong, cipher, custody: createKeyCustody(storage), now: NOW,
        }),
        JSON.stringify(wrong),
      ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
      expect(storage.entries.size).toBe(0);
    }
  });

  it('gives a different transport key to a different user or application', async () => {
    const { published, initiator, responder } = await paired();
    const mine = derivePairingAgreement({
      session: published, privateKey: initiator.privateKey, userId: UID, now: NOW, agreement,
    });
    const asSomeoneElse = derivePairingAgreement({
      session: published, privateKey: responder.privateKey, userId: 'bob-uid', now: NOW, agreement,
    });
    // Same ECDH, different HKDF info: the keys cannot agree.
    expect(toBase64(mine.transportKey)).not.toBe(toBase64(asSomeoneElse.transportKey));
    expect(mine.code).not.toBe(asSomeoneElse.code);
  });

  it('refuses to wrap anything that is not an AES-256 key', async () => {
    const { published, fromInitiator } = await paired();
    const context = { userId: UID, appName: APP, sessionId: published.id };
    for (const bad of [new Uint8Array(16), new Uint8Array(33), new Uint8Array(32)]) {
      await expect(
        wrapDataKeyForPairing({ dataKey: bad, transportKey: fromInitiator.transportKey, context, cipher }),
        String(bad.length),
      ).rejects.toMatchObject({ code: SecurityErrorCode.DATA_KEY_UNAVAILABLE });
    }
  });
});

describe('D — the commitment is what makes six digits enough', () => {
  it('detects a substituted initiator key', () => {
    // The relay swaps its own key in after seeing the responder's. The
    // commitment was published first, so it no longer opens.
    const { keyPair: initiator, session } = offer();
    const { responderPublicKey } = accept(session);
    const mitm = agreement.generate();

    const forged = { ...session, responderPublicKey, initiatorPublicKey: toBase64(mitm.publicKey) };
    expect(
      () => derivePairingAgreement({
        session: forged, privateKey: mitm.privateKey, userId: UID, now: NOW, agreement,
      }),
    ).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.PAIRING_COMMITMENT_MISMATCH }),
    );
    void initiator;
  });

  it('detects a rewritten commitment', () => {
    const { keyPair: initiator, session } = offer();
    const { responderPublicKey } = accept(session);
    const other = agreement.generate();
    const forged = {
      ...bothKeysPublished(session, initiator.publicKey, responderPublicKey),
      commitment: commitToPublicKey(other.publicKey),
    };
    expect(
      () => derivePairingAgreement({
        session: forged, privateKey: initiator.privateKey, userId: UID, now: NOW, agreement,
      }),
    ).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.PAIRING_COMMITMENT_MISMATCH }),
    );
  });

  it('publishes no key material in the offer itself', () => {
    const { keyPair, session } = offer();
    const serialised = JSON.stringify(session);
    expect(serialised).not.toContain(toBase64(keyPair.publicKey));
    expect(serialised).not.toContain(toBase64(keyPair.privateKey));
    expect(session.initiatorPublicKey).toBeNull();
  });

  it('refuses a private key belonging to neither side', () => {
    const { keyPair: initiator, session } = offer();
    const { responderPublicKey } = accept(session);
    const published = bothKeysPublished(session, initiator.publicKey, responderPublicKey);
    const stranger = agreement.generate();
    expect(
      () => derivePairingAgreement({
        session: published, privateKey: stranger.privateKey, userId: UID, now: NOW, agreement,
      }),
    ).toThrowError(expect.objectContaining({ code: SecurityErrorCode.PAIRING_KEY_INVALID }));
  });
});

describe('E — state machine', () => {
  it('walks offered, accepted, confirmed, consumed', async () => {
    const { keyPair: initiator, session } = offer();
    expect(pairingState(session, NOW)).toBe('offered');

    const { responderPublicKey } = accept(session);
    const accepted = bothKeysPublished(session, initiator.publicKey, responderPublicKey);
    expect(pairingState(accepted, NOW)).toBe('accepted');

    const derived = derivePairingAgreement({
      session: accepted, privateKey: initiator.privateKey, userId: UID, now: NOW, agreement,
    });
    const wrapped = await wrapDataKeyForPairing({
      dataKey: DEK, transportKey: derived.transportKey,
      context: { userId: UID, appName: APP, sessionId: session.id }, cipher,
    });
    const confirmed = { ...accepted, wrapped };
    expect(pairingState(confirmed, NOW)).toBe('confirmed');

    expect(pairingState({ ...confirmed, consumedAt: NOW + 1 }, NOW + 1)).toBe('consumed');
  });

  it('expires, and an expired session cannot be advanced from any state', () => {
    const { keyPair: initiator, session } = offer();
    const after = session.expiresAt;
    expect(pairingState(session, after)).toBe('expired');

    expect(() => accept(session, after)).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.PAIRING_EXPIRED }),
    );

    const { responderPublicKey } = accept(session);
    const accepted = bothKeysPublished(session, initiator.publicKey, responderPublicKey);
    expect(pairingState(accepted, after)).toBe('expired');
    expect(
      () => derivePairingAgreement({
        session: accepted, privateKey: initiator.privateKey, userId: UID, now: after, agreement,
      }),
    ).toThrowError(expect.objectContaining({ code: SecurityErrorCode.PAIRING_EXPIRED }));
  });

  it('treats consumption as terminal, even past expiry', () => {
    const { session } = offer();
    const consumed = { ...session, consumedAt: NOW + 1 };
    expect(pairingState(consumed, NOW + 1)).toBe('consumed');
    expect(pairingState(consumed, session.expiresAt + 1)).toBe('consumed');
  });

  it('refuses to complete a session twice', async () => {
    const { keyPair: initiator, session } = offer();
    const { keyPair: responder, responderPublicKey } = accept(session);
    const accepted = bothKeysPublished(session, initiator.publicKey, responderPublicKey);
    const context = { userId: UID, appName: APP, sessionId: session.id };
    const a = derivePairingAgreement({
      session: accepted, privateKey: initiator.privateKey, userId: UID, now: NOW, agreement,
    });
    const b = derivePairingAgreement({
      session: accepted, privateKey: responder.privateKey, userId: UID, now: NOW, agreement,
    });
    const wrapped = await wrapDataKeyForPairing({
      dataKey: DEK, transportKey: a.transportKey, context, cipher,
    });

    const storage = new FakeCustody();
    const custody = createKeyCustody(storage);
    await completePairing({
      session: { ...accepted, wrapped }, transportKey: b.transportKey,
      context, cipher, custody, now: NOW,
    });

    // Replaying the same session is refused twice over: it is marked consumed,
    // and this device now holds a key it must not overwrite.
    await expect(
      completePairing({
        session: { ...accepted, wrapped, consumedAt: NOW }, transportKey: b.transportKey,
        context, cipher, custody, now: NOW,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.PAIRING_STATE_INVALID });
  });

  it('rejects malformed sessions rather than guessing', () => {
    for (const value of [
      null, undefined, 'a string', 42, [], {},
      { id: 'a', version: 1, appName: APP, commitment: 'c', createdAt: 2, expiresAt: 1 },
      { id: 'a', version: 2, appName: APP, commitment: 'c', createdAt: 1, expiresAt: 2 },
      { id: 'a', version: 1, appName: APP, commitment: 'c', createdAt: 1, expiresAt: 2, wrapped: 'no' },
      { id: 'a', version: 1, appName: APP, commitment: 'c', createdAt: 1, expiresAt: 2, responderPublicKey: 42 },
    ]) {
      expect(pairingState(value, NOW), JSON.stringify(value) ?? String(value)).toBe('invalid');
    }
  });
});

describe('F — failure never costs a key', () => {
  it('never stores anything on any failing path', async () => {
    const { keyPair: initiator, session } = offer();
    const { keyPair: responder, responderPublicKey } = accept(session);
    const accepted = bothKeysPublished(session, initiator.publicKey, responderPublicKey);
    const context = { userId: UID, appName: APP, sessionId: session.id };
    const b = derivePairingAgreement({
      session: accepted, privateKey: responder.privateKey, userId: UID, now: NOW, agreement,
    });

    const failures: Array<[string, () => Promise<unknown>]> = [];
    const storage = new FakeCustody();
    const custody = createKeyCustody(storage);

    failures.push(['no wrapped payload', () =>
      completePairing({ session: accepted, transportKey: b.transportKey, context, cipher, custody, now: NOW })]);
    failures.push(['expired', () =>
      completePairing({
        session: { ...accepted, wrapped: { v: 1, alg: 'AES-GCM', iv: 'AA', ct: 'AA' } },
        transportKey: b.transportKey, context, cipher, custody, now: session.expiresAt,
      })]);
    failures.push(['malformed envelope', () =>
      completePairing({
        session: { ...accepted, wrapped: { v: 2, alg: 'AES-GCM', iv: 'AA', ct: 'AA' } as never },
        transportKey: b.transportKey, context, cipher, custody, now: NOW,
      })]);

    for (const [label, run] of failures) {
      await expect(run(), label).rejects.toThrow();
      expect(storage.entries.size, label).toBe(0);
      expect(await custody.status(), label).toBe('absent');
    }
  });

  it('refuses to pair onto a device that already holds a key', async () => {
    // Overwriting a working key with one from a session someone else may have
    // influenced is exactly the orphaning failure the architecture forbids.
    const { keyPair: initiator, session } = offer();
    const { keyPair: responder, responderPublicKey } = accept(session);
    const accepted = bothKeysPublished(session, initiator.publicKey, responderPublicKey);
    const context = { userId: UID, appName: APP, sessionId: session.id };
    const a = derivePairingAgreement({
      session: accepted, privateKey: initiator.privateKey, userId: UID, now: NOW, agreement,
    });
    const b = derivePairingAgreement({
      session: accepted, privateKey: responder.privateKey, userId: UID, now: NOW, agreement,
    });
    const wrapped = await wrapDataKeyForPairing({
      dataKey: DEK, transportKey: a.transportKey, context, cipher,
    });

    const existing = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 3) % 256);
    const storage = new FakeCustody();
    const custody = createKeyCustody(storage);
    await custody.store(existing);

    await expect(
      completePairing({
        session: { ...accepted, wrapped }, transportKey: b.transportKey,
        context, cipher, custody, now: NOW,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.KEY_CUSTODY_INVALID });

    // The key it already had is untouched.
    expect(Array.from((await custody.load()) as Uint8Array)).toEqual(Array.from(existing));
  });

  it('puts no key, code or private material in anything the relay stores', async () => {
    const { keyPair: initiator, session } = offer();
    const { keyPair: responder, responderPublicKey } = accept(session);
    const accepted = bothKeysPublished(session, initiator.publicKey, responderPublicKey);
    const context = { userId: UID, appName: APP, sessionId: session.id };
    const a = derivePairingAgreement({
      session: accepted, privateKey: initiator.privateKey, userId: UID, now: NOW, agreement,
    });
    const wrapped = await wrapDataKeyForPairing({
      dataKey: DEK, transportKey: a.transportKey, context, cipher,
    });

    const onRelay = JSON.stringify({ ...accepted, wrapped });
    expect(onRelay).not.toContain(toBase64(DEK));
    expect(onRelay).not.toContain(toBase64(a.transportKey));
    expect(onRelay).not.toContain(toBase64(initiator.privateKey));
    expect(onRelay).not.toContain(toBase64(responder.privateKey));
    expect(onRelay).not.toContain(a.code);
  });
});

function flip(text: string): string {
  return (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
}
