/**
 * UTF-8 without `TextEncoder`/`TextDecoder`.
 *
 * Neither is provided by React Native 0.76 or by `@react-native/js-polyfills`,
 * and Hermes does not guarantee them, so the same reasoning as `base64.ts`
 * applies: a shared module that used them would work on web and fail on a
 * phone.
 *
 * Byte-for-byte equivalent to `TextEncoder`, including the WHATWG rule that an
 * unpaired surrogate encodes as U+FFFD rather than as an invalid three-byte
 * sequence. `tests/codecs.test.ts` asserts that equivalence against the real
 * `TextEncoder` over a corpus, because a divergence here would silently change
 * the derived key for any passphrase outside ASCII.
 */
const REPLACEMENT = 0xfffd;

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = (cp - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        i += 1;
      } else {
        cp = REPLACEMENT;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = REPLACEMENT;
    }

    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

function appendCodePoint(parts: string[], cp: number): void {
  if (cp < 0x10000) {
    parts.push(String.fromCharCode(cp));
    return;
  }
  const value = cp - 0x10000;
  parts.push(String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff)));
}

/**
 * The WHATWG UTF-8 decoder, including the part that is easy to miss: the legal
 * range for the *second* byte depends on the lead byte, and is narrower than
 * 0x80-0xBF for four of them. Checking only "is a continuation byte" and
 * catching over-long forms afterwards produces the right code points but the
 * wrong number of replacement characters, because the sequence is rejected one
 * byte later than the specification rejects it. The sweep in
 * `tests/codecs.test.ts` compares against `TextDecoder` over every 1- and
 * 2-byte input, which is how that was caught.
 */
interface LeadByte {
  width: number;
  bits: number;
  lower: number;
  upper: number;
}

function classifyLead(b0: number): LeadByte | null {
  if (b0 >= 0xc2 && b0 <= 0xdf) return { width: 2, bits: b0 & 0x1f, lower: 0x80, upper: 0xbf };
  if (b0 >= 0xe0 && b0 <= 0xef) {
    // 0xE0 with a second byte below 0xA0 is an over-long form; 0xED above 0x9F
    // is a surrogate. Both are rejected at the second byte.
    return {
      width: 3,
      bits: b0 & 0x0f,
      lower: b0 === 0xe0 ? 0xa0 : 0x80,
      upper: b0 === 0xed ? 0x9f : 0xbf,
    };
  }
  if (b0 >= 0xf0 && b0 <= 0xf4) {
    // 0xF0 below 0x90 is over-long; 0xF4 above 0x8F is beyond U+10FFFF.
    return {
      width: 4,
      bits: b0 & 0x07,
      lower: b0 === 0xf0 ? 0x90 : 0x80,
      upper: b0 === 0xf4 ? 0x8f : 0xbf,
    };
  }
  // 0x80-0xBF is a continuation with no lead; 0xC0/0xC1 are over-long; 0xF5
  // and above are beyond the Unicode range.
  return null;
}

export function utf8Decode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let i = 0;

  while (i < bytes.length) {
    const b0 = bytes[i] as number;

    if (b0 < 0x80) {
      parts.push(String.fromCharCode(b0));
      i += 1;
      continue;
    }

    const lead = classifyLead(b0);
    if (lead === null) {
      parts.push(String.fromCharCode(REPLACEMENT));
      i += 1;
      continue;
    }

    let cp = lead.bits;
    let consumed = 1;
    let rejected = false;

    while (consumed < lead.width && i + consumed < bytes.length) {
      const cont = bytes[i + consumed] as number;
      const lower = consumed === 1 ? lead.lower : 0x80;
      const upper = consumed === 1 ? lead.upper : 0xbf;
      if (cont < lower || cont > upper) {
        rejected = true;
        break;
      }
      cp = (cp << 6) | (cont & 0x3f);
      consumed += 1;
    }

    // A byte outside the legal range is re-examined as a fresh lead, so the
    // recovery point is the offending byte itself.
    if (rejected) {
      parts.push(String.fromCharCode(REPLACEMENT));
      i += consumed;
      continue;
    }

    // Truncated by the end of the input: one replacement, however many bytes
    // were pending.
    if (consumed < lead.width) {
      parts.push(String.fromCharCode(REPLACEMENT));
      break;
    }

    appendCodePoint(parts, cp);
    i += lead.width;
  }

  return parts.join('');
}
