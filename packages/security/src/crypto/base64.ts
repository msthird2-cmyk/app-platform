import { SecurityError, SecurityErrorCode } from '../errors';

/**
 * Base64 without `btoa`/`atob`.
 *
 * React Native's Hermes runtime provides neither, so an implementation that
 * reaches for them works on web and throws on a phone. This is byte-identical
 * to `btoa`/`atob` for the canonical padded output both of them produce, which
 * is what every existing backup envelope contains.
 *
 * Decoding is strict where `atob` is lenient. The input is attacker-controlled
 * — it arrives inside an envelope — and silently discarding stray characters
 * would let two different strings decode to the same bytes.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = /* @__PURE__ */ (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2] as string;
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)] as string;
    out += b1 === undefined ? '=' : (ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)] as string);
    out += b2 === undefined ? '=' : (ALPHABET[b2 & 0x3f] as string);
  }
  return out;
}

function invalid(): never {
  throw new SecurityError(SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID);
}

export function fromBase64(value: string): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 !== 0) invalid();
  if (value.length === 0) return new Uint8Array(0);

  let padding = 0;
  if (value.charCodeAt(value.length - 1) === 0x3d) padding += 1;
  if (value.charCodeAt(value.length - 2) === 0x3d) padding += 1;

  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let offset = 0;

  for (let i = 0; i < value.length; i += 4) {
    const chunk: number[] = [];
    for (let j = 0; j < 4; j += 1) {
      const code = value.charCodeAt(i + j);
      // Padding is legal only in the final quantum's last two positions, and
      // "==" is the only two-character form — "AB=C" would otherwise decode as
      // though the pad were a zero.
      if (code === 0x3d) {
        if (i + 4 !== value.length || j < 2) invalid();
        if (j === 2 && value.charCodeAt(i + 3) !== 0x3d) invalid();
        chunk.push(0);
        continue;
      }
      const index = code < 128 ? (LOOKUP[code] as number) : -1;
      if (index < 0) invalid();
      chunk.push(index);
    }
    const [c0, c1, c2, c3] = chunk as [number, number, number, number];
    if (offset < bytes.length) bytes[offset++] = (c0 << 2) | (c1 >> 4);
    if (offset < bytes.length) bytes[offset++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (offset < bytes.length) bytes[offset++] = ((c2 & 0x03) << 6) | c3;
  }
  return bytes;
}
