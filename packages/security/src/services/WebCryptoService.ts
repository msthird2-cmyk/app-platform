import { SecurityError, SecurityErrorCode } from '../errors';
import type {
  CryptoService,
  EncryptedPayload,
  EncryptionContext,
  SecretHash,
} from '../types/crypto';

const ITERATIONS = 210_000;
const KEY_LENGTH = 256;
const PAYLOAD_VERSION = 1;
const SECRET_HASH_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Guards against a hostile payload steering the key-derivation cost. */
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 1_000_000;

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

/** Comparison whose duration does not depend on where the first difference is. */
function equalsConstantTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

/**
 * Binds the envelope to the ciphertext. Anything an attacker could otherwise
 * edit freely — the owner, the application, the algorithm, the cost — is
 * authenticated, so tampering fails the GCM tag rather than silently changing
 * how the payload is read.
 */
function additionalData(
  context: EncryptionContext,
  iterations: number,
  version: number,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      v: version,
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      it: iterations,
      uid: context.userId,
      app: context.appName,
    }),
  );
}

function assertSupportedPayload(payload: EncryptedPayload): void {
  if (payload.version !== PAYLOAD_VERSION) {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED);
  }
  if (payload.algorithm !== 'AES-GCM') {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_ALGORITHM_UNSUPPORTED);
  }
  if (
    typeof payload.iterations !== 'number' ||
    !Number.isInteger(payload.iterations) ||
    payload.iterations < MIN_ITERATIONS ||
    payload.iterations > MAX_ITERATIONS
  ) {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID);
  }
}

/**
 * AES-256-GCM with a PBKDF2-SHA256 derived key. Available on web and on React
 * Native runtimes that expose WebCrypto; native builds inject a keystore-backed
 * implementation of the same interface instead.
 *
 * No cryptography is implemented here — every primitive comes from WebCrypto.
 */
export class WebCryptoService implements CryptoService {
  constructor(private readonly iterations: number = ITERATIONS) {
    if (iterations < 1) throw new SecurityError(SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID);
  }

  private async deriveKey(
    passphrase: string,
    salt: Uint8Array,
    iterations: number,
  ): Promise<CryptoKey> {
    try {
      const material = await globalThis.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      return await globalThis.crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: KEY_LENGTH },
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
        new TextEncoder().encode(plaintext),
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
      return new TextDecoder().decode(plaintext);
    } catch (cause) {
      if (cause instanceof SecurityError) throw cause;
      throw new SecurityError(SecurityErrorCode.DECRYPTION_FAILED, cause);
    }
  }

  async hash(value: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
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
        new TextEncoder().encode(secret),
        'PBKDF2',
        false,
        ['deriveBits'],
      );
      const bits = await globalThis.crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
        material,
        256,
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
    if (stored.version !== SECRET_HASH_VERSION || stored.algorithm !== 'PBKDF2-SHA256') {
      throw new SecurityError(SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED);
    }
    if (
      !Number.isInteger(stored.iterations) ||
      stored.iterations < MIN_ITERATIONS ||
      stored.iterations > MAX_ITERATIONS
    ) {
      throw new SecurityError(SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID);
    }
    const candidate = await this.deriveDigest(secret, fromBase64(stored.salt), stored.iterations);
    return equalsConstantTime(candidate, fromBase64(stored.digest));
  }
}
