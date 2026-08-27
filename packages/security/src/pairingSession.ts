import { toBase64 } from './crypto/base64';
import type { RandomBytes } from './crypto/entropy';
import type { DataKeyLifecycle } from './dataKeyLifecycle';
import { SecurityErrorCode } from './errors';
import {
  acceptPairing,
  createPairingOffer,
  derivePairingAgreement,
  pairingState,
  type PairingContext,
  type PairingEnvelope,
  type PairingSessionDocument,
} from './pairing';
import {
  P256KeyAgreement,
  type EphemeralKeyPair,
  type KeyAgreement,
} from './services/KeyAgreement';
import type { RecordCipher } from './types/recordCipher';

/**
 * Driving a pairing, as opposed to performing one.
 *
 * Gate 4 built the protocol: two ephemeral keys, a commitment, a transport key,
 * six digits and a wrapped data encryption key. What it did not build is the
 * part that decides *when* each of those steps happens, what a screen should be
 * showing while it waits, and what must happen when a step fails. That is this
 * module, and it deliberately contains no cryptography of its own — every
 * primitive it needs already exists and is called rather than reimplemented.
 *
 * The decision is separated from the driving. `pairingProgress` is a pure
 * function from (role, our key, the relay's latest snapshot, the local human
 * decision) to (what phase this is, what to do next). Everything consequential
 * is in there and is directly testable; `createPairingSession` is the loop that
 * performs the I/O the pure function asks for.
 *
 * Two properties this must never lose:
 *
 * - **No verdict is ever written.** Confirmation that the codes match is a
 *   local boolean on the device the person is looking at. It authorises this
 *   device to publish the wrapped key or to open one — it is not published,
 *   because a field a client writes is a field an attacker writes.
 * - **No failure creates a key.** There is no path from any error here to
 *   `initialize()`, to a new random key, or to recovery. A pairing that fails
 *   leaves both devices exactly as they were, and the user is told to try again
 *   or to use their recovery code — a decision they make, not one made for them.
 */

export type PairingRole = 'initiator' | 'responder';

/**
 * What the person is waiting for, named from their point of view.
 *
 * Derived, never stored. Nothing writes a phase anywhere; it is recomputed from
 * the relay document and two local booleans every time either changes.
 */
export type PairingPhase =
  | 'idle'
  | 'offering'
  | 'awaiting-peer'
  | 'compare-code'
  | 'transferring'
  | 'complete'
  | 'failed';

/** What the driver should do next. `wait` means the other device moves next. */
export type PairingAction = 'none' | 'wait' | 'accept' | 'reveal' | 'wrap' | 'adopt';

/**
 * Why a pairing stopped.
 *
 * Coarser than the underlying error codes on purpose where the difference would
 * be a hint: a wrong code, a substituted key and a tampered envelope all end as
 * failures a person is told to retry, because distinguishing them on screen
 * would tell an attacker which of their attempts got closer.
 */
export type PairingFailureReason =
  | 'session-missing'
  | 'session-invalid'
  | 'state-invalid'
  | 'expired'
  | 'consumed'
  | 'commitment-mismatch'
  | 'key-invalid'
  | 'transfer-failed'
  | 'custody-present'
  | 'custody-unusable'
  | 'custody-unavailable'
  | 'relay-unavailable'
  | 'cancelled';

export interface PairingProgress {
  phase: PairingPhase;
  action: PairingAction;
  reason: PairingFailureReason | null;
}

export interface PairingProgressInput {
  role: PairingRole;
  /** Base64 of this device's ephemeral public key; `null` before one exists. */
  ourPublicKey: string | null;
  /** The relay's latest snapshot, or `null` when there is no document. */
  session: unknown | null;
  now: number;
  /** The person said the two codes match. Local to this device, always. */
  confirmed: boolean;
  /** This device has stored the transferred key. Terminal once true. */
  adopted: boolean;
}

function waiting(phase: PairingPhase): PairingProgress {
  return { phase, action: 'wait', reason: null };
}

function failed(reason: PairingFailureReason): PairingProgress {
  return { phase: 'failed', action: 'none', reason };
}

/**
 * The whole state machine, as a pure function.
 *
 * Written as a single readable cascade rather than a transition table because
 * the ordering is the security-relevant part: expiry and consumption are tested
 * before anything that could advance the session, and a key standing where ours
 * should be is rejected before it is used.
 */
export function pairingProgress(input: PairingProgressInput): PairingProgress {
  const { role, ourPublicKey, session, now, confirmed, adopted } = input;

  // Terminal, and checked first: once this device holds the key, nothing the
  // relay subsequently says can undo that or make it act again.
  if (adopted) return { phase: 'complete', action: 'none', reason: null };
  if (ourPublicKey === null) return { phase: 'idle', action: 'none', reason: null };
  if (session === null) return failed('session-missing');

  const state = pairingState(session, now);
  if (state === 'invalid') return failed('session-invalid');
  // Before every other consideration. An aged session is dead whatever
  // progress it had made, and this is the case that fires while a person is
  // still looking at the code.
  if (state === 'expired') return failed('expired');

  const document = session as PairingSessionDocument;
  if (state === 'consumed') {
    // The trusted device learns it worked; the new device reaching this without
    // having adopted means somebody else spent the session.
    return role === 'initiator'
      ? { phase: 'complete', action: 'none', reason: null }
      : failed('consumed');
  }

  const mine = role === 'initiator' ? document.initiatorPublicKey : document.responderPublicKey;
  const theirs = role === 'initiator' ? document.responderPublicKey : document.initiatorPublicKey;

  // Someone else's key is standing in our slot. The commitment check would
  // catch a rewritten initiator key later, but this catches both roles and
  // catches them before any derivation is paid for.
  if (typeof mine === 'string' && mine !== ourPublicKey) return failed('key-invalid');

  if (typeof mine !== 'string') {
    if (role === 'responder') {
      // The new device publishes its key first, and only into a fresh offer.
      return state === 'offered'
        ? { phase: 'offering', action: 'accept', reason: null }
        : failed('state-invalid');
    }
    // The trusted device opens its commitment only once the new device has
    // committed to a key of its own. Revealing earlier is the whole attack.
    if (state === 'offered') return waiting('offering');
    if (state === 'accepted') return { phase: 'awaiting-peer', action: 'reveal', reason: null };
    // A wrapped key with no initiator key did not come from this device.
    return failed('session-invalid');
  }

  if (typeof theirs !== 'string') return waiting('awaiting-peer');

  // Both keys are published, so both sides can show digits. Nothing advances
  // until a person has looked at them.
  if (!confirmed) return { phase: 'compare-code', action: 'none', reason: null };

  if (role === 'initiator') {
    return state === 'confirmed'
      ? waiting('transferring')
      : { phase: 'transferring', action: 'wrap', reason: null };
  }
  return state === 'confirmed'
    ? { phase: 'transferring', action: 'adopt', reason: null }
    : waiting('transferring');
}

// ---- the relay port ------------------------------------------------------

/**
 * The transport, as `packages/security` sees it.
 *
 * Declared here rather than in `packages/firebase` so that nothing on the
 * pairing path depends on Firestore: `FirebasePairingRelay` implements this,
 * `InMemoryPairingRelay` implements it for tests and previews, and neither is
 * visible to the protocol. Every method moves a document; none of them decides
 * anything.
 */
export interface PairingRelay {
  create(session: PairingSessionDocument): Promise<void>;
  load(sessionId: string): Promise<unknown | null>;
  /** The new device publishes its ephemeral public key. */
  accept(sessionId: string, responderPublicKey: string): Promise<void>;
  /** The trusted device opens its commitment. */
  reveal(sessionId: string, initiatorPublicKey: string): Promise<void>;
  /** The trusted device publishes the wrapped key, after a person confirmed. */
  confirm(sessionId: string, wrapped: PairingEnvelope): Promise<void>;
  /** The new device marks the session spent. Single use. */
  consume(sessionId: string): Promise<void>;
  /** Both devices watch for the other's step. */
  watch(sessionId: string, onChange: (session: unknown | null) => void): () => void;
}

// ---- the driver ----------------------------------------------------------

/** Everything a screen may see. Deliberately no key material of any kind. */
export interface PairingSessionView {
  role: PairingRole;
  phase: PairingPhase;
  /** Travels to the other device out of band. Public, and not a secret. */
  sessionId: string | null;
  /** The six digits, once both keys are published. */
  code: string | null;
  reason: PairingFailureReason | null;
  busy: boolean;
}

export interface PairingSession {
  view(): PairingSessionView;
  subscribe(listener: (view: PairingSessionView) => void): () => void;
  /** The trusted device offers. Refuses unless this device holds the key. */
  start(): Promise<void>;
  /** The new device joins. Refuses if this device already holds a key. */
  join(sessionId: string): Promise<void>;
  /** The person says the codes match. Purely local; nothing is published. */
  confirm(): Promise<void>;
  /** Abandons the pairing. Never falls back to another path. */
  cancel(): void;
}

export interface PairingSessionOptions {
  role: PairingRole;
  relay: PairingRelay;
  lifecycle: DataKeyLifecycle;
  cipher: RecordCipher;
  randomBytes: RandomBytes;
  userId: string;
  appName: string;
  /** Injected so a test can age a session past its expiry. */
  now?: () => number;
  /** Test seam. Production builds a `P256KeyAgreement` from `randomBytes`. */
  agreement?: KeyAgreement;
  ttlMs?: number;
}

/**
 * Maps a thrown error onto a reason.
 *
 * Read structurally rather than by `instanceof`, because a relay implementation
 * lives in `packages/firebase` and raises that package's own error type — it
 * may not import a class from here.
 */
function reasonFor(error: unknown): PairingFailureReason {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case SecurityErrorCode.PAIRING_COMMITMENT_MISMATCH:
      return 'commitment-mismatch';
    case SecurityErrorCode.PAIRING_KEY_INVALID:
      return 'key-invalid';
    case SecurityErrorCode.PAIRING_EXPIRED:
      return 'expired';
    case SecurityErrorCode.PAIRING_SESSION_INVALID:
      return 'session-invalid';
    case SecurityErrorCode.PAIRING_STATE_INVALID:
      return 'state-invalid';
    case SecurityErrorCode.KEY_CUSTODY_INVALID:
      return 'custody-present';
    case SecurityErrorCode.KEY_CUSTODY_UNUSABLE:
      return 'custody-unusable';
    case SecurityErrorCode.DATA_KEY_UNAVAILABLE:
      return 'custody-unavailable';
    case SecurityErrorCode.ENCRYPTION_FAILED:
    case SecurityErrorCode.DECRYPTION_FAILED:
      return 'transfer-failed';
    default:
      // Anything else came out of the transport. A dropped connection and a
      // rejected write are the same thing to a person: it did not go through.
      return 'relay-unavailable';
  }
}

export function createPairingSession(options: PairingSessionOptions): PairingSession {
  const { role, relay, lifecycle, cipher, randomBytes, userId, appName } = options;
  const clock = options.now ?? (() => Date.now());
  const agreement = options.agreement ?? new P256KeyAgreement(randomBytes);

  let keyPair: EphemeralKeyPair | null = null;
  let ourPublicKey: string | null = null;
  let sessionId: string | null = null;
  let snapshot: unknown | null = null;
  let confirmed = false;
  let adopted = false;
  let transportKey: Uint8Array | null = null;
  let code: string | null = null;
  let phase: PairingPhase = 'idle';
  let reason: PairingFailureReason | null = null;
  let busy = false;
  /**
   * A change that arrived while a step was in flight.
   *
   * Without this the two devices deadlock: the other side's write lands while
   * this side is mid-step, the listener is dropped because a step is already
   * running, and nothing ever wakes it again. Each side then sits waiting for
   * a notification that already happened.
   */
  let pending = false;
  let unwatch: (() => void) | null = null;

  const listeners = new Set<(view: PairingSessionView) => void>();

  /**
   * Read through a function so the compiler does not narrow `phase` at one of
   * these guards and then treat the same test later in the flow as impossible —
   * every other function here can move it between the two.
   */
  function terminal(): boolean {
    return phase === 'failed' || phase === 'complete';
  }

  function view(): PairingSessionView {
    return { role, phase, sessionId, code, reason, busy };
  }

  function publish(): void {
    const next = view();
    for (const listener of listeners) listener(next);
  }

  function stopWatching(): void {
    if (unwatch) unwatch();
    unwatch = null;
  }

  function fail(next: PairingFailureReason): void {
    if (phase === 'complete') return;
    phase = 'failed';
    reason = next;
    // The transport key dies with the session. Nothing keeps it around for a
    // retry, because a retry is a new pairing with new ephemeral keys.
    if (transportKey) transportKey.fill(0);
    transportKey = null;
    stopWatching();
    publish();
  }

  const context = (): PairingContext => ({
    userId,
    appName,
    sessionId: sessionId as string,
  });

  /** Derives once, from the relay's own snapshot rather than from local state. */
  function derive(): void {
    if (transportKey !== null || keyPair === null) return;
    const agreed = derivePairingAgreement({
      session: snapshot,
      privateKey: keyPair.privateKey,
      userId,
      now: clock(),
      agreement,
    });
    transportKey = agreed.transportKey;
    code = agreed.code;
  }

  async function perform(action: PairingAction): Promise<void> {
    const id = sessionId as string;
    switch (action) {
      case 'accept': {
        await relay.accept(id, ourPublicKey as string);
        return;
      }
      case 'reveal': {
        await relay.reveal(id, ourPublicKey as string);
        return;
      }
      case 'wrap': {
        // The key comes out of custody, is wrapped, and goes back. Nothing here
        // can produce a key that was not already on this device.
        const wrapped = await lifecycle.exportForPairing({
          transportKey: transportKey as Uint8Array,
          context: context(),
          cipher,
        });
        await relay.confirm(id, wrapped);
        return;
      }
      case 'adopt': {
        await lifecycle.adoptPairedKey({
          session: snapshot,
          transportKey: transportKey as Uint8Array,
          context: context(),
          cipher,
          now: clock(),
        });
        adopted = true;
        // Single use. Marking it spent is best-effort: the key is already in
        // custody, and a relay that refuses this must not undo that.
        try {
          await relay.consume(id);
        } catch {
          stopWatching();
        }
        return;
      }
      default:
        return;
    }
  }

  /** One pass: act until the next move belongs to the other device. */
  async function runSteps(): Promise<void> {
    for (;;) {
      const progress = pairingProgress({
        role,
        ourPublicKey,
        session: snapshot,
        now: clock(),
        confirmed,
        adopted,
      });

      if (progress.phase === 'failed') {
        fail(progress.reason ?? 'session-invalid');
        return;
      }

      // Both keys are on the document from `compare-code` onward, which is
      // exactly when the transport key and the digits become computable.
      if (progress.phase === 'compare-code' || progress.phase === 'transferring') derive();

      phase = progress.phase;
      reason = null;
      if (progress.phase === 'complete') {
        stopWatching();
        return;
      }
      if (progress.action === 'none' || progress.action === 'wait') return;

      await perform(progress.action);
      // Re-read rather than patch a local copy: what the relay actually
      // stored is what the other device will see, and a write the rules
      // rejected must not look like it landed.
      snapshot = await relay.load(sessionId as string);
    }
  }

  async function advance(): Promise<void> {
    if (terminal()) return;
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    publish();
    try {
      do {
        pending = false;
        await runSteps();
      } while (pending && !terminal());
    } catch (error) {
      fail(reasonFor(error));
    } finally {
      busy = false;
      publish();
    }
  }

  function watch(): void {
    stopWatching();
    unwatch = relay.watch(sessionId as string, (next) => {
      // A watch that reports nothing is not evidence the document is gone; it
      // is what a dropped listener also looks like. Only act on real content.
      if (next === null) return;
      snapshot = next;
      void advance();
    });
  }

  return {
    view,

    subscribe(listener) {
      listeners.add(listener);
      listener(view());
      return () => listeners.delete(listener);
    },

    async start() {
      if (role !== 'initiator' || phase !== 'idle') return;
      busy = true;
      publish();
      try {
        // Only a device that actually holds the key may offer to share it.
        const state = await lifecycle.status();
        if (state === 'unusable') {
          busy = false;
          fail('custody-unusable');
          return;
        }
        if (state !== 'ready') {
          busy = false;
          fail('custody-unavailable');
          return;
        }
        const offer = createPairingOffer({
          appName,
          now: clock(),
          randomBytes,
          agreement,
          ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
        });
        keyPair = offer.keyPair;
        ourPublicKey = toBase64(offer.keyPair.publicKey);
        sessionId = offer.session.id;
        await relay.create(offer.session);
        snapshot = await relay.load(sessionId);
        watch();
      } catch (error) {
        busy = false;
        fail(reasonFor(error));
        return;
      }
      busy = false;
      await advance();
    },

    async join(id) {
      if (role !== 'responder' || phase !== 'idle') return;
      busy = true;
      publish();
      try {
        // Pairing is how a device *without* the key obtains one. A device that
        // has a key, or has one it cannot read, must never adopt over the top.
        const state = await lifecycle.status();
        if (state === 'ready') {
          busy = false;
          fail('custody-present');
          return;
        }
        if (state === 'unusable') {
          busy = false;
          fail('custody-unusable');
          return;
        }
        const loaded = await relay.load(id);
        if (loaded === null) {
          busy = false;
          fail('session-missing');
          return;
        }
        const acceptance = acceptPairing({ session: loaded, now: clock(), agreement });
        keyPair = acceptance.keyPair;
        ourPublicKey = acceptance.responderPublicKey;
        sessionId = id;
        snapshot = loaded;
        watch();
      } catch (error) {
        busy = false;
        fail(reasonFor(error));
        return;
      }
      busy = false;
      await advance();
    },

    async confirm() {
      // Only meaningful while the digits are on screen, and only ever local.
      if (phase !== 'compare-code') return;
      confirmed = true;
      await advance();
    },

    cancel() {
      if (terminal()) return;
      fail('cancelled');
    },
  };
}
