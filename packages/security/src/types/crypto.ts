export interface EncryptedPayload {
  /** Base64 ciphertext. Never logged, never persisted in plaintext. */
  ciphertext: string;
  iv: string;
  salt: string;
  algorithm: 'AES-GCM';
  iterations: number;
  version: 1;
}

/**
 * Context bound into the payload as AES-GCM additional authenticated data, so
 * a bundle cannot be replayed against a different owner or application.
 */
export interface EncryptionContext {
  userId: string;
  appName: string;
  /**
   * Domain separation for keys derived from something other than a passphrase.
   *
   * `docs/ARCHITECTURE.md` requires that a recovery code used to derive an
   * encryption key keep that KDF purpose separate from credential
   * verification. Naming the purpose in the authenticated data is how: an
   * escrow envelope cannot be replayed as a backup envelope, because the tag
   * covers the purpose.
   *
   * Optional, and omitting it produces byte-identical additional data to
   * before this field existed — otherwise every payload already written would
   * become undecryptable. See `additionalData`.
   */
  purpose?: string | undefined;
}

/**
 * A stored one-way hash of a secret. Unlike a bare digest this carries its own
 * salt and cost, so verification does not depend on a global parameter that
 * might later change.
 */
export interface SecretHash {
  version: 1;
  algorithm: 'PBKDF2-SHA256';
  salt: string;
  iterations: number;
  digest: string;
}

export interface CryptoService {
  encrypt(plaintext: string, passphrase: string, context: EncryptionContext): Promise<EncryptedPayload>;
  decrypt(payload: EncryptedPayload, passphrase: string, context: EncryptionContext): Promise<string>;
  /** Fast digest for integrity checks only — never for a secret. */
  hash(value: string): Promise<string>;
  /** Slow, salted hash for values that must resist offline attack. */
  hashSecret(secret: string): Promise<SecretHash>;
  /** Constant-time verification of a secret against its stored hash. */
  verifySecret(secret: string, stored: SecretHash): Promise<boolean>;
}
