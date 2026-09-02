import { describe, expect, it } from 'vitest';
import { toHex } from '../src/crypto/hex';

/**
 * Hex exists for one reason: a storage address must survive
 * `expo-secure-store`'s key charset, which is `[A-Za-z0-9._-]`. Base64 cannot —
 * `+`, `/` and `=` are all outside it. So the properties that matter here are
 * the charset and the determinism, not general-purpose codec completeness.
 */
describe('toHex', () => {
  it('encodes the known vectors', () => {
    expect(toHex(new Uint8Array([]))).toBe('');
    expect(toHex(new Uint8Array([0]))).toBe('00');
    expect(toHex(new Uint8Array([255]))).toBe('ff');
    expect(toHex(new Uint8Array([0, 15, 16, 171, 205, 239]))).toBe('000f10abcdef');
  });

  it('pads every byte to two digits, so the length is always doubled', () => {
    // The failure this catches is the classic one: a byte below 0x10 encoded as
    // a single digit, which silently makes two different inputs collide.
    for (const length of [0, 1, 2, 7, 32, 33]) {
      const bytes = Uint8Array.from({ length }, (_, i) => i);
      expect(toHex(bytes)).toHaveLength(length * 2);
    }
    expect(toHex(new Uint8Array([1, 2]))).toBe('0102');
  });

  it('emits only lowercase hex, which is inside the storage key charset', () => {
    const all = toHex(Uint8Array.from({ length: 256 }, (_, i) => i));
    expect(all).toMatch(/^[0-9a-f]+$/);
    // Stated against the actual constraint rather than a general character
    // class: expo-secure-store permits alphanumerics, '.', '-' and '_'.
    expect(all).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('is deterministic and injective over distinct inputs', () => {
    const a = Uint8Array.from({ length: 32 }, (_, i) => i);
    const b = Uint8Array.from({ length: 32 }, (_, i) => i);
    b[31] = 99;
    expect(toHex(a)).toBe(toHex(a));
    expect(toHex(a)).not.toBe(toHex(b));
  });
});
