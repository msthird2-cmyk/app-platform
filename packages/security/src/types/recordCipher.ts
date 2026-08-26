/**
 * AES-256-GCM under a key that is already a key.
 *
 * The deliberately narrow counterpart to `CryptoService`. That interface takes
 * a passphrase and stretches it; this one takes 32 raw bytes and uses them
 * directly, because the DEK needs no stretching and cannot afford it.
 *
 * It is an interface rather than a class for the same reason `CryptoService`
 * is: WebCrypto can hold the key as a non-extractable `CryptoKey` that
 * JavaScript never sees the bytes of, and React Native has no WebCrypto at all.
 * The two implementations share the envelope and the additional data, and
 * `tests/recordCipherContract.ts` runs the same battery against both so they
 * cannot drift.
 */
export interface RecordCipher {
  /** Returns the fresh nonce alongside the ciphertext. */
  encrypt(
    plaintext: string,
    key: Uint8Array,
    additionalData: Uint8Array,
  ): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }>;
  decrypt(
    ciphertext: Uint8Array,
    iv: Uint8Array,
    key: Uint8Array,
    additionalData: Uint8Array,
  ): Promise<string>;
}
