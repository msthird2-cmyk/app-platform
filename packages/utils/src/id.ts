const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** Collision-resistant, URL-safe identifier. Not a secret — see packages/security for those. */
export function createId(length = 16): string {
  const bytes = randomBytes(length);
  let id = '';
  for (const byte of bytes) {
    id += ALPHABET[byte % ALPHABET.length];
  }
  return id;
}
