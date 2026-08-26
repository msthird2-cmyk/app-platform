import { SecurityError, SecurityErrorCode } from './errors';
import { utf8Encode } from './crypto/utf8';

/**
 * The envelope a single encrypted record payload travels in.
 *
 * Deliberately **not** `EncryptedPayload`. That type carries a required
 * `iterations`, and `assertSupportedPayload` checks it against the KDF policy,
 * because it describes a payload whose key was stretched from a passphrase.
 * A record's key is the DEK: already 256 uniformly random bits, already the
 * strongest thing in the system. Stretching it buys nothing, and at the shipped
 * cost of 210,000 rounds it would add roughly 25 seconds per record on the
 * Android hardware the X-1 gate measures.
 *
 * So this is a separate envelope with no KDF fields at all. Keeping the two
 * apart also means a record envelope cannot be mistaken for a passphrase one:
 * there is no iteration count to invent, and the purpose in the additional
 * data differs, so neither opens as the other.
 */
export const RECORD_ENVELOPE_VERSION = 1;

/** Names the domain, bound into the tag. */
export const RECORD_PURPOSE = 'record.v1';

export interface RecordEnvelope {
  v: number;
  alg: 'AES-GCM';
  /** Base64 nonce, fresh for every single encryption. */
  iv: string;
  /** Base64 ciphertext with the GCM tag appended. */
  ct: string;
}

/**
 * Where a record lives, which is what its ciphertext is bound to.
 *
 * `collection` and `recordId` are here for a specific attack: without them a
 * ciphertext could be lifted from one document and dropped into another, and
 * the tag would still verify. With them, a payload moved between records — or
 * between collections, users or applications — fails to open at all.
 */
export interface RecordContext {
  userId: string;
  appName: string;
  collection: string;
  recordId: string;
}

/**
 * Binds the envelope to the record it belongs to.
 *
 * Same discipline as `additionalData` for passphrase payloads: everything an
 * attacker could otherwise edit freely is authenticated, so tampering fails the
 * tag rather than quietly changing how the payload is read.
 */
export function recordAdditionalData(context: RecordContext, version: number): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      v: version,
      alg: 'AES-GCM',
      pur: RECORD_PURPOSE,
      uid: context.userId,
      app: context.appName,
      col: context.collection,
      rid: context.recordId,
    }),
  );
}

function isRecordEnvelope(value: unknown): value is RecordEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const envelope = value as RecordEnvelope;
  return (
    typeof envelope.v === 'number' &&
    typeof envelope.alg === 'string' &&
    typeof envelope.iv === 'string' &&
    typeof envelope.ct === 'string'
  );
}

/**
 * Validates the envelope before any key or ciphertext is touched.
 *
 * An unsupported version and an unsupported algorithm are separate codes so a
 * future format is distinguishable from a corrupt one. Both fail closed; the
 * caller gets an error, never a partially decoded record.
 */
export function assertRecordEnvelope(value: unknown): asserts value is RecordEnvelope {
  if (!isRecordEnvelope(value)) {
    throw new SecurityError(SecurityErrorCode.RECORD_ENVELOPE_INVALID);
  }
  if (value.v !== RECORD_ENVELOPE_VERSION) {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED);
  }
  if (value.alg !== 'AES-GCM') {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_ALGORITHM_UNSUPPORTED);
  }
}
