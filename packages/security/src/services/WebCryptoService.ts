import { SecurityError, SecurityErrorCode } from '../errors';
import { fromBase64, toBase64 } from '../crypto/base64';
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

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * AES-256-GCM with a PBKDF2-SHA256 derived key, over WebCrypto.
 *
 * This is the web implementation. It is preferred wherever WebCrypto exists,
 * because `deriveKey` returns a non-extractable `CryptoKey` — the derived key
 * is never a JavaScript value, so it cannot be read out of a heap dump or
 * logged by accident. React Native has no WebCrypto, and
 * `PortableCryptoService` serves that target with an identical envelope.
 *
 * No cryptography is implemented here — every primitive comes from WebCrypto.
 */
export class WebCryptoService implements CryptoService {
  private readonly iterations: number;

  constructor(iterations: number = DEFAULT_KDF_ITERATIONS) {
    // The configuration is held to the same policy the read path enforces. A
    // service that accepted a cost here which `assertSupportedPayload` later
    // refused would produce backups it could not itself restore.
    assertAllowedIterationCount(iterations);
    this.iterations = iterations;
  }

  private async deriveKey(
    passphrase: string,
    salt: Uint8Array,
    iterations: number,
  ): Promise<CryptoKey> {
    try {
      const material = await globalThis.crypto.subtle.importKey(
        'raw',
        utf8Encode(passphrase) as BufferSource,
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      return await globalThis.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: KEY_LENGTH_BITS },
        // Not extractable: the derived key cannot be read back out.
        false,
        ['encrypt', 'decrypt'],
      );
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.KEY_DERIVATION_FAILED, cause);
    }
  }

  async encrypt(
    plaintext: string,
    passphrase: string,
    context: EncryptionContext,
  ): Promise<EncryptedPayload> {
    // A fresh salt and a fresh nonce for every single encryption.
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    try {
      const key = await this.deriveKey(passphrase, salt, this.iterations);
      const ciphertext = await globalThis.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv as BufferSource,
          additionalData: additionalData(context, this.iterations, PAYLOAD_VERSION) as BufferSource,
        },
        key,
        utf8Encode(plaintext) as BufferSource,
      );
      return {
        ciphertext: toBase64(new Uint8Array(ciphertext)),
        iv: toBase64(iv),
        salt: toBase64(salt),
        algorithm: 'AES-GCM',
        iterations: this.iterations,
        version: PAYLOAD_VERSION,
      };
    } catch (cause) {
      if (cause instanceof SecurityError) throw cause;
      throw new SecurityError(SecurityErrorCode.ENCRYPTION_FAILED, cause);
    }
  }

  async decrypt(
    payload: EncryptedPayload,
    passphrase: string,
    context: EncryptionContext,
  ): Promise<string> {
    // Validate the envelope before spending any work on it.
    assertSupportedPayload(payload);
    try {
      const key = await this.deriveKey(passphrase, fromBase64(payload.salt), payload.iterations);
      const plaintext = await globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromBase64(payload.iv) as BufferSource,
          additionalData: additionalData(
            context,
            payload.iterations,
            payload.version,
          ) as BufferSource,
        },
        key,
        fromBase64(payload.ciphertext) as BufferSource,
      );
      return utf8Decode(new Uint8Array(plaintext));
    } catch (cause) {
      if (cause instanceof SecurityError) throw cause;
      throw new SecurityError(SecurityErrorCode.DECRYPTION_FAILED, cause);
    }
  }

  async hash(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      utf8Encode(value) as BufferSource,
    );
    return toBase64(new Uint8Array(digest));
  }

  private async deriveDigest(
    secret: string,
    salt: Uint8Array,
    iterations: number,
  ): Promise<Uint8Array> {
    try {
      const material = await globalThis.crypto.subtle.importKey(
        'raw',
        utf8Encode(secret) as BufferSource,
        'PBKDF2',
        false,
        ['deriveBits'],
      );
      const bits = await globalThis.crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
        material,
        KEY_LENGTH_BITS,
      );
      return new Uint8Array(bits);
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.KEY_DERIVATION_FAILED, cause);
    }
  }

  async hashSecret(secret: string): Promise<SecretHash> {
    const salt = randomBytes(SALT_BYTES);
    const digest = await this.deriveDigest(secret, salt, this.iterations);
    return {
      version: SECRET_HASH_VERSION,
      algorithm: 'PBKDF2-SHA256',
      salt: toBase64(salt),
      iterations: this.iterations,
      digest: toBase64(digest),
    };
  }

  async verifySecret(secret: string, stored: SecretHash): Promise<boolean> {
    assertSupportedSecretHash(stored);
    const candidate = await this.deriveDigest(secret, fromBase64(stored.salt), stored.iterations);
    return equalsConstantTime(candidate, fromBase64(stored.digest));
  }
}
