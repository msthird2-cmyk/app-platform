import { SecurityError, SecurityErrorCode } from '../errors';

/**
 * A cryptographically secure source of random bytes, supplied by the platform.
 *
 * React Native provides no `crypto.getRandomValues`, so nothing in this package
 * may reach for one. The composition root passes the platform's own generator
 * instead — `expo-crypto`'s `getRandomBytes` on React Native,
 * `crypto.getRandomValues` on web.
 */
export type RandomBytes = (length: number) => Uint8Array;

/** Rejecting an all-zero draw is stub detection, and below this length it would
 *  start rejecting legitimate output instead: at 8 bytes the false-positive
 *  probability is 2^-64, and it halves with every byte after that. */
const ZERO_CHECK_MIN_LENGTH = 8;

/**
 * Draws from an injected source and checks what comes back.
 *
 * The realistic wiring mistake is not a weak generator but an absent one — a
 * stub that returns `new Uint8Array(n)`, or a source that hands back a plain
 * array, or one wired to the wrong length. None of those fail anywhere visible:
 * they silently destroy every salt, nonce and recovery code the process
 * produces. So the result is checked on every call rather than trusted once.
 */
export function drawRandomBytes(source: RandomBytes, length: number): Uint8Array {
  if (typeof source !== 'function') {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID);
  }
  const bytes = source(length);
  if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID);
  }
  if (length >= ZERO_CHECK_MIN_LENGTH) {
    let anySet = 0;
    for (const byte of bytes) anySet |= byte;
    if (anySet === 0) throw new SecurityError(SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID);
  }
  return bytes;
}
