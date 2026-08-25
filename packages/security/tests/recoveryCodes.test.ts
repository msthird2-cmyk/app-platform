import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECOVERY_CODE_LIFETIME_MS,
  RECOVERY_CODE_ENTROPY_BITS,
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  remainingRecoveryCodes,
  verifyRecoveryCode,
} from '../src/recoveryCodes';
import { WebCryptoService } from '../src/services/WebCryptoService';
import { SecurityErrorCode } from '../src/errors';

const crypto = new WebCryptoService(100_000);
const NOW = 1_700_000_000_000;

/** The platform's generator, injected the way a composition root injects it. */
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

describe('generation', () => {
  it('generates codes in the documented shape', () => {
    expect(generateRecoveryCode(randomBytes)).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('omits ambiguous characters', () => {
    expect(generateRecoveryCodes(randomBytes, 40).join('')).not.toMatch(/[IO01]/);
  });

  it('carries 60 bits of entropy over an unbiased alphabet', () => {
    // 32 symbols divides 256 exactly, so the byte-modulo draw is uniform.
    expect(RECOVERY_CODE_ENTROPY_BITS).toBe(60);
  });

  it('does not repeat across a large sample', () => {
    const codes = generateRecoveryCodes(randomBytes, 500);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('normalizes user typing and rejects a wrong length', () => {
    expect(normalizeRecoveryCode('k7qm 2xpd9rtf')).toBe('K7QM-2XPD-9RTF');
    expect(() => normalizeRecoveryCode('K7QM-2XPD')).toThrow();
  });
});

describe('storage', () => {
  it('never persists the plaintext, and salts every code', async () => {
    const codes = generateRecoveryCodes(randomBytes, 3);
    const records = await hashRecoveryCodes(codes, crypto, { now: NOW });
    const serialized = JSON.stringify(records);
    for (const code of codes) expect(serialized).not.toContain(code);
    expect(new Set(records.map((r) => r.hash.salt)).size).toBe(3);
  });

  it('stores a slow hash rather than a bare digest', async () => {
    const [record] = await hashRecoveryCodes(['K7QM-2XPD-9RTF'], crypto, { now: NOW });
    expect(record!.hash.algorithm).toBe('PBKDF2-SHA256');
    expect(record!.hash.digest).not.toBe(await crypto.hash('K7QM-2XPD-9RTF'));
  });

  it('sets an expiry', async () => {
    const [record] = await hashRecoveryCodes(['K7QM-2XPD-9RTF'], crypto, { now: NOW });
    expect(record!.expiresAt).toBe(NOW + DEFAULT_RECOVERY_CODE_LIFETIME_MS);
    expect(record!.usedAt).toBeNull();
  });
});

describe('verification', () => {
  it('accepts a valid code and consumes it', async () => {
    const codes = generateRecoveryCodes(randomBytes, 3);
    const records = await hashRecoveryCodes(codes, crypto, { now: NOW });

    const first = await verifyRecoveryCode(codes[1]!, records, crypto, NOW);
    expect(first.valid).toBe(true);
    expect(remainingRecoveryCodes(first.records, NOW)).toBe(2);
  });

  it('refuses the same code a second time', async () => {
    const codes = generateRecoveryCodes(randomBytes, 2);
    const records = await hashRecoveryCodes(codes, crypto, { now: NOW });

    const first = await verifyRecoveryCode(codes[0]!, records, crypto, NOW);
    const replay = await verifyRecoveryCode(codes[0]!, first.records, crypto, NOW);
    expect(replay.valid).toBe(false);
    expect(replay.reason).toBe('ALREADY_USED');
  });

  it('refuses an expired code', async () => {
    const codes = generateRecoveryCodes(randomBytes, 1);
    const records = await hashRecoveryCodes(codes, crypto, { now: NOW, lifetimeMs: 1000 });
    const result = await verifyRecoveryCode(codes[0]!, records, crypto, NOW + 1001);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('EXPIRED');
    expect(remainingRecoveryCodes(records, NOW + 1001)).toBe(0);
  });

  it('rejects an unknown code without throwing', async () => {
    const records = await hashRecoveryCodes(generateRecoveryCodes(randomBytes, 2), crypto, { now: NOW });
    await expect(verifyRecoveryCode('ZZZZ-ZZZZ-ZZZZ', records, crypto, NOW)).resolves.toMatchObject({
      valid: false,
      reason: 'INVALID',
    });
  });

  it('rejects malformed input without throwing', async () => {
    const records = await hashRecoveryCodes(generateRecoveryCodes(randomBytes, 2), crypto, { now: NOW });
    await expect(verifyRecoveryCode('nonsense', records, crypto, NOW)).resolves.toMatchObject({
      valid: false,
      reason: 'INVALID',
    });
  });

  it('leaves the other codes usable', async () => {
    const codes = generateRecoveryCodes(randomBytes, 3);
    const records = await hashRecoveryCodes(codes, crypto, { now: NOW });
    const used = await verifyRecoveryCode(codes[0]!, records, crypto, NOW);
    await expect(verifyRecoveryCode(codes[2]!, used.records, crypto, NOW)).resolves.toMatchObject({
      valid: true,
    });
  });
});

describe('generation without a browser global', () => {
  /**
   * The defect this replaces: `generateRecoveryCode` read
   * `globalThis.crypto.getRandomValues` directly, so on Hermes it threw and a
   * user could not be issued recovery codes at all. Node has the global, so the
   * only honest way to assert the fix is to remove it.
   */
  it('generates codes with crypto, btoa, atob, TextEncoder and TextDecoder removed', () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = {
      crypto: globals.crypto,
      btoa: globals.btoa,
      atob: globals.atob,
      TextEncoder: globals.TextEncoder,
      TextDecoder: globals.TextDecoder,
    };
    // Captured before the globals go, exactly as a composition root captures
    // the platform's generator at startup.
    const source = randomBytes;
    try {
      for (const key of Object.keys(saved)) delete globals[key];
      const code = generateRecoveryCode(source);
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const many = generateRecoveryCodes(source, 20);
      expect(many).toHaveLength(20);
      expect(new Set(many).size).toBe(20);
      expect(many.join('')).not.toMatch(/[IO01]/);
      expect(normalizeRecoveryCode(code)).toBe(code);
    } finally {
      Object.assign(globals, saved);
    }
  });

  it('works with a generator that is not backed by any global at all', () => {
    // A deterministic source proves the function never reaches past its
    // argument: if it did, this would not be reproducible.
    let counter = 0;
    const deterministic = (length: number) =>
      Uint8Array.from({ length }, () => (counter += 7) % 256);
    counter = 0;
    const first = generateRecoveryCode(deterministic);
    counter = 0;
    const second = generateRecoveryCode(deterministic);
    expect(second).toBe(first);
    expect(first).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });
});

describe('generation rejects a broken entropy source', () => {
  it('refuses a missing or non-function source', () => {
    // @ts-expect-error deliberately omitting the required argument
    expect(() => generateRecoveryCode()).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
    );
    expect(() => generateRecoveryCode('nope' as never)).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
    );
  });

  it('refuses a stub that returns all zeroes', () => {
    // Without this the stub yields "AAAA-AAAA-AAAA" for every user, which is a
    // valid-looking code and a total loss of entropy.
    expect(() => generateRecoveryCode((length) => new Uint8Array(length))).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
    );
  });

  it('refuses a source that returns the wrong length or the wrong type', () => {
    expect(() => generateRecoveryCode(() => Uint8Array.of(1, 2, 3))).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
    );
    expect(() =>
      generateRecoveryCode(((length: number) => new Array(length).fill(1)) as never),
    ).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
    );
  });

  it('asks for exactly one byte per symbol, in a single draw', () => {
    const lengths: number[] = [];
    generateRecoveryCode((length) => {
      lengths.push(length);
      return randomBytes(length);
    });
    expect(lengths).toEqual([12]);
  });
});

describe('generation stays unbiased', () => {
  /**
   * The format and the entropy are unchanged, and the claim that the draw is
   * uniform is now checked rather than only asserted in a comment: every byte
   * value 0-255 must map onto the alphabet evenly, which is what makes
   * "modulo 32" safe.
   */
  it('maps all 256 byte values evenly onto the 32-symbol alphabet', () => {
    const counts = new Map<string, number>();
    for (let byte = 0; byte < 256; byte += 1) {
      // Only the first byte is under test; the rest are a non-zero filler so
      // that byte 0 does not trip the all-zero stub check, which is a property
      // of the entropy source rather than of the mapping.
      const code = generateRecoveryCode(() =>
        Uint8Array.from({ length: 12 }, (_, i) => (i === 0 ? byte : 0xff)),
      );
      const symbol = code[0] as string;
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    // 256 byte values over 32 symbols: exactly 8 each, no symbol favoured.
    // This is what makes the modulo draw unbiased.
    expect(counts.size).toBe(32);
    expect([...counts.values()].every((n) => n === 8)).toBe(true);
  });

  it('covers the whole alphabet across a large sample', () => {
    const seen = new Set(generateRecoveryCodes(randomBytes, 400).join('').replace(/-/g, ''));
    expect(seen.size).toBe(32);
  });

  it('preserves the documented format and entropy', () => {
    expect(RECOVERY_CODE_ENTROPY_BITS).toBe(60);
    const code = generateRecoveryCode(randomBytes);
    expect(code).toHaveLength(14);
    expect(code.split('-')).toHaveLength(3);
    expect(code.split('-').every((group) => group.length === 4)).toBe(true);
  });
});
