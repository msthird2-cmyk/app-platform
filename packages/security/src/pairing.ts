import { fromBase64, toBase64 } from './crypto/base64';
import { drawRandomBytes, type RandomBytes } from './crypto/entropy';
import { utf8Encode } from './crypto/utf8';
import {
  commitmentMatches,
  commitToPublicKey,
  verificationCode,
} from './crypto/verificationCode';
import { SecurityError, SecurityErrorCode } from './errors';
import type { KeyCustody } from './keyCustody';
import { PUBLIC_KEY_BYTES, type EphemeralKeyPair, type KeyAgreement } from './services/KeyAgreement';
import type { RecordCipher } from './types/recordCipher';

/**
 * Trusted-device pairing: how a second device obtains the data encryption key
 * without a recovery code and without the server ever holding it.
 *
 * The shape of the protocol is forced by two facts. Firebase Spark provides no
 * trusted server, so nothing can adjudicate the pairing; and a short code a
 * person can compare is only safe if the initiator commits to its key before
 * the responder reveals one. What follows is therefore a commitment-based
 * short-authentication-string exchange over ephemeral ECDH, with the relay
 * carrying public material and ciphertext and nothing else.
 *
 *   trusted device                relay                    new device
 *   --------------                -----                    ----------
 *   ephemeral pair
 *   H(pub_A)              ──────▶ offered
 *                                                          ephemeral pair
 *                                 accepted ◀────────────── pub_B
 *   pub_A (opens commit)  ──────▶
 *                                 ── both derive transport key ──
 *                                 ── both show the same 6 digits ──
 *   person compares, confirms
 *   wrap(DEK, transport)  ──────▶ confirmed
 *                                          wrapped DEK ──▶ unwrap, validate
 *                                 consumed ◀────────────── store via custody
 *
 * There is no `verified` field anywhere, in Firestore or in this module. The
 * relay records no verdict, because a verdict a client can write is a verdict
 * an attacker can write. What gates the transfer is that the trusted device
 * only publishes the wrapped key after a person has compared the digits, and
 * the wrapped key only opens under a transport secret a man in the middle
 * cannot hold. The check is the decryption, exactly as it is for the recovery
 * escrow.
 *
 * Nothing here creates a data encryption key. Pairing transfers the one that
 * already exists; every failure leaves both devices exactly as they were.
 */

export const PAIRING_VERSION = 1;
const PAIRING_PURPOSE = 'pairing.transport.v1';
const SESSION_ID_BYTES = 16;
const DEK_BYTES = 32;

/** Long enough for a person to fetch the other device, short enough to matter. */
export const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;

/**
 * The session as it exists on the relay.
 *
 * State is *derived* from which fields are present rather than stored as a
 * status string. That is deliberate: a status field is something a client
 * writes, and therefore something a client can lie about. Presence of a
 * commitment, a responder key, a wrapped payload or a consumption timestamp is
 * evidence of an action having been taken, not an assertion about it.
 */
export interface PairingSessionDocument {
  id: string;
  version: number;
  appName: string;
  /** H(initiator public key), published before the responder reveals its own. */
  commitment: string;
  createdAt: number;
  expiresAt: number;
  /** Base64 compressed P-256 point, revealed only after the responder's. */
  initiatorPublicKey?: string | null;
  responderPublicKey?: string | null;
  /** The DEK under the transport key. Never the DEK. */
  wrapped?: PairingEnvelope | null;
  consumedAt?: number | null;
}

export interface PairingEnvelope {
  v: number;
  alg: 'AES-GCM';
  iv: string;
  ct: string;
}

/**
 * Explicit states, and the order they are tested in.
 *
 * `consumed` outranks `expired` because consumption is terminal — a session
 * that completed and then aged out is finished, not reopenable. `expired`
 * outranks everything else so that an aged session cannot be advanced no matter
 * how far it had progressed.
 */
export type PairingState =
  | 'offered'
  | 'accepted'
  | 'confirmed'
  | 'consumed'
  | 'expired'
  | 'invalid';

function isEnvelope(value: unknown): value is PairingEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const envelope = value as PairingEnvelope;
  return (
    typeof envelope.v === 'number' &&
    envelope.alg === 'AES-GCM' &&
    typeof envelope.iv === 'string' &&
    typeof envelope.ct === 'string'
  );
}

/** Shape only. Whether the state permits an operation is decided separately. */
export function assertPairingSession(value: unknown): asserts value is PairingSessionDocument {
  if (typeof value !== 'object' || value === null) {
    throw new SecurityError(SecurityErrorCode.PAIRING_SESSION_INVALID);
  }
  const session = value as PairingSessionDocument;
  if (
    typeof session.id !== 'string' ||
    typeof session.appName !== 'string' ||
    typeof session.commitment !== 'string' ||
    typeof session.createdAt !== 'number' ||
    typeof session.expiresAt !== 'number' ||
    session.expiresAt <= session.createdAt
  ) {
    throw new SecurityError(SecurityErrorCode.PAIRING_SESSION_INVALID);
  }
  if (session.version !== PAIRING_VERSION) {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED);
  }
  for (const key of ['initiatorPublicKey', 'responderPublicKey'] as const) {
    const value = session[key];
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new SecurityError(SecurityErrorCode.PAIRING_SESSION_INVALID);
    }
  }
  if (session.wrapped !== undefined && session.wrapped !== null && !isEnvelope(session.wrapped)) {
    throw new SecurityError(SecurityErrorCode.PAIRING_SESSION_INVALID);
  }
}

export function pairingState(session: unknown, now: number): PairingState {
  try {
    assertPairingSession(session);
  } catch {
    return 'invalid';
  }
  if (typeof session.consumedAt === 'number') return 'consumed';
  if (now >= session.expiresAt) return 'expired';
  if (session.wrapped) return 'confirmed';
  if (session.responderPublicKey) return 'accepted';
  return 'offered';
}

export interface PairingContext {
  userId: string;
  appName: string;
  sessionId: string;
}

/**
 * Everything that identifies this pairing, bound into the transport key itself.
 *
 * Bound in the HKDF `info` rather than only in the AEAD's additional data, so a
 * wrapped key from another user, application or session is not merely
 * unauthenticated — the transport key derived for it is a different key, and
 * the ciphertext cannot be opened at all.
 */
function transportInfo(context: PairingContext, initiator: Uint8Array, responder: Uint8Array): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      pur: PAIRING_PURPOSE,
      v: PAIRING_VERSION,
      uid: context.userId,
      app: context.appName,
      sid: context.sessionId,
      a: toBase64(initiator),
      b: toBase64(responder),
    }),
  );
}

/** The same identity again as AEAD additional data. Defence in depth. */
function transportAad(context: PairingContext): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      v: PAIRING_VERSION,
      alg: 'AES-GCM',
      pur: PAIRING_PURPOSE,
      uid: context.userId,
      app: context.appName,
      sid: context.sessionId,
    }),
  );
}

function decodePublicKey(value: string | null | undefined): Uint8Array {
  if (typeof value !== 'string') throw new SecurityError(SecurityErrorCode.PAIRING_KEY_INVALID);
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(value);
  } catch (cause) {
    throw new SecurityError(SecurityErrorCode.PAIRING_KEY_INVALID, cause);
  }
  if (bytes.length !== PUBLIC_KEY_BYTES) {
    throw new SecurityError(SecurityErrorCode.PAIRING_KEY_INVALID);
  }
  return bytes;
}

function assertDataKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== DEK_BYTES) {
    throw new SecurityError(SecurityErrorCode.DATA_KEY_UNAVAILABLE);
  }
  let anySet = 0;
  for (const byte of key) anySet |= byte;
  if (anySet === 0) throw new SecurityError(SecurityErrorCode.DATA_KEY_UNAVAILABLE);
}

function assertActive(session: PairingSessionDocument, now: number, allowed: PairingState): void {
  const state = pairingState(session, now);
  if (state === 'expired') throw new SecurityError(SecurityErrorCode.PAIRING_EXPIRED);
  if (state !== allowed) throw new SecurityError(SecurityErrorCode.PAIRING_STATE_INVALID);
}

// ---- step 1: the trusted device offers -----------------------------------

export interface PairingOffer {
  /** Kept on the trusted device only. Never written anywhere. */
  keyPair: EphemeralKeyPair;
  session: PairingSessionDocument;
}

export function createPairingOffer(options: {
  appName: string;
  now: number;
  randomBytes: RandomBytes;
  agreement: KeyAgreement;
  ttlMs?: number;
}): PairingOffer {
  const { appName, now, randomBytes, agreement } = options;
  const ttlMs = options.ttlMs ?? DEFAULT_PAIRING_TTL_MS;
  const keyPair = agreement.generate();
  const sessionId = toBase64(drawRandomBytes(randomBytes, SESSION_ID_BYTES))
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 22);

  return {
    keyPair,
    session: {
      id: sessionId,
      version: PAIRING_VERSION,
      appName,
      // Only the commitment. Publishing the key here would let a relay grind
      // its own pair against it and forge a matching code.
      commitment: commitToPublicKey(keyPair.publicKey),
      createdAt: now,
      expiresAt: now + ttlMs,
      initiatorPublicKey: null,
      responderPublicKey: null,
      wrapped: null,
      consumedAt: null,
    },
  };
}

// ---- step 2: the new device accepts --------------------------------------

export interface PairingAcceptance {
  keyPair: EphemeralKeyPair;
  responderPublicKey: string;
}

export function acceptPairing(options: {
  session: unknown;
  now: number;
  agreement: KeyAgreement;
}): PairingAcceptance {
  const { session, now, agreement } = options;
  assertPairingSession(session);
  assertActive(session, now, 'offered');
  const keyPair = agreement.generate();
  return { keyPair, responderPublicKey: toBase64(keyPair.publicKey) };
}

// ---- step 3: both sides derive, and show the same digits -----------------

export interface PairingAgreement {
  transportKey: Uint8Array;
  code: string;
}

/**
 * Derives the transport key and the code from a session both keys are in.
 *
 * The commitment is checked here, on both sides. The responder checks it
 * because that is the whole point; the initiator checks its own because a relay
 * that rewrote the commitment would otherwise go unnoticed until later.
 */
export function derivePairingAgreement(options: {
  session: unknown;
  privateKey: Uint8Array;
  userId: string;
  now: number;
  agreement: KeyAgreement;
}): PairingAgreement {
  const { session, privateKey, userId, now, agreement } = options;
  assertPairingSession(session);

  const state = pairingState(session, now);
  if (state === 'expired') throw new SecurityError(SecurityErrorCode.PAIRING_EXPIRED);
  if (state === 'consumed' || state === 'invalid' || state === 'offered') {
    throw new SecurityError(SecurityErrorCode.PAIRING_STATE_INVALID);
  }

  const initiator = decodePublicKey(session.initiatorPublicKey);
  const responder = decodePublicKey(session.responderPublicKey);

  if (!commitmentMatches(initiator, session.commitment)) {
    throw new SecurityError(SecurityErrorCode.PAIRING_COMMITMENT_MISMATCH);
  }

  const context: PairingContext = {
    userId,
    appName: session.appName,
    sessionId: session.id,
  };
  const peer = peerOf(privateKey, initiator, responder, agreement);

  return {
    transportKey: agreement.deriveTransportKey(
      privateKey,
      peer,
      utf8Encode(session.id),
      transportInfo(context, initiator, responder),
    ),
    code: verificationCode(initiator, responder, context),
  };
}

/**
 * Picks the peer key by elimination.
 *
 * A device holds one private key and is not told which role it played, so it
 * derives its own public key and takes the other one. Refusing when neither
 * matches matters: it means the caller is holding a key from a different
 * session, and deriving against an unrelated point would produce a transport
 * key that fails later with a confusing error instead of here with a clear one.
 */
function peerOf(
  privateKey: Uint8Array,
  initiator: Uint8Array,
  responder: Uint8Array,
  agreement: KeyAgreement,
): Uint8Array {
  const ours = agreement.publicKeyOf(privateKey);
  if (equalBytes(ours, initiator)) return responder;
  if (equalBytes(ours, responder)) return initiator;
  throw new SecurityError(SecurityErrorCode.PAIRING_KEY_INVALID);
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

// ---- step 4: the trusted device wraps, after a person has confirmed ------

export async function wrapDataKeyForPairing(options: {
  dataKey: Uint8Array;
  transportKey: Uint8Array;
  context: PairingContext;
  cipher: RecordCipher;
}): Promise<PairingEnvelope> {
  const { dataKey, transportKey, context, cipher } = options;
  assertDataKey(dataKey);
  const { iv, ciphertext } = await cipher.encrypt(
    toBase64(dataKey),
    transportKey,
    transportAad(context),
  );
  return { v: PAIRING_VERSION, alg: 'AES-GCM', iv: toBase64(iv), ct: toBase64(ciphertext) };
}

// ---- step 5: the new device unwraps and takes custody --------------------

/**
 * Opens the wrapped key and hands it to Gate 2 custody.
 *
 * Refuses outright if this device already holds a usable key: pairing is how a
 * device *without* the key obtains it, and overwriting a working key with one
 * from a session someone else may have influenced is the orphaning failure this
 * whole architecture exists to prevent. Every other failure — wrong transport
 * key, tampered envelope, wrong session — leaves custody untouched, because the
 * store happens only after the tag has verified and the bytes have been checked.
 */
export async function completePairing(options: {
  session: unknown;
  transportKey: Uint8Array;
  context: PairingContext;
  cipher: RecordCipher;
  custody: KeyCustody;
  now: number;
}): Promise<Uint8Array> {
  const { session, transportKey, context, cipher, custody, now } = options;
  assertPairingSession(session);
  assertActive(session, now, 'confirmed');

  if ((await custody.status()) === 'present') {
    throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_INVALID);
  }

  const envelope = session.wrapped;
  if (!isEnvelope(envelope) || envelope.v !== PAIRING_VERSION) {
    throw new SecurityError(SecurityErrorCode.PAIRING_SESSION_INVALID);
  }

  const encoded = await cipher.decrypt(
    fromBase64(envelope.ct),
    fromBase64(envelope.iv),
    transportKey,
    transportAad(context),
  );

  let dataKey: Uint8Array;
  try {
    dataKey = fromBase64(encoded);
  } catch (cause) {
    throw new SecurityError(SecurityErrorCode.PAIRING_SESSION_INVALID, cause);
  }
  assertDataKey(dataKey);
  await custody.store(dataKey);
  return dataKey;
}
