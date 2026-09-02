import { sha256 } from '@noble/hashes/sha2.js';
import { toHex } from './crypto/hex';
import { utf8Encode } from './crypto/utf8';
import { SecurityError, SecurityErrorCode } from './errors';

/**
 * Where one identity's data encryption key lives on this device.
 *
 * **The defect this closes.** Custody used to address a single slot for the
 * whole device, so a second person signing in read the first person's record.
 * The authenticated identity reached the encryption context and never reached
 * the storage namespace: correct everywhere it was used, absent everywhere it
 * was needed.
 *
 * **The address is hashed for charset safety, not for secrecy.** Say it plainly,
 * because the opposite reading is the tempting one: this provides no
 * confidentiality whatsoever. Anyone who can enumerate the keystore has already
 * defeated everything the namespace does. What hashing buys is that *any*
 * identity string produces a storable address — `expo-secure-store` rejects
 * keys outside `[A-Za-z0-9._-]`, and no guarantee has been established about
 * what characters an authentication provider may put in an identifier. An
 * address built by interpolating the identity would work until the day it did
 * not, and would fail deep inside the storage layer rather than here.
 *
 * **Deterministic from the identity alone.** No device secret, no salt, no
 * per-install component. That is a requirement rather than a simplification: an
 * address that changed when some local value was lost would orphan a key whose
 * owner can still reach it, turning a recoverable state into an unrecoverable
 * one — a worse failure than the one it would prevent.
 *
 * **The version lives in the prefix.** A future re-namespacing becomes a new
 * prefix rather than a change to how an existing address is read.
 */

/** Bumped only when the address scheme itself changes. */
export const CUSTODY_ADDRESS_PREFIX = 'platform.dek.v2.';

/**
 * The address for an owner, as a total function of that owner.
 *
 * The identity is treated as an opaque token: not lowercased, not trimmed, not
 * normalised in any way. Deciding that two identifiers are "the same" is the
 * authentication provider's job, and a normalisation here could merge two
 * accounts into one custody record — the defect, reintroduced by helpfulness.
 */
export function custodyAddressFor(owner: string): string {
  // An empty identity is not a user, and hashing it would yield a perfectly
  // valid address that every caller without an identity would then share. Fails
  // closed rather than manufacturing a namespace for nobody.
  if (typeof owner !== 'string' || owner.length === 0) {
    throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_INVALID);
  }
  return `${CUSTODY_ADDRESS_PREFIX}${toHex(sha256(utf8Encode(owner)))}`;
}
