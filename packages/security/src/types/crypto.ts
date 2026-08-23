export interface EncryptedPayload {
  /** Base64 ciphertext. Never logged, never persisted in plaintext. */
  ciphertext: string;
  iv: string;
  salt: string;
  algorithm: 'AES-GCM';
  iterations: number;
  version: 1;
}

export interface CryptoService {
  encrypt(plaintext: string, passphrase: string): Promise<EncryptedPayload>;
  decrypt(payload: EncryptedPayload, passphrase: string): Promise<string>;
  hash(value: string): Promise<string>;
}
