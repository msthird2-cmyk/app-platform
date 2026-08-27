import { sha256 } from '@noble/hashes/sha2.js';
import { utf8Encode } from './utf8';
import { toBase64 } from './base64';

/**
 * The short code a person compares across two screens, and the commitment that
 * makes six digits enough.
 *
 * **Why a commitment is required.** A short authentication string derived from
 * both public keys is not, on its own, safe. A relay sitting in the middle sees
 * both real keys and can generate its own two ephemeral pairs freely, searching
 * for M1 and M2 such that code(A, M1) equals code(M2, B). That is a collision
 * search, not a preimage search, so it costs about 2^(n/2) — for a six-digit
 * code, on the order of a thousand tries. Offline. In milliseconds.
 *
 * The fix is the one ZRTP and Bluetooth secure simple pairing use: the
 * initiator publishes H(its public key) *before* the responder publishes
 * anything, and opens the commitment afterwards. Now the attacker must fix its
 * key toward the responder before it has seen the responder's key, and fix its
 * key toward the initiator before the initiator's key is revealed. It gets one
 * guess at making the two codes match, not a search — 10^-6 instead of 10^-3,
 * and each attempt is a pairing a human watches fail.
 *
 * So the commitment is not an extra safety belt. Without it the code is
 * decorative, and the whole pairing reduces to trusting the relay.
 */

/** Six digits, compared as two groups of three. */
const CODE_DIGITS = 6;

export const VERIFICATION_CODE_DOMAIN = 'pairing.sas.v1';
export const COMMITMENT_DOMAIN = 'pairing.commit.v1';

export interface VerificationCodeContext {
  userId: string;
  appName: string;
  sessionId: string;
}

/**
 * The initiator's commitment to its ephemeral public key.
 *
 * Domain-separated from the code itself so the two hashes of the same key can
 * never be confused for one another.
 */
export function commitToPublicKey(publicKey: Uint8Array): string {
  return toBase64(
    sha256(concat(utf8Encode(`${COMMITMENT_DOMAIN}|`), publicKey)),
  );
}

export function commitmentMatches(publicKey: Uint8Array, commitment: string): boolean {
  const expected = commitToPublicKey(publicKey);
  // Constant-time over equal-length base64 strings; length difference is not
  // secret, since it is fixed by the hash.
  if (expected.length !== commitment.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i += 1) {
    difference |= expected.charCodeAt(i) ^ commitment.charCodeAt(i);
  }
  return difference === 0;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Lexicographic order, so neither device needs to know which one it is. */
function ordered(a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    const left = a[i] as number;
    const right = b[i] as number;
    if (left !== right) return left < right ? [a, b] : [b, a];
  }
  return a.length <= b.length ? [a, b] : [b, a];
}

/**
 * The code, derived from the key agreement rather than stored beside it.
 *
 * Order-independent by construction, so the two devices compute the same six
 * digits without agreeing who is first. Substituting either public key changes
 * the hash and therefore the code, which is the entire detection mechanism.
 */
export function verificationCode(
  publicKeyA: Uint8Array,
  publicKeyB: Uint8Array,
  context: VerificationCodeContext,
): string {
  const [low, high] = ordered(publicKeyA, publicKeyB);
  const preimage = concat(
    utf8Encode(
      `${VERIFICATION_CODE_DOMAIN}|${context.userId}|${context.appName}|${context.sessionId}|`,
    ),
    concat(low, high),
  );
  const digest = sha256(preimage);

  // Big-endian over the leading bytes, reduced to the digit count. Taking a
  // decimal remainder of a uniform 32-bit value introduces bias far below what
  // six digits can express.
  let value = 0;
  for (let i = 0; i < 4; i += 1) value = value * 256 + (digest[i] as number);
  const digits = String(value % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0');
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}
