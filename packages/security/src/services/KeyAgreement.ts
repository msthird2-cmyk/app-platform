import { ecdh, weierstrass } from '@noble/curves/abstract/weierstrass.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { drawRandomBytes, type RandomBytes } from '../crypto/entropy';
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
 * **Why the curve is parameterised here rather than imported from
 * `@noble/curves/nist.js`.** That module builds FROST threshold signing at
 * module-evaluation time, and doing so calls `TextEncoder` — so merely
 * importing it puts a browser global on the portable path and breaks the
 * invariant the X-1 gate enforces. Every curve entry point in the package does
 * this, so the choice was between weakening that invariant and not using the
 * library's high-level export. The engine underneath — `weierstrass` and
 * `ecdh` from `abstract/weierstrass.js` — imports cleanly, so the curve is
 * constructed from its published domain parameters instead.
 *
 * These are the NIST P-256 (secp256r1) parameters from FIPS 186-4 D.1.2.3, and
 * nothing about the field arithmetic, point validation or ECDH is
 * reimplemented — the library does all of it. A transcription error would still
 * be catastrophic, so `tests/pairing.test.ts` cross-checks this curve against
 * `@noble/curves/nist.js`'s own `p256` and asserts byte-identical public keys
 * and shared secrets. The library is its own oracle, and the check runs where
 * `TextEncoder` exists.
 *
 * The private key is ephemeral, per pairing, and never persisted anywhere.
 */

/** FIPS 186-4 D.1.2.3 / SEC 2 §2.4.2. Verified against the library in tests. */
const P256_CURVE = {
  p: BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff'),
  n: BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
  h: BigInt(1),
  a: BigInt('0xffffffff00000001000000000000000000000000fffffffffffffffffffffffc'),
  b: BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
  Gx: BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
  Gy: BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'),
} as const;

const P256_POINT = /* @__PURE__ */ weierstrass(P256_CURVE);

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
  private readonly dh: ReturnType<typeof ecdh>;

  /**
   * Entropy is injected, as everywhere else in this package. Left to itself
   * `ecdh` reaches for WebCrypto's random source, which React Native does not
   * have — the same defect X-1 exists to prevent.
   */
  constructor(randomBytes: RandomBytes) {
    this.dh = ecdh(P256_POINT, {
      randomBytes: (length?: number) => drawRandomBytes(randomBytes, length ?? 32),
    });
  }

  generate(): EphemeralKeyPair {
    const { secretKey, publicKey } = this.dh.keygen();
    return { privateKey: secretKey, publicKey };
  }

  publicKeyOf(privateKey: Uint8Array): Uint8Array {
    assertPrivateKey(privateKey);
    try {
      return this.dh.getPublicKey(privateKey);
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
      shared = this.dh.getSharedSecret(privateKey, peerPublicKey);
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
