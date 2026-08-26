import { SecurityError, SecurityErrorCode } from '../errors';
import { assertAllowedIterationCount } from '../kdfPolicy';
import type { EncryptedPayload, EncryptionContext, SecretHash } from '../types/crypto';
import { utf8Encode } from './utf8';

/**
 * Everything about the envelope that is not a cryptographic primitive.
 *
 * Two `CryptoService` implementations exist — one over WebCrypto, one portable
 * — and they must agree byte for byte or a backup taken on one device cannot be
 * restored on another. Sharing the envelope here is what makes that true by
 * construction; only the primitives differ.
 *
 * The primitives are deliberately *not* shared. WebCrypto can hold a derived
 * key as a non-extractable `CryptoKey` that JavaScript never sees the bytes of,
 * and a common base class would have had to surrender that to accommodate the
 * portable implementation. `tests/cryptoContract.ts` runs the same battery
 * against both instead, so the duplication cannot drift silently.
 */
export const PAYLOAD_VERSION = 1;
export const SECRET_HASH_VERSION = 1;
export const KEY_LENGTH_BITS = 256;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

/**
 * Binds the envelope to the ciphertext. Anything an attacker could otherwise
 * edit freely — the owner, the application, the algorithm, the cost — is
 * authenticated, so tampering fails the GCM tag rather than silently changing
 * how the payload is read.
 */
export function additionalData(
  context: EncryptionContext,
  iterations: number,
  version: number,
): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      v: version,
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      it: iterations,
      uid: context.userId,
      app: context.appName,
      // Appended last and only when present, so a context without a purpose
      // serialises to exactly the string it did before this key existed. Every
      // payload written so far still authenticates; a purpose-bound one is a
      // different domain and cannot be opened as an ordinary payload.
      ...(context.purpose === undefined ? {} : { pur: context.purpose }),
    }),
  );
}

/** Validates the envelope before any key derivation is paid for. */
export function assertSupportedPayload(payload: EncryptedPayload): void {
  if (payload.version !== PAYLOAD_VERSION) {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED);
  }
  if (payload.algorithm !== 'AES-GCM') {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_ALGORITHM_UNSUPPORTED);
  }
  assertAllowedIterationCount(payload.iterations);
}

export function assertSupportedSecretHash(stored: SecretHash): void {
  if (stored.version !== SECRET_HASH_VERSION || stored.algorithm !== 'PBKDF2-SHA256') {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED);
  }
  assertAllowedIterationCount(stored.iterations);
}

/** Comparison whose duration does not depend on where the first difference is. */
export function equalsConstantTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}
