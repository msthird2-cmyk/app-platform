import { fromBase64, toBase64 } from './crypto/base64';
import { SecurityError, SecurityErrorCode } from './errors';
import {
  assertRecordEnvelope,
  recordAdditionalData,
  RECORD_ENVELOPE_VERSION,
  type RecordContext,
  type RecordEnvelope,
} from './recordEnvelope';
import type { RecordCipher } from './types/recordCipher';

/**
 * Record payloads, sealed under the data encryption key.
 *
 * The whole of X-2's cryptography is these two functions. They do not choose a
 * key, do not fetch one, and do not create one: the caller passes the DEK it
 * already holds from Gate 2 custody, and if it has none there is nothing here
 * that will invent a substitute.
 */

/** AES-256. */
const KEY_BYTES = 32;

function assertDataKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new SecurityError(SecurityErrorCode.DATA_KEY_UNAVAILABLE);
  }
  let anySet = 0;
  for (const byte of key) anySet |= byte;
  // An all-zero key is a stub someone wired in, not a key.
  if (anySet === 0) throw new SecurityError(SecurityErrorCode.DATA_KEY_UNAVAILABLE);
}

export async function encryptRecordPayload(
  payload: unknown,
  dataKey: Uint8Array,
  context: RecordContext,
  cipher: RecordCipher,
): Promise<RecordEnvelope> {
  assertDataKey(dataKey);
  const { iv, ciphertext } = await cipher.encrypt(
    JSON.stringify(payload),
    dataKey,
    recordAdditionalData(context, RECORD_ENVELOPE_VERSION),
  );
  return {
    v: RECORD_ENVELOPE_VERSION,
    alg: 'AES-GCM',
    iv: toBase64(iv),
    ct: toBase64(ciphertext),
  };
}

/**
 * Opens an envelope, or throws.
 *
 * There is no third outcome. A wrong key, a tampered ciphertext or nonce, and
 * additional data naming a different user, application, collection or record
 * all fail the GCM tag and arrive here as `DECRYPTION_FAILED`. None of them
 * yields a record, an empty object, or a partial one — returning a default on
 * a decryption failure is how encrypted storage silently becomes decorative.
 */
export async function decryptRecordPayload(
  envelope: unknown,
  dataKey: Uint8Array,
  context: RecordContext,
  cipher: RecordCipher,
): Promise<Record<string, unknown>> {
  assertRecordEnvelope(envelope);
  assertDataKey(dataKey);

  const plaintext = await cipher.decrypt(
    fromBase64(envelope.ct),
    fromBase64(envelope.iv),
    dataKey,
    recordAdditionalData(context, envelope.v),
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch (cause) {
    // The tag verified, so this really is ours and is corrupt rather than
    // hostile. It is still not a record.
    throw new SecurityError(SecurityErrorCode.RECORD_ENVELOPE_INVALID, cause);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SecurityError(SecurityErrorCode.RECORD_ENVELOPE_INVALID);
  }
  return parsed as Record<string, unknown>;
}
