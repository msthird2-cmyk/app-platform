import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { SecurityError, SecurityErrorCode } from '../errors';

/**
 * Ephemeral ECDH over NIST P-256, for trusted-device pairing.
 *
 * **Why one implementation rather than a Web/Portable pair.** Every other
 * primitive here has two, because WebCrypto can hold a key as a non-extractable
 * `CryptoKey` whose bytes JavaScript never sees, and React Native has no
 * WebCrypto at all. Neither reason applies to ECDH: the output of an agreement
 * is a shared secret that both sides must feed to a KDF, and
 * `subtle.deriveBits` hands it back as an ArrayBuffer regardless — there is no
 * non-extractable form to protect. What two implementations would add is the
 * risk that they disagree by one byte, and for pairing that is not a subtle
 * bug: two devices on different platforms would simply never derive the same
 * transport key. So there is one audited implementation, and it is the portable
 * one, which the X-1 gate already exercises on real Hermes.
 *
 * **Why P-256 rather than X25519.** Both are available in `@noble/curves` and
 * both are sound here. P-256 keeps a future WebCrypto or platform-native
 * implementation possible without changing the wire format; X25519 has patchy
 * WebCrypto support and would close that door.
 *
 * The private key is ephemeral, per pairing, and never persisted anywhere.
 */

/** Compressed SEC1 point: 33 bytes. */
export const PUBLIC_KEY_BYTES = 33;
export const PRIVATE_KEY_BYTES = 32;
/** AES-256. */
const TRANSPORT_KEY_BYTES = 32;

export interface EphemeralKeyPair {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface KeyAgreement {
  generate(): EphemeralKeyPair;
  /** The public key for a private key, so a device can tell which role it had. */
  publicKeyOf(privateKey: Uint8Array): Uint8Array;
  /**
   * The transport key both sides arrive at, or a throw.
   *
   * `info` is where the session's identity is bound. Two pairings with the same
   * two ephemeral keys — which cannot happen, but the binding costs nothing —
   * and any pairing under a different user, application or session id produce
   * different transport keys. A wrapped key from one session is therefore not
   * merely unauthenticated in another, it is undecryptable.
   */
  deriveTransportKey(
    privateKey: Uint8Array,
    peerPublicKey: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
  ): Uint8Array;
}

function assertPublicKey(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.length !== PUBLIC_KEY_BYTES) {
    throw new SecurityError(SecurityErrorCode.PAIRING_KEY_INVALID);
  }
}

function assertPrivateKey(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || value.length !== PRIVATE_KEY_BYTES) {
    throw new SecurityError(SecurityErrorCode.PAIRING_KEY_INVALID);
  }
}

export class P256KeyAgreement implements KeyAgreement {
  generate(): EphemeralKeyPair {
    const { secretKey, publicKey } = p256.keygen();
    return { privateKey: secretKey, publicKey };
  }

  publicKeyOf(privateKey: Uint8Array): Uint8Array {
    assertPrivateKey(privateKey);
    try {
      return p256.getPublicKey(privateKey);
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.PAIRING_KEY_INVALID, cause);
    }
  }

  deriveTransportKey(
    privateKey: Uint8Array,
    peerPublicKey: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
  ): Uint8Array {
    assertPrivateKey(privateKey);
    assertPublicKey(peerPublicKey);

    let shared: Uint8Array;
    try {
      // Throws on a point that is not on the curve, which is the invalid-curve
      // attack. The library validates; this does not reimplement that check.
      shared = p256.getSharedSecret(privateKey, peerPublicKey);
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.PAIRING_KEY_INVALID, cause);
    }

    // The x-coordinate only, as ECDH is specified: the leading byte of the
    // compressed point encodes the parity of y and carries no extra entropy.
    const x = shared.slice(1);
    try {
      // HKDF, not PBKDF2. The input is a high-entropy Diffie-Hellman secret,
      // not a human secret — there is nothing to stretch, and stretching it
      // would cost ~25 seconds per pairing on the Android hardware the X-1 gate
      // measures for no gain whatsoever.
      return hkdf(sha256, x, salt, info, TRANSPORT_KEY_BYTES);
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.KEY_DERIVATION_FAILED, cause);
    } finally {
      shared.fill(0);
      x.fill(0);
    }
  }
}
