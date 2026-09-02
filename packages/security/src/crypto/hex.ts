/**
 * Lowercase hex, for values that have to survive a storage key charset.
 *
 * `expo-secure-store` rejects any key containing something outside
 * `[A-Za-z0-9._-]`, and base64 cannot clear that bar — `+`, `/` and `=` are all
 * outside it. Hex is the shortest encoding that is unconditionally inside it,
 * with no padding rules to get wrong.
 *
 * Encoding only. Nothing in this system needs to read a hex string back: the
 * one use is a storage address, which is written and compared, never decoded.
 * Adding a decoder would be adding an untested parser to the security package
 * for no caller.
 */

const DIGITS = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] as number;
    // Both nibbles, always. A byte below 0x10 emitted as one digit would make
    // [0x01, 0x02] and [0x12] encode identically.
    out += DIGITS[byte >> 4] as string;
    out += DIGITS[byte & 0x0f] as string;
  }
  return out;
}
