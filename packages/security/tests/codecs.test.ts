import { describe, expect, it } from 'vitest';
import { fromBase64, toBase64 } from '../src/crypto/base64';
import { utf8Decode, utf8Encode } from '../src/crypto/utf8';
import { SecurityErrorCode } from '../src/errors';

/**
 * These replace `btoa`/`atob`/`TextEncoder`/`TextDecoder`, which React Native
 * does not provide. A divergence would not throw — it would silently change
 * the bytes fed to PBKDF2, so a passphrase would derive a different key on a
 * phone than on the web and the data would simply be unreadable. So they are
 * checked against the real implementations rather than against themselves.
 */
const CORPUS = [
  '',
  'a',
  'ab',
  'abc',
  'abcd',
  'net worth: 1234',
  'correct horse battery staple',
  '{"v":1,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","it":210000,"uid":"u","app":"Net Worth"}',
  'café',
  'naïve façade',
  'ключ',
  '日本語のパスフレーズ',
  '\u{1f510}\u{1f511}',
  'a\u{1f510}b',
  'é',
  ' ',
  '�',
  'mixed ascii + café + 日本 + \u{1f510}',
];

describe('base64', () => {
  it('matches btoa for byte sequences', () => {
    for (let length = 0; length <= 64; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 37 + length) % 256);
      const expected = btoa(String.fromCharCode(...bytes));
      expect(toBase64(bytes), `length ${length}`).toBe(expected);
    }
  });

  it('matches atob for the strings btoa produces', () => {
    for (let length = 0; length <= 64; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, i) => (i * 91 + 7) % 256);
      const encoded = btoa(String.fromCharCode(...bytes));
      expect(Array.from(fromBase64(encoded)), `length ${length}`).toEqual(Array.from(bytes));
    }
  });

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(fromBase64(toBase64(all)))).toEqual(Array.from(all));
  });

  // atob is lenient; this is not. The input arrives inside an attacker-supplied
  // envelope, and two spellings decoding to the same bytes is a malleability
  // that AES-GCM's tag cannot see, because the tag covers the decoded bytes.
  it('rejects malformed input rather than guessing', () => {
    const bad = ['A', 'AB', 'ABC', 'A===', '====', 'AB=C', 'A=BC', '****', 'AB C=', 'AAAA='];
    for (const value of bad) {
      expect(() => fromBase64(value), value).toThrowError(
        expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
      );
    }
  });

  it('accepts canonical padded input', () => {
    expect(Array.from(fromBase64('AA=='))).toEqual([0]);
    expect(Array.from(fromBase64('AAA='))).toEqual([0, 0]);
    expect(Array.from(fromBase64('AAAA'))).toEqual([0, 0, 0]);
    expect(Array.from(fromBase64(''))).toEqual([]);
  });
});

describe('utf8', () => {
  it('encodes exactly as TextEncoder does', () => {
    const encoder = new TextEncoder();
    for (const text of CORPUS) {
      expect(Array.from(utf8Encode(text)), JSON.stringify(text)).toEqual(
        Array.from(encoder.encode(text)),
      );
    }
  });

  it('decodes exactly as TextDecoder does', () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    for (const text of CORPUS) {
      const bytes = encoder.encode(text);
      expect(utf8Decode(bytes), JSON.stringify(text)).toBe(decoder.decode(bytes));
    }
  });

  it('round-trips the corpus', () => {
    for (const text of CORPUS) {
      expect(utf8Decode(utf8Encode(text))).toBe(text);
    }
  });

  it('replaces an unpaired surrogate the way TextEncoder does', () => {
    const encoder = new TextEncoder();
    const cases = ['\ud800', '\udc00', 'a\ud800b', '\ud800\ud800', 'x\udfff'];
    for (const text of cases) {
      expect(Array.from(utf8Encode(text)), JSON.stringify(text)).toEqual(
        Array.from(encoder.encode(text)),
      );
    }
  });

  it('replaces malformed byte sequences the way TextDecoder does', () => {
    const decoder = new TextDecoder();
    const malformed = [
      [0x80],
      [0xff],
      [0xc0, 0x80],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xe2, 0x28, 0xa1],
      [0xf0, 0x9f, 0x94],
    ];
    for (const bytes of malformed) {
      const input = Uint8Array.from(bytes);
      expect(utf8Decode(input), JSON.stringify(bytes)).toBe(decoder.decode(input));
    }
  });

  it('encodes a 4-byte code point as four bytes', () => {
    expect(Array.from(utf8Encode('\u{1f510}'))).toEqual([0xf0, 0x9f, 0x94, 0x90]);
  });
});

/**
 * Two hand-written cases in the suite above were wrong on the first attempt —
 * a base64 quantum spelled "AB=C", and a 4-byte UTF-8 sequence truncated by
 * the end of input. Hand-picked cases are not enough for a codec whose failure
 * mode is silent, so these sweep the space instead.
 */
describe('codec sweeps against the platform implementations', () => {
  it('decodes every 1- and 2-byte sequence exactly as TextDecoder does', () => {
    const decoder = new TextDecoder();
    for (let a = 0; a < 256; a += 1) {
      const one = Uint8Array.of(a);
      expect(utf8Decode(one), `[${a}]`).toBe(decoder.decode(one));
      for (let b = 0; b < 256; b += 1) {
        const two = Uint8Array.of(a, b);
        if (utf8Decode(two) !== decoder.decode(two)) {
          // Compared by hand before asserting: 65536 assertions per byte pair
          // makes the reporter unusable when one fails.
          expect(utf8Decode(two), `[${a},${b}]`).toBe(decoder.decode(two));
        }
      }
    }
  });

  it('decodes pseudo-random 3- and 4-byte sequences exactly as TextDecoder does', () => {
    const decoder = new TextDecoder();
    // Deterministic LCG: a fixed corpus, so a failure is always reproducible.
    let seed = 0x2545f491;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >> 8) & 0xff;
    };
    for (let n = 0; n < 20_000; n += 1) {
      const length = 3 + (n % 2);
      const bytes = Uint8Array.from({ length }, () => next());
      if (utf8Decode(bytes) !== decoder.decode(bytes)) {
        expect(utf8Decode(bytes), Array.from(bytes).join(',')).toBe(decoder.decode(bytes));
      }
    }
  });

  it('encodes every code point in the BMP exactly as TextEncoder does', () => {
    const encoder = new TextEncoder();
    for (let cp = 0; cp <= 0xffff; cp += 1) {
      const text = String.fromCharCode(cp);
      const mine = utf8Encode(text);
      const theirs = encoder.encode(text);
      if (mine.length !== theirs.length || mine.some((byte, i) => byte !== theirs[i])) {
        expect(Array.from(mine), `U+${cp.toString(16)}`).toEqual(Array.from(theirs));
      }
    }
  });

  it('encodes astral code points exactly as TextEncoder does', () => {
    const encoder = new TextEncoder();
    for (let cp = 0x10000; cp <= 0x10ffff; cp += 977) {
      const text = String.fromCodePoint(cp);
      const mine = utf8Encode(text);
      const theirs = encoder.encode(text);
      if (mine.length !== theirs.length || mine.some((byte, i) => byte !== theirs[i])) {
        expect(Array.from(mine), `U+${cp.toString(16)}`).toEqual(Array.from(theirs));
      }
    }
  });

  it('round-trips base64 over pseudo-random buffers', () => {
    let seed = 0x9e3779b9;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      return (seed >> 8) & 0xff;
    };
    for (let length = 0; length < 300; length += 1) {
      const bytes = Uint8Array.from({ length }, () => next());
      const encoded = toBase64(bytes);
      expect(encoded, `length ${length}`).toBe(btoa(String.fromCharCode(...bytes)));
      expect(Array.from(fromBase64(encoded)), `length ${length}`).toEqual(Array.from(bytes));
    }
  });
});
