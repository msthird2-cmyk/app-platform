import { KEY_LENGTH_BITS, IV_BYTES } from '../crypto/envelope';
import { drawRandomBytes, type RandomBytes } from '../crypto/entropy';
import { SecurityError, SecurityErrorCode } from '../errors';
import { utf8Decode, utf8Encode } from '../crypto/utf8';
import type { RecordCipher } from '../types/recordCipher';

/** AES-256 keys are 32 bytes. Anything else did not come from this system. */
const KEY_BYTES = KEY_LENGTH_BITS / 8;

function assertKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new SecurityError(SecurityErrorCode.DATA_KEY_UNAVAILABLE);
  }
}

/**
 * The WebCrypto record cipher.
 *
 * `importKey('raw', …, false, …)` is the whole point: the DEK bytes go in once
 * and the resulting `CryptoKey` is non-extractable, so the browser holds the
 * key and JavaScript cannot read it back out. No PBKDF2 is reachable from this
 * file — there is no passphrase here to stretch.
 */
export class WebRecordCipher implements RecordCipher {
  constructor(private readonly randomBytes: RandomBytes) {}

  private async importKey(key: Uint8Array): Promise<CryptoKey> {
    assertKey(key);
    try {
      return await globalThis.crypto.subtle.importKey(
        'raw',
        key as BufferSource,
        { name: 'AES-GCM', length: KEY_LENGTH_BITS },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.ENCRYPTION_FAILED, cause);
    }
  }

  async encrypt(plaintext: string, key: Uint8Array, additionalData: Uint8Array) {
    // A fresh nonce for every single encryption. Reusing one under the same
    // key is the catastrophic failure mode of GCM.
    const iv = drawRandomBytes(this.randomBytes, IV_BYTES);
    const imported = await this.importKey(key);
    try {
      const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: additionalData as BufferSource },
        imported,
        utf8Encode(plaintext) as BufferSource,
      );
      return { iv, ciphertext: new Uint8Array(ciphertext) };
    } catch (cause) {
      if (cause instanceof SecurityError) throw cause;
      throw new SecurityError(SecurityErrorCode.ENCRYPTION_FAILED, cause);
    }
  }

  async decrypt(
    ciphertext: Uint8Array,
    iv: Uint8Array,
    key: Uint8Array,
    additionalData: Uint8Array,
  ): Promise<string> {
    const imported = await this.importKey(key);
    try {
      const plaintext = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: additionalData as BufferSource },
        imported,
        ciphertext as BufferSource,
      );
      return utf8Decode(new Uint8Array(plaintext));
    } catch (cause) {
      if (cause instanceof SecurityError) throw cause;
      // A wrong key, a tampered ciphertext, a tampered nonce and wrong
      // additional data are one outcome here, and that is correct: none of
      // them produced a record.
      throw new SecurityError(SecurityErrorCode.DECRYPTION_FAILED, cause);
    }
  }
}
