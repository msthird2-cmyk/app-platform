import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toBase64 } from '../src/crypto/base64';
import {
  createDataKeyLifecycle,
  type DataKeyLifecycle,
  type RecoveryEscrowStore,
} from '../src/dataKeyLifecycle';
import { SecurityErrorCode } from '../src/errors';
import { createKeyCustody, type CustodyStorage, type KeyCustody } from '../src/keyCustody';
import { MIN_KDF_ITERATIONS } from '../src/kdfPolicy';
import {
  acceptPairing,
  createPairingOffer,
  derivePairingAgreement,
  type PairingSessionDocument,
} from '../src/pairing';
import {
  createPairingSession,
  pairingProgress,
  type PairingRelay,
  type PairingSession,
} from '../src/pairingSession';
import type { ProtectionTier } from '../src/protectionTier';
import type { RecoveryEscrowDocument } from '../src/recoveryEscrow';
import { InMemoryPairingRelay } from '../src/services/InMemoryPairingRelay';
import { P256KeyAgreement } from '../src/services/KeyAgreement';
import { PortableRecordCipher } from '../src/services/PortableRecordCipher';
import { WebCryptoService } from '../src/services/WebCryptoService';

/**
 * Pairing as the application performs it, rather than as the protocol defines
 * it.
 *
 * `pairing.test.ts` proves the cryptography: that the commitment binds, that a
 * substituted key changes the code, that a wrapped key opens only under the
 * agreed transport secret. None of that is repeated here. What is at stake in
 * this file is the part an integration can get wrong even with correct
 * primitives — that the two sides advance in the right order, that a person's
 * confirmation gates the transfer and reaches no server, that the key which
 * arrives is byte-for-byte the one that left, and above all that no failure
 * anywhere in the sequence ends with a device holding a *different* key than it
 * had before.
 */

const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

const agreement = new P256KeyAgreement(randomBytes);
const cipher = new PortableRecordCipher(randomBytes);
const crypto = new WebCryptoService(MIN_KDF_ITERATIONS);

const UID = 'alice-uid';
const APP = 'networth';

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

/** One escrow per user, shared by every device — exactly as Firestore is. */
class SharedEscrowStore implements RecoveryEscrowStore {
  document: RecoveryEscrowDocument | null = null;
  async load(): Promise<unknown | null> {
    return this.document === null ? null : { ...this.document };
  }
  async save(document: RecoveryEscrowDocument): Promise<void> {
    this.document = document;
  }
}

interface Device {
  lifecycle: DataKeyLifecycle;
  custody: KeyCustody;
  storage: FakeCustodyStorage;
}

function device(escrowStore: RecoveryEscrowStore, userId = UID, appName = APP): Device {
  const storage = new FakeCustodyStorage();
  const custody = createKeyCustody(storage);
  return {
    storage,
    custody,
    lifecycle: createDataKeyLifecycle({
      custody,
      escrowStore,
      crypto,
      context: { userId, appName },
      randomBytes,
    }),
  };
}

/**
 * Lets both sides finish the work their listeners kicked off.
 *
 * The relay notifies synchronously and each side continues asynchronously, so a
 * test that asserted immediately would be asserting on a half-finished step.
 */
async function settle(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Pair {
  relay: InMemoryPairingRelay;
  clock: { value: number };
  trusted: Device;
  fresh: Device;
  initiator: PairingSession;
  responder: PairingSession;
  escrowStore: SharedEscrowStore;
}

/**
 * One user, one escrow, two devices — the trusted one already set up, the new
 * one empty. That is the only situation in which pairing is the right answer.
 */
async function twoDevices(options: { userId?: string; appName?: string } = {}): Promise<Pair> {
  const userId = options.userId ?? UID;
  const appName = options.appName ?? APP;
  const escrowStore = new SharedEscrowStore();
  const trusted = device(escrowStore, userId, appName);
  const fresh = device(escrowStore, userId, appName);
  await trusted.lifecycle.initialize();

  const clock = { value: 1_000_000 };
  const now = () => clock.value;
  const relay = new InMemoryPairingRelay(now);

  const build = (role: 'initiator' | 'responder', on: Device) =>
    createPairingSession({
      role,
      relay,
      lifecycle: on.lifecycle,
      cipher,
      randomBytes,
      userId,
      appName,
      now,
      agreement,
    });

  return {
    relay,
    clock,
    trusted,
    fresh,
    escrowStore,
    initiator: build('initiator', trusted),
    responder: build('responder', fresh),
  };
}

/** Runs the flow up to the point both devices are showing digits. */
async function upToCode(pair: Pair): Promise<string> {
  await pair.initiator.start();
  await settle();
  await pair.responder.join(pair.initiator.view().sessionId as string);
  await settle();
  return pair.initiator.view().code as string;
}

async function bothConfirm(pair: Pair): Promise<void> {
  await pair.responder.confirm();
  await settle();
  await pair.initiator.confirm();
  await settle();
  // The responder adopts once the wrapped key lands, which its own watch sees.
  await settle();
}

const bytes = (key: Uint8Array | null) => (key === null ? null : Array.from(key));

/**
 * A relay that rewrites what it hands back.
 *
 * The whole design assumes the transport is hostile, so the tests that matter
 * most are the ones where it behaves that way. This delegates every write to a
 * real in-memory relay — so the append-only constraints still hold on the
 * stored document — and tampers only with what the victim device reads, which
 * is exactly the power a relay actually has.
 */
class TamperingRelay implements PairingRelay {
  tamper: ((session: PairingSessionDocument) => PairingSessionDocument) | null = null;

  constructor(private readonly inner: InMemoryPairingRelay) {}

  private apply(session: unknown | null): unknown | null {
    if (session === null || this.tamper === null) return session;
    return this.tamper(session as PairingSessionDocument);
  }

  create(session: PairingSessionDocument) {
    return this.inner.create(session);
  }
  async load(sessionId: string) {
    return this.apply(await this.inner.load(sessionId));
  }
  accept(sessionId: string, responderPublicKey: string) {
    return this.inner.accept(sessionId, responderPublicKey);
  }
  reveal(sessionId: string, initiatorPublicKey: string) {
    return this.inner.reveal(sessionId, initiatorPublicKey);
  }
  confirm(sessionId: string, wrapped: { v: number; alg: 'AES-GCM'; iv: string; ct: string }) {
    return this.inner.confirm(sessionId, wrapped);
  }
  consume(sessionId: string) {
    return this.inner.consume(sessionId);
  }
  watch(sessionId: string, onChange: (session: unknown | null) => void) {
    return this.inner.watch(sessionId, (session) => onChange(this.apply(session)));
  }
}

/**
 * The trusted device and a victim device on a relay the test controls.
 *
 * Built by hand rather than through `twoDevices` because these tests need to
 * start tampering partway through, which means holding the relay wrapper.
 */
async function tamperedPair(): Promise<{
  relay: TamperingRelay;
  clock: { value: number };
  trusted: Device;
  fresh: Device;
  initiator: PairingSession;
  responder: PairingSession;
}> {
  const escrowStore = new SharedEscrowStore();
  const trusted = device(escrowStore);
  const fresh = device(escrowStore);
  await trusted.lifecycle.initialize();

  const clock = { value: 1_000_000 };
  const now = () => clock.value;
  const relay = new TamperingRelay(new InMemoryPairingRelay(now));
  const build = (role: 'initiator' | 'responder', on: Device) =>
    createPairingSession({
      role,
      relay,
      lifecycle: on.lifecycle,
      cipher,
      randomBytes,
      userId: UID,
      appName: APP,
      now,
      agreement,
    });
  return {
    relay,
    clock,
    trusted,
    fresh,
    initiator: build('initiator', trusted),
    responder: build('responder', fresh),
  };
}

// ---- A–H: the flow that is supposed to work ------------------------------

describe('A/B — starting and joining', () => {
  it('has the trusted device publish an offer and wait', async () => {
    const pair = await twoDevices();
    await pair.initiator.start();
    await settle();
    expect(pair.initiator.view().phase).toBe('offering');
    expect(pair.initiator.view().sessionId).toMatch(/^[A-Za-z0-9]{1,22}$/);

    const session = (await pair.relay.load(
      pair.initiator.view().sessionId as string,
    )) as PairingSessionDocument;
    // The commitment goes out; the key does not. Publishing the key here is
    // exactly what would make six digits forgeable.
    expect(session.commitment.length).toBeGreaterThan(0);
    expect(session.initiatorPublicKey ?? null).toBeNull();
  });

  it('refuses to offer from a device that does not hold the key', async () => {
    const escrowStore = new SharedEscrowStore();
    const empty = device(escrowStore);
    const relay = new InMemoryPairingRelay();
    const session = createPairingSession({
      role: 'initiator',
      relay,
      lifecycle: empty.lifecycle,
      cipher,
      randomBytes,
      userId: UID,
      appName: APP,
      agreement,
    });
    await session.start();
    expect(session.view().phase).toBe('failed');
    expect(session.view().reason).toBe('custody-unavailable');
  });

  it('has the new device join and publish its own key', async () => {
    const pair = await twoDevices();
    await pair.initiator.start();
    await settle();
    await pair.responder.join(pair.initiator.view().sessionId as string);
    await settle();
    const session = (await pair.relay.load(
      pair.initiator.view().sessionId as string,
    )) as PairingSessionDocument;
    expect(typeof session.responderPublicKey).toBe('string');
    // Only now does the trusted device open its commitment.
    expect(typeof session.initiatorPublicKey).toBe('string');
  });
});

describe('C — the verification code', () => {
  it('shows the same six digits on both devices', async () => {
    const pair = await twoDevices();
    const code = await upToCode(pair);
    expect(code).toMatch(/^\d{3}-\d{3}$/);
    expect(pair.responder.view().code).toBe(code);
    expect(pair.initiator.view().phase).toBe('compare-code');
    expect(pair.responder.view().phase).toBe('compare-code');
  });

  it('transfers nothing until a person confirms', async () => {
    const pair = await twoDevices();
    await upToCode(pair);
    const session = (await pair.relay.load(
      pair.initiator.view().sessionId as string,
    )) as PairingSessionDocument;
    expect(session.wrapped ?? null).toBeNull();
    expect(await pair.fresh.custody.status()).toBe('absent');
  });

  it('writes no verdict of any kind to the relay', async () => {
    const pair = await twoDevices();
    await upToCode(pair);
    await bothConfirm(pair);
    const stored = (await pair.relay.load(
      pair.initiator.view().sessionId as string,
    )) as Record<string, unknown>;
    // The confirmation is a local boolean on each device. Nothing about it
    // reaches the transport, because a field a client writes is a field an
    // attacker writes.
    for (const banned of ['verified', 'isVerified', 'approved', 'status', 'pairingStatus']) {
      expect(banned in stored).toBe(false);
    }
    expect(JSON.stringify(stored)).not.toContain(pair.initiator.view().code);
  });
});

describe('D–H — the key moves, and only the key', () => {
  it('ends with both devices holding the identical key', async () => {
    const pair = await twoDevices();
    const before = await pair.trusted.custody.load();
    await upToCode(pair);
    await bothConfirm(pair);

    expect(pair.initiator.view().phase).toBe('complete');
    expect(pair.responder.view().phase).toBe('complete');

    // F/G: the new device stores exactly what the trusted device holds.
    expect(bytes(await pair.fresh.custody.load())).toEqual(bytes(before));
    // H: and the trusted device's own key is untouched by the transfer.
    expect(bytes(await pair.trusted.custody.load())).toEqual(bytes(before));
  });

  it('puts the key on the relay only as ciphertext', async () => {
    const pair = await twoDevices();
    const dek = (await pair.trusted.custody.load()) as Uint8Array;
    await upToCode(pair);
    await bothConfirm(pair);
    const stored = JSON.stringify(
      await pair.relay.load(pair.initiator.view().sessionId as string),
    );
    expect(stored).not.toContain(toBase64(dek));
    // E: what is there is the wrapped envelope, and nothing else key-shaped.
    const session = (await pair.relay.load(
      pair.initiator.view().sessionId as string,
    )) as PairingSessionDocument;
    expect(session.wrapped?.alg).toBe('AES-GCM');
    expect(Object.keys(session.wrapped ?? {}).sort()).toEqual(['alg', 'ct', 'iv', 'v']);
  });

  it('never generates a key on the receiving device', async () => {
    const pair = await twoDevices();
    const dek = (await pair.trusted.custody.load()) as Uint8Array;
    await upToCode(pair);
    await bothConfirm(pair);
    // P, positively stated: the only key that ever exists is the first one.
    expect(bytes(await pair.fresh.custody.load())).toEqual(bytes(dek));
    expect(pair.escrowStore.document).not.toBeNull();
  });
});

// ---- I–O: the failures ---------------------------------------------------

describe('I/J — a code that does not match', () => {
  it('transfers nothing when the person does not confirm', async () => {
    const pair = await twoDevices();
    await upToCode(pair);
    pair.initiator.cancel();
    pair.responder.cancel();
    await settle();
    expect(pair.initiator.view().reason).toBe('cancelled');
    expect(await pair.fresh.custody.status()).toBe('absent');
  });

  it('refuses a public key the commitment does not open to', async () => {
    const pair = await tamperedPair();
    await pair.initiator.start();
    await settle();

    // The relay swaps its own key in on the way to the new device, after it has
    // seen the responder's — the attack the commitment exists to catch.
    const attacker = agreement.generate();
    pair.relay.tamper = (session) =>
      session.initiatorPublicKey === null || session.initiatorPublicKey === undefined
        ? session
        : { ...session, initiatorPublicKey: toBase64(attacker.publicKey) };

    await pair.responder.join(pair.initiator.view().sessionId as string);
    await settle();

    expect(pair.responder.view().phase).toBe('failed');
    expect(pair.responder.view().reason).toBe('commitment-mismatch');
    expect(pair.responder.view().code).toBeNull();
    expect(await pair.fresh.custody.status()).toBe('absent');
  });
});

describe('K/L — expiry and replay', () => {
  it('fails a pairing whose window closes while a person is looking at it', async () => {
    const pair = await twoDevices();
    await upToCode(pair);
    pair.clock.value += 10 * 60 * 1000;
    await pair.initiator.confirm();
    await settle();
    expect(pair.initiator.view().phase).toBe('failed');
    expect(pair.initiator.view().reason).toBe('expired');
    expect(await pair.fresh.custody.status()).toBe('absent');
  });

  it('refuses to replay a session that was already spent', async () => {
    const pair = await twoDevices();
    await upToCode(pair);
    await bothConfirm(pair);
    const id = pair.initiator.view().sessionId as string;

    const third = device(pair.escrowStore);
    const replay = createPairingSession({
      role: 'responder',
      relay: pair.relay,
      lifecycle: third.lifecycle,
      cipher,
      randomBytes,
      userId: UID,
      appName: APP,
      now: () => pair.clock.value,
      agreement,
    });
    await replay.join(id);
    await settle();
    expect(replay.view().phase).toBe('failed');
    expect(await third.custody.status()).toBe('absent');
  });
});

describe('M/N — a pairing from somewhere else', () => {
  /**
   * A genuine, correctly agreed transport key, used under the wrong identity.
   *
   * Tested through the lifecycle's own entry points rather than the driver,
   * because the driver would refuse a foreign session earlier and the point
   * here is what happens if it did not: the identity is bound into both the
   * HKDF info and the AEAD's additional data, so the envelope does not open at
   * all rather than opening and being rejected afterwards.
   */
  async function wrappedForRealPairing() {
    const escrowStore = new SharedEscrowStore();
    const trusted = device(escrowStore);
    await trusted.lifecycle.initialize();

    const offer = createPairingOffer({ appName: APP, now: 1000, randomBytes, agreement });
    const acceptance = acceptPairing({ session: offer.session, now: 1000, agreement });
    const published: PairingSessionDocument = {
      ...offer.session,
      responderPublicKey: acceptance.responderPublicKey,
      initiatorPublicKey: toBase64(offer.keyPair.publicKey),
    };
    const context = { userId: UID, appName: APP, sessionId: published.id };
    const sideA = derivePairingAgreement({
      session: published,
      privateKey: offer.keyPair.privateKey,
      userId: UID,
      now: 1000,
      agreement,
    });
    const sideB = derivePairingAgreement({
      session: published,
      privateKey: acceptance.keyPair.privateKey,
      userId: UID,
      now: 1000,
      agreement,
    });
    const wrapped = await trusted.lifecycle.exportForPairing({
      transportKey: sideA.transportKey,
      context,
      cipher,
    });
    return { escrowStore, trusted, published, wrapped, transportKey: sideB.transportKey };
  }

  it('cannot be opened under another user', async () => {
    const { published, wrapped, transportKey } = await wrappedForRealPairing();
    const outsider = device(new SharedEscrowStore(), 'mallory-uid', APP);
    await expect(
      outsider.lifecycle.adoptPairedKey({
        session: { ...published, wrapped },
        transportKey,
        context: { userId: 'mallory-uid', appName: APP, sessionId: published.id },
        cipher,
        now: 1000,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
    expect(await outsider.custody.status()).toBe('absent');
  });

  it('cannot be opened under another application', async () => {
    const { published, wrapped, transportKey } = await wrappedForRealPairing();
    const other = device(new SharedEscrowStore(), UID, 'expense');
    await expect(
      other.lifecycle.adoptPairedKey({
        session: { ...published, wrapped },
        transportKey,
        context: { userId: UID, appName: 'expense', sessionId: published.id },
        cipher,
        now: 1000,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
    expect(await other.custody.status()).toBe('absent');
  });

  it('cannot be opened under another session', async () => {
    const { published, wrapped, transportKey } = await wrappedForRealPairing();
    const other = device(new SharedEscrowStore());
    await expect(
      other.lifecycle.adoptPairedKey({
        session: { ...published, wrapped },
        transportKey,
        context: { userId: UID, appName: APP, sessionId: 'a-different-session' },
        cipher,
        now: 1000,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
    expect(await other.custody.status()).toBe('absent');
  });
});

describe('O — a corrupted transfer', () => {
  it('fails closed and leaves custody empty', async () => {
    const pair = await tamperedPair();
    await pair.initiator.start();
    await settle();
    await pair.responder.join(pair.initiator.view().sessionId as string);
    await settle();
    expect(pair.responder.view().code).toBe(pair.initiator.view().code);

    // Armed before the wrapped key is published, because that is when the
    // relay would corrupt it — the new device only ever sees what the relay
    // hands it, and a device that re-read afterwards would be re-reading from
    // the same untrusted source.
    pair.relay.tamper = (session) =>
      session.wrapped
        ? {
            ...session,
            wrapped: {
              ...session.wrapped,
              ct: session.wrapped.ct.startsWith('A')
                ? `B${session.wrapped.ct.slice(1)}`
                : `A${session.wrapped.ct.slice(1)}`,
            },
          }
        : session;

    await pair.initiator.confirm();
    await settle();
    await pair.responder.confirm();
    await settle();

    expect(pair.responder.view().phase).toBe('failed');
    expect(pair.responder.view().reason).toBe('transfer-failed');
    // The tag failed, so `custody.store` was never reached.
    expect(await pair.fresh.custody.status()).toBe('absent');
  });
});

// ---- P–R: what must not happen -------------------------------------------

describe('P/Q — no failure ever mints a key', () => {
  it('leaves an empty device empty after every failure mode', async () => {
    const reasons: string[] = [];
    for (const break_ of ['expire', 'cancel', 'missing', 'relay'] as const) {
      const pair = await twoDevices();
      if (break_ === 'missing') {
        await pair.responder.join('no-such-session');
      } else if (break_ === 'relay') {
        const broken: PairingRelay = {
          ...pair.relay,
          load: async () => {
            throw new Error('offline');
          },
          watch: () => () => undefined,
          create: pair.relay.create.bind(pair.relay),
          accept: pair.relay.accept.bind(pair.relay),
          reveal: pair.relay.reveal.bind(pair.relay),
          confirm: pair.relay.confirm.bind(pair.relay),
          consume: pair.relay.consume.bind(pair.relay),
        };
        const offline = createPairingSession({
          role: 'responder',
          relay: broken,
          lifecycle: pair.fresh.lifecycle,
          cipher,
          randomBytes,
          userId: UID,
          appName: APP,
          now: () => pair.clock.value,
          agreement,
        });
        await offline.join('anything');
        reasons.push(offline.view().reason as string);
        expect(await pair.fresh.custody.status()).toBe('absent');
        continue;
      } else {
        await upToCode(pair);
        if (break_ === 'expire') pair.clock.value += 10 * 60 * 1000;
        else pair.responder.cancel();
        await pair.responder.confirm();
        await settle();
      }
      // The invariant, restated for each: nothing here creates a key, so an
      // empty device is still empty and the trusted device still holds one.
      expect(await pair.fresh.custody.status()).toBe('absent');
      expect(await pair.trusted.custody.status()).toBe('present');
      reasons.push(pair.responder.view().reason ?? 'none');
    }
    expect(reasons).toContain('session-missing');
    expect(reasons).toContain('relay-unavailable');
  });

  it('does not replace the key on a device that already has one', async () => {
    const pair = await twoDevices();
    // The new device is set up in its own right first, which is the situation
    // pairing must refuse rather than resolve.
    const already = device(pair.escrowStore);
    await already.custody.store(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
    const before = await already.custody.load();

    const session = createPairingSession({
      role: 'responder',
      relay: pair.relay,
      lifecycle: already.lifecycle,
      cipher,
      randomBytes,
      userId: UID,
      appName: APP,
      now: () => pair.clock.value,
      agreement,
    });
    await pair.initiator.start();
    await settle();
    await session.join(pair.initiator.view().sessionId as string);
    await settle();
    expect(session.view().phase).toBe('failed');
    expect(session.view().reason).toBe('custody-present');
    expect(bytes(await already.custody.load())).toEqual(bytes(before));
  });

  it('refuses to pair over a stored key it cannot read', async () => {
    const pair = await twoDevices();
    const broken = device(pair.escrowStore);
    // What an Android keystore invalidated by a lock-screen change looks like.
    broken.storage.entries.set('platform.dek.v1', 'not-an-envelope');
    const session = createPairingSession({
      role: 'responder',
      relay: pair.relay,
      lifecycle: broken.lifecycle,
      cipher,
      randomBytes,
      userId: UID,
      appName: APP,
      now: () => pair.clock.value,
      agreement,
    });
    await pair.initiator.start();
    await settle();
    await session.join(pair.initiator.view().sessionId as string);
    await settle();
    expect(session.view().reason).toBe('custody-unusable');
    // Untouched: overwriting it would orphan every record under the old key.
    expect(broken.storage.entries.get('platform.dek.v1')).toBe('not-an-envelope');
  });

  it('reports the same state after a restart as before the failed pairing', async () => {
    const pair = await twoDevices();
    await upToCode(pair);
    pair.clock.value += 10 * 60 * 1000;
    await pair.responder.confirm();
    await settle();
    // Q: a new lifecycle over the same storage — a relaunch — still sees a
    // device that needs recovery, not one that needs a brand new key.
    const restarted = createDataKeyLifecycle({
      custody: createKeyCustody(pair.fresh.storage),
      escrowStore: pair.escrowStore,
      crypto,
      context: { userId: UID, appName: APP },
      randomBytes,
    });
    expect(await restarted.status()).toBe('needs-recovery');
  });
});

describe('R — recovery is untouched', () => {
  it('still works after a pairing has failed', async () => {
    const escrowStore = new SharedEscrowStore();
    const trusted = device(escrowStore);
    const { recoveryCode } = await trusted.lifecycle.initialize();
    const dek = await trusted.custody.load();

    const fresh = device(escrowStore);
    const relay = new InMemoryPairingRelay();
    const failing = createPairingSession({
      role: 'responder',
      relay,
      lifecycle: fresh.lifecycle,
      cipher,
      randomBytes,
      userId: UID,
      appName: APP,
      agreement,
    });
    await failing.join('missing-session');
    expect(failing.view().phase).toBe('failed');

    // The escrow was never involved, so the recovery path is exactly as it was.
    expect(bytes(await fresh.lifecycle.recover(recoveryCode))).toEqual(bytes(dek));
    expect(await fresh.lifecycle.status()).toBe('ready');
  });

  it('still works after a pairing has succeeded on a different device', async () => {
    const escrowStore = new SharedEscrowStore();
    const trusted = device(escrowStore);
    const { recoveryCode } = await trusted.lifecycle.initialize();
    const dek = await trusted.custody.load();
    const third = device(escrowStore);
    expect(bytes(await third.lifecycle.recover(recoveryCode))).toEqual(bytes(dek));
  });
});

// ---- the lifecycle's own refusals ----------------------------------------

describe('DataKeyLifecycle pairing entry points', () => {
  it('refuses to export a key the device does not have', async () => {
    const empty = device(new SharedEscrowStore());
    await expect(
      empty.lifecycle.exportForPairing({
        transportKey: new Uint8Array(32).fill(9),
        context: { userId: UID, appName: APP, sessionId: 'session' },
        cipher,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DATA_KEY_UNAVAILABLE });
  });

  it('refuses to export from a device whose stored key is unreadable', async () => {
    const broken = device(new SharedEscrowStore());
    broken.storage.entries.set('platform.dek.v1', '{}');
    await expect(
      broken.lifecycle.exportForPairing({
        transportKey: new Uint8Array(32).fill(9),
        context: { userId: UID, appName: APP, sessionId: 'session' },
        cipher,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.KEY_CUSTODY_UNUSABLE });
  });

  it('refuses to adopt over a key that is already present', async () => {
    const store = new SharedEscrowStore();
    const held = device(store);
    await held.lifecycle.initialize();
    await expect(
      held.lifecycle.adoptPairedKey({
        session: null,
        transportKey: new Uint8Array(32).fill(9),
        context: { userId: UID, appName: APP, sessionId: 'session' },
        cipher,
        now: 1,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.KEY_CUSTODY_INVALID });
  });

  it('refuses to adopt over a key it cannot read', async () => {
    const broken = device(new SharedEscrowStore());
    broken.storage.entries.set('platform.dek.v1', '{}');
    await expect(
      broken.lifecycle.adoptPairedKey({
        session: null,
        transportKey: new Uint8Array(32).fill(9),
        context: { userId: UID, appName: APP, sessionId: 'session' },
        cipher,
        now: 1,
      }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.KEY_CUSTODY_UNUSABLE });
  });
});

// ---- the pure decision ---------------------------------------------------

describe('pairingProgress', () => {
  const base: PairingSessionDocument = {
    id: 'session',
    version: 1,
    appName: APP,
    commitment: 'commitment',
    createdAt: 1000,
    expiresAt: 2000,
  };

  it('does nothing at all before this device has a key of its own', () => {
    expect(
      pairingProgress({
        role: 'initiator',
        ourPublicKey: null,
        session: base,
        now: 1500,
        confirmed: false,
        adopted: false,
      }),
    ).toEqual({ phase: 'idle', action: 'none', reason: null });
  });

  it('treats expiry as terminal however far the session had got', () => {
    for (const session of [
      base,
      { ...base, responderPublicKey: 'them' },
      { ...base, responderPublicKey: 'them', initiatorPublicKey: 'us' },
    ]) {
      expect(
        pairingProgress({
          role: 'initiator',
          ourPublicKey: 'us',
          session,
          now: 9999,
          confirmed: true,
          adopted: false,
        }),
      ).toMatchObject({ phase: 'failed', reason: 'expired' });
    }
  });

  it('refuses when somebody else’s key is standing in our slot', () => {
    expect(
      pairingProgress({
        role: 'responder',
        ourPublicKey: 'ours',
        session: { ...base, responderPublicKey: 'someone-else' },
        now: 1500,
        confirmed: false,
        adopted: false,
      }),
    ).toMatchObject({ phase: 'failed', reason: 'key-invalid' });
  });

  it('never lets the trusted device open its commitment first', () => {
    expect(
      pairingProgress({
        role: 'initiator',
        ourPublicKey: 'us',
        session: base,
        now: 1500,
        confirmed: false,
        adopted: false,
      }),
    ).toEqual({ phase: 'offering', action: 'wait', reason: null });
  });

  it('holds at the code until a person has confirmed, on both sides', () => {
    const both = { ...base, responderPublicKey: 'them', initiatorPublicKey: 'us' };
    for (const role of ['initiator', 'responder'] as const) {
      const ourPublicKey = role === 'initiator' ? 'us' : 'them';
      expect(
        pairingProgress({
          role,
          ourPublicKey,
          session: both,
          now: 1500,
          confirmed: false,
          adopted: false,
        }),
      ).toEqual({ phase: 'compare-code', action: 'none', reason: null });
    }
  });

  it('wraps only after confirmation, and adopts only once wrapped', () => {
    const both = { ...base, responderPublicKey: 'them', initiatorPublicKey: 'us' };
    expect(
      pairingProgress({
        role: 'initiator',
        ourPublicKey: 'us',
        session: both,
        now: 1500,
        confirmed: true,
        adopted: false,
      }).action,
    ).toBe('wrap');
    expect(
      pairingProgress({
        role: 'responder',
        ourPublicKey: 'them',
        session: both,
        now: 1500,
        confirmed: true,
        adopted: false,
      }).action,
    ).toBe('wait');
    expect(
      pairingProgress({
        role: 'responder',
        ourPublicKey: 'them',
        session: { ...both, wrapped: { v: 1, alg: 'AES-GCM', iv: 'iv', ct: 'ct' } },
        now: 1500,
        confirmed: true,
        adopted: false,
      }).action,
    ).toBe('adopt');
  });

  it('reports a missing document rather than inventing a state for it', () => {
    expect(
      pairingProgress({
        role: 'responder',
        ourPublicKey: 'ours',
        session: null,
        now: 1500,
        confirmed: false,
        adopted: false,
      }),
    ).toMatchObject({ phase: 'failed', reason: 'session-missing' });
  });

  it('reports a malformed document as invalid, not as an empty one', () => {
    expect(
      pairingProgress({
        role: 'responder',
        ourPublicKey: 'ours',
        session: { id: 'session', nonsense: true },
        now: 1500,
        confirmed: false,
        adopted: false,
      }),
    ).toMatchObject({ phase: 'failed', reason: 'session-invalid' });
  });

  it('is terminal once this device has adopted, whatever the relay says next', () => {
    expect(
      pairingProgress({
        role: 'responder',
        ourPublicKey: 'ours',
        session: null,
        now: 9999,
        confirmed: true,
        adopted: true,
      }),
    ).toEqual({ phase: 'complete', action: 'none', reason: null });
  });
});
