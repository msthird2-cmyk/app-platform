import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { SecurityError, SecurityErrorCode } from '../errors';
import { fromBase64, toBase64 } from '../crypto/base64';
import { drawRandomBytes, type RandomBytes } from '../crypto/entropy';
import {
  IV_BYTES,
  KEY_LENGTH_BITS,
  PAYLOAD_VERSION,
  SALT_BYTES,
  SECRET_HASH_VERSION,
  additionalData,
  assertSupportedPayload,
  assertSupportedSecretHash,
  equalsConstantTime,
} from '../crypto/envelope';
import { utf8Decode, utf8Encode } from '../crypto/utf8';
import { DEFAULT_KDF_ITERATIONS, assertAllowedIterationCount } from '../kdfPolicy';
import type {
  CryptoService,
  EncryptedPayload,
  EncryptionContext,
  SecretHash,
} from '../types/crypto';

const KEY_LENGTH_BYTES = KEY_LENGTH_BITS / 8;

export type { RandomBytes };

export interface PortableCryptoOptions {
  /**
   * A cryptographically secure source of random bytes.
   *
   * Required, with no default on purpose. Every plausible default is a global
   * that may not exist on the target runtime, and a crypto implementation that
   * silently falls back to a weaker source is worse than one that refuses to
   * construct. The composition root passes the platform's own generator —
   * `expo-crypto`'s `getRandomBytes` on React Native,
   * `crypto.getRandomValues` on web.
   */
  randomBytes: RandomBytes;
  iterations?: number;
}

/**
 * AES-256-GCM with a PBKDF2-SHA256 derived key, depending on no runtime global.
 *
 * `WebCryptoService` needs `crypto.subtle`, `crypto.getRandomValues`, `btoa`,
 * `atob`, `TextEncoder` and `TextDecoder`. React Native 0.76 on Hermes provides
 * none of them — verified against the installed `react-native` and
 * `@react-native/js-polyfills` packages, neither of which defines any. So this
 * implementation uses audited pure-JavaScript primitives from `@noble/*` and
 * takes its entropy by injection.
 *
 * The envelope is shared with `WebCryptoService` and the output is byte-identical
 * — `tests/crossImplementation.test.ts` proves each can read the other's
 * backups, so a user restoring a web backup on a phone gets their data back.
 *
 * **Trade-off, stated rather than buried.** WebCrypto can keep a derived key as
 * a non-extractable `CryptoKey`; a pure-JavaScript implementation cannot, so
 * here the key exists as a `Uint8Array` for the duration of one operation. The
 * alternatives were a native module (`react-native-quick-crypto`), which needs
 * a custom Android build, or shipping no working crypto on React Native at all.
 * Buffers are zeroed after use, which reduces the window without closing it —
 * a JavaScript engine may copy a buffer during garbage collection, and nothing
 * at this layer can prevent that. Prefer `WebCryptoService` on any target that
 * has WebCrypto.
 */
export class PortableCryptoService implements CryptoService {
  private readonly iterations: number;
  private readonly random: RandomBytes;

  constructor(options: PortableCryptoOptions) {
    if (typeof options?.randomBytes !== 'function') {
      throw new SecurityError(SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID);
    }
    // Same policy as the read path, enforced at configuration time.
    const iterations = options.iterations ?? DEFAULT_KDF_ITERATIONS;
    assertAllowedIterationCount(iterations);
    this.iterations = iterations;
    this.random = options.randomBytes;
  }

  /** Checked on every call — see `drawRandomBytes`, which recovery-code
   *  generation uses for the same reason. */
  private randomBytes(length: number): Uint8Array {
    return drawRandomBytes(this.random, length);
  }

  private deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Uint8Array {
    const secret = utf8Encode(passphrase);
    try {
      return pbkdf2(sha256, secret, salt, { c: iterations, dkLen: KEY_LENGTH_BYTES });
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.KEY_DERIVATION_FAILED, cause);
    } finally {
      secret.fill(0);
    }
  }

  async encrypt(
    plaintext: string,
    passphrase: string,
    context: EncryptionContext,
  ): Promise<EncryptedPayload> {
    // A fresh salt and a fresh nonce for every single encryption.
    const salt = this.randomBytes(SALT_BYTES);
    const iv = this.randomBytes(IV_BYTES);
    const key = this.deriveKey(passphrase, salt, this.iterations);
    const message = utf8Encode(plaintext);
    try {
      const ciphertext = gcm(
        key,
        iv,
        additionalData(context, this.iterations, PAYLOAD_VERSION),
      ).encrypt(message);
      return {
        ciphertext: toBase64(ciphertext),
        iv: toBase64(iv),
        salt: toBase64(salt),
        algorithm: 'AES-GCM',
        iterations: this.iterations,
        version: PAYLOAD_VERSION,
      };
    } catch (cause) {
      if (cause instanceof SecurityError) throw cause;
      throw new SecurityError(SecurityErrorCode.ENCRYPTION_FAILED, cause);
    } finally {
      key.fill(0);
      message.fill(0);
    }
  }

  async decrypt(
    payload: EncryptedPayload,
    passphrase: string,
    context: EncryptionContext,
  ): Promise<string> {
    // Validate the envelope before spending any work on it.
    assertSupportedPayload(payload);
    let key: Uint8Array | null = null;
    let plaintext: Uint8Array | null = null;
    try {
      key = this.deriveKey(passphrase, fromBase64(payload.salt), payload.iterations);
      plaintext = gcm(
        key,
        fromBase64(payload.iv),
        additionalData(context, payload.iterations, payload.version),
      ).decrypt(fromBase64(payload.ciphertext));
      return utf8Decode(plaintext);
    } catch (cause) {
      if (cause instanceof SecurityError) throw cause;
      throw new SecurityError(SecurityErrorCode.DECRYPTION_FAILED, cause);
    } finally {
      key?.fill(0);
      plaintext?.fill(0);
    }
  }

  async hash(value: string): Promise<string> {
    return toBase64(sha256(utf8Encode(value)));
  }

  private deriveDigest(secret: string, salt: Uint8Array, iterations: number): Uint8Array {
    return this.deriveKey(secret, salt, iterations);
  }

  async hashSecret(secret: string): Promise<SecretHash> {
    const salt = this.randomBytes(SALT_BYTES);
    const digest = this.deriveDigest(secret, salt, this.iterations);
    try {
      return {
        version: SECRET_HASH_VERSION,
        algorithm: 'PBKDF2-SHA256',
        salt: toBase64(salt),
        iterations: this.iterations,
        digest: toBase64(digest),
      };
    } finally {
      digest.fill(0);
    }
  }

  async verifySecret(secret: string, stored: SecretHash): Promise<boolean> {
    assertSupportedSecretHash(stored);
    const candidate = this.deriveDigest(secret, fromBase64(stored.salt), stored.iterations);
    try {
      return equalsConstantTime(candidate, fromBase64(stored.digest));
    } finally {
      candidate.fill(0);
    }
  }
}
