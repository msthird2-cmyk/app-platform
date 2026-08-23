import { SecurityError, SecurityErrorCode } from '../errors';
import type { CryptoService, EncryptedPayload } from '../types/crypto';

const ITERATIONS = 210_000;
const KEY_LENGTH = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * AES-GCM with a PBKDF2-derived key. Available on web and on React Native
 * runtimes that expose WebCrypto; native builds inject a keystore-backed
 * implementation of the same interface instead.
 */
export class WebCryptoService implements CryptoService {
  constructor(private readonly iterations: number = ITERATIONS) {}

  private async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    try {
      const material = await globalThis.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      return await globalThis.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: this.iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt'],
      );
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.KEY_DERIVATION_FAILED, cause);
    }
  }

  async encrypt(plaintext: string, passphrase: string): Promise<EncryptedPayload> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    try {
      const key = await this.deriveKey(passphrase, salt);
      const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        new TextEncoder().encode(plaintext),
      );
      return {
        ciphertext: toBase64(new Uint8Array(ciphertext)),
        iv: toBase64(iv),
        salt: toBase64(salt),
        algorithm: 'AES-GCM',
        iterations: this.iterations,
        version: 1,
      };
    } catch (cause) {
      if (cause instanceof SecurityError) throw cause;
      throw new SecurityError(SecurityErrorCode.ENCRYPTION_FAILED, cause);
    }
  }

  async decrypt(payload: EncryptedPayload, passphrase: string): Promise<string> {
    const salt = fromBase64(payload.salt);
    const iv = fromBase64(payload.iv);
    try {
      const material = await globalThis.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      const key = await globalThis.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: payload.iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt'],
      );
      const plaintext = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        key,
        fromBase64(payload.ciphertext) as BufferSource,
      );
      return new TextDecoder().decode(plaintext);
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.DECRYPTION_FAILED, cause);
    }
  }

  async hash(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return toBase64(new Uint8Array(digest));
  }
}
