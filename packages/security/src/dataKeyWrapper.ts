import { fromBase64, toBase64 } from './crypto/base64';
import { SecurityError, SecurityErrorCode } from './errors';
import { assertStrongPassphrase } from './passphrase';
import { assertSupportedPayload } from './crypto/envelope';
import type { CryptoService, EncryptedPayload, EncryptionContext } from './types/crypto';

/**
 * A passphrase around the data encryption key, for the device at rest.
 *
 * **The gap this closes.** Key custody puts the DEK in the OS keystore, and the
 * keystore hands it back to anything running as this application — no user
 * presence is required, because `requireAuthentication` is deliberately off
 * (see `OsKeystoreStorage`: a biometric prompt blocks the JavaScript thread,
 * and a background sync has no user to prompt). So today, whoever can run the
 * app on that device has the DEK, immediately and for free. `ProtectionTier`
 * is explicit that `os-keystore` "says nothing about hardware": there is no
 * attestation, so on a software-backed keystore the only thing between an
 * attacker with the device and the key is software.
 *
 * A passphrase changes that to something they must also know. It does not
 * replace the keystore — the wrapped key still lives there — it means the
 * keystore alone is no longer sufficient.
 *
 * **What it deliberately is not.** Not a second layer around records: records
 * keep their existing envelope, their existing AAD and their existing key.
 * Only the DEK is wrapped, so changing a passphrase re-wraps 32 bytes rather
 * than re-encrypting a portfolio. And not a replacement for recovery: the
 * recovery code opens the escrow independently of this, which is why forgetting
 * the passphrase costs a device rather than the data.
 *
 * **No new cryptography.** This is the recovery escrow's construction with a
 * different secret and a different purpose — the same `CryptoService`, the same
 * AES-GCM envelope, the same KDF at the same cost, validated by the same
 * `assertSupportedPayload`. The purpose string is what stops one being replayed
 * as the other, exactly as `RECOVERY_ESCROW_PURPOSE` does for the escrow.
 */

/** Domain separation. A wrapper cannot be opened as an escrow, or the reverse. */
export const DATA_KEY_WRAPPER_PURPOSE = 'data-key-wrapper.v1';

export const DATA_KEY_WRAPPER_VERSION = 1;

/** AES-256, matching `keyCustody`, `recoveryEscrow` and the record cipher. */
const DEK_BYTES = 32;

/**
 * The wrapped key, and nothing else.
 *
 * Every field is ciphertext or non-secret KDF metadata. As in the escrow there
 * is deliberately no digest, checksum or verifier of the DEK or the passphrase:
 * such a field would let anyone holding this document test candidate
 * passphrases without paying for a key derivation, which is the only thing
 * making a human-chosen secret expensive to attack offline.
 */
export interface WrappedDataKey {
  version: number;
  wrappedKey: EncryptedPayload;
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as EncryptedPayload;
  return (
    typeof payload.ciphertext === 'string' &&
    typeof payload.iv === 'string' &&
    typeof payload.salt === 'string' &&
    typeof payload.algorithm === 'string' &&
    typeof payload.iterations === 'number' &&
    typeof payload.version === 'number'
  );
}

/**
 * Rejects anything this system did not produce, before a key is derived.
 *
 * Order matters: a malformed or unsupported document costs nothing, and an
 * unsupported *version* is distinguished from a malformed one so a future
 * format is a clear error rather than a corruption report.
 */
export function assertWrappedDataKey(value: unknown): asserts value is WrappedDataKey {
  if (typeof value !== 'object' || value === null) {
    throw new SecurityError(SecurityErrorCode.DATA_KEY_WRAPPER_INVALID);
  }
  const wrapper = value as WrappedDataKey;
  if (wrapper.version !== DATA_KEY_WRAPPER_VERSION) {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED);
  }
  if (!isEncryptedPayload(wrapper.wrappedKey)) {
    throw new SecurityError(SecurityErrorCode.DATA_KEY_WRAPPER_INVALID);
  }
  // The same bounds every other envelope goes through: a hostile document
  // cannot demand a billion KDF rounds here any more than anywhere else.
  assertSupportedPayload(wrapper.wrappedKey);
}

function assertDataKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== DEK_BYTES) {
    throw new SecurityError(SecurityErrorCode.DATA_KEY_WRAPPER_INVALID);
  }
  let anySet = 0;
  for (const byte of key) anySet |= byte;
  // An all-zero key is a stub someone wired in, not a key.
  if (anySet === 0) throw new SecurityError(SecurityErrorCode.DATA_KEY_WRAPPER_INVALID);
}

/** The context the wrapping key and the AEAD tag are bound to. */
function wrapperContext(context: EncryptionContext): EncryptionContext {
  return { ...context, purpose: DATA_KEY_WRAPPER_PURPOSE };
}

/**
 * Wraps a DEK that already exists.
 *
 * The passphrase is checked against the shared policy first, before anything is
 * derived or written. It carries real weight here: the wrapped key sits in the
 * same keystore an attacker with the device has already opened, so the only
 * remaining cost to them is the KDF times the passphrase's entropy.
 *
 * Nothing in the returned value is the passphrase, and nothing derived from it
 * is retained by this function.
 */
export async function wrapDataKey(
  dataKey: Uint8Array,
  passphrase: string,
  crypto: CryptoService,
  context: EncryptionContext,
): Promise<WrappedDataKey> {
  assertDataKey(dataKey);
  assertStrongPassphrase(passphrase);
  const wrappedKey = await crypto.encrypt(toBase64(dataKey), passphrase, wrapperContext(context));
  return { version: DATA_KEY_WRAPPER_VERSION, wrappedKey };
}

/**
 * Opens a wrapper and returns the DEK.
 *
 * A wrong passphrase fails here as a GCM tag failure — `DECRYPTION_FAILED` —
 * and there is no other outcome for it. Nothing distinguishes "wrong
 * passphrase" from "tampered ciphertext", and nothing needs to: neither can
 * produce a key, and a distinguishable failure would be an oracle.
 */
export async function unwrapDataKey(
  wrapper: unknown,
  passphrase: string,
  crypto: CryptoService,
  context: EncryptionContext,
): Promise<Uint8Array> {
  assertWrappedDataKey(wrapper);
  // Deliberately not `assertStrongPassphrase`: the policy governs what may be
  // *set*, and applying it on the way in would lock out anyone whose passphrase
  // predates a policy change. A weak guess still has to beat the AEAD tag.
  const encoded = await crypto.decrypt(wrapper.wrappedKey, passphrase, wrapperContext(context));

  let dataKey: Uint8Array;
  try {
    dataKey = fromBase64(encoded);
  } catch (cause) {
    // The tag verified, so this came from us and is corrupt rather than
    // hostile — but it is still not a key, and it is not treated as one.
    throw new SecurityError(SecurityErrorCode.DATA_KEY_WRAPPER_INVALID, cause);
  }
  assertDataKey(dataKey);
  return dataKey;
}

/**
 * Re-wraps the same DEK under a new passphrase.
 *
 * The key never changes, so no record is touched and nothing needs
 * re-encrypting — that is the whole reason the passphrase wraps the DEK rather
 * than the data. The old passphrase is required, so this cannot be used to seize
 * a key from a device somebody left unlocked; and a fresh salt and IV come from
 * `crypto.encrypt`, so the new wrapper shares nothing with the old one.
 */
export async function changeDataKeyPassphrase(
  wrapper: unknown,
  currentPassphrase: string,
  nextPassphrase: string,
  crypto: CryptoService,
  context: EncryptionContext,
): Promise<WrappedDataKey> {
  const dataKey = await unwrapDataKey(wrapper, currentPassphrase, crypto, context);
  return wrapDataKey(dataKey, nextPassphrase, crypto, context);
}
