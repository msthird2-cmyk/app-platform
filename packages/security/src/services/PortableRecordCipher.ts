import { gcm } from '@noble/ciphers/aes.js';
import { KEY_LENGTH_BITS, IV_BYTES } from '../crypto/envelope';
import { drawRandomBytes, type RandomBytes } from '../crypto/entropy';
import { SecurityError, SecurityErrorCode } from '../errors';
import { utf8Decode, utf8Encode } from '../crypto/utf8';
import type { RecordCipher } from '../types/recordCipher';

const KEY_BYTES = KEY_LENGTH_BITS / 8;

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new SecurityError(SecurityErrorCode.DATA_KEY_UNAVAILABLE);
  }
}

/**
 * The record cipher for React Native, over the same `@noble/ciphers` AES-GCM
 * that `PortableCryptoService` already uses. No new dependency, and no second
 * AES implementation — only a second *key source*, since there is nothing to
 * derive when the key arrives ready.
 *
 * Byte-compatible with `WebRecordCipher` by construction: same algorithm, same
 * nonce length, same additional data. `tests/recordCipherContract.ts` proves it
 * both ways, because a record written on one device has to open on another.
 */
export class PortableRecordCipher implements RecordCipher {
  constructor(private readonly randomBytes: RandomBytes) {}

  async encrypt(plaintext: string, key: Uint8Array, additionalData: Uint8Array) {
    assertKey(key);
    const iv = drawRandomBytes(this.randomBytes, IV_BYTES);
    const message = utf8Encode(plaintext);
    try {
      return { iv, ciphertext: gcm(key, iv, additionalData).encrypt(message) };
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.ENCRYPTION_FAILED, cause);
    } finally {
      // The key belongs to the caller and is not wiped here; the plaintext
      // copy this function made is.
      message.fill(0);
    }
  }

  async decrypt(
    ciphertext: Uint8Array,
    iv: Uint8Array,
    key: Uint8Array,
    additionalData: Uint8Array,
  ): Promise<string> {
    assertKey(key);
    let plaintext: Uint8Array | null = null;
    try {
      plaintext = gcm(key, iv, additionalData).decrypt(ciphertext);
      return utf8Decode(plaintext);
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.DECRYPTION_FAILED, cause);
    } finally {
      plaintext?.fill(0);
    }
  }
}
