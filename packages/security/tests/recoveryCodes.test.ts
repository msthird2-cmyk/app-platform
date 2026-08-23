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

const crypto = new WebCryptoService(100_000);
const NOW = 1_700_000_000_000;

describe('generation', () => {
  it('generates codes in the documented shape', () => {
    expect(generateRecoveryCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('omits ambiguous characters', () => {
    expect(generateRecoveryCodes(40).join('')).not.toMatch(/[IO01]/);
  });

  it('carries 60 bits of entropy over an unbiased alphabet', () => {
    // 32 symbols divides 256 exactly, so the byte-modulo draw is uniform.
    expect(RECOVERY_CODE_ENTROPY_BITS).toBe(60);
  });

  it('does not repeat across a large sample', () => {
    const codes = generateRecoveryCodes(500);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('normalizes user typing and rejects a wrong length', () => {
    expect(normalizeRecoveryCode('k7qm 2xpd9rtf')).toBe('K7QM-2XPD-9RTF');
    expect(() => normalizeRecoveryCode('K7QM-2XPD')).toThrow();
  });
});

describe('storage', () => {
  it('never persists the plaintext, and salts every code', async () => {
    const codes = generateRecoveryCodes(3);
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
    const codes = generateRecoveryCodes(3);
    const records = await hashRecoveryCodes(codes, crypto, { now: NOW });

    const first = await verifyRecoveryCode(codes[1]!, records, crypto, NOW);
    expect(first.valid).toBe(true);
    expect(remainingRecoveryCodes(first.records, NOW)).toBe(2);
  });

  it('refuses the same code a second time', async () => {
    const codes = generateRecoveryCodes(2);
    const records = await hashRecoveryCodes(codes, crypto, { now: NOW });

    const first = await verifyRecoveryCode(codes[0]!, records, crypto, NOW);
    const replay = await verifyRecoveryCode(codes[0]!, first.records, crypto, NOW);
    expect(replay.valid).toBe(false);
    expect(replay.reason).toBe('ALREADY_USED');
  });

  it('refuses an expired code', async () => {
    const codes = generateRecoveryCodes(1);
    const records = await hashRecoveryCodes(codes, crypto, { now: NOW, lifetimeMs: 1000 });
    const result = await verifyRecoveryCode(codes[0]!, records, crypto, NOW + 1001);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('EXPIRED');
    expect(remainingRecoveryCodes(records, NOW + 1001)).toBe(0);
  });

  it('rejects an unknown code without throwing', async () => {
    const records = await hashRecoveryCodes(generateRecoveryCodes(2), crypto, { now: NOW });
    await expect(verifyRecoveryCode('ZZZZ-ZZZZ-ZZZZ', records, crypto, NOW)).resolves.toMatchObject({
      valid: false,
      reason: 'INVALID',
    });
  });

  it('rejects malformed input without throwing', async () => {
    const records = await hashRecoveryCodes(generateRecoveryCodes(2), crypto, { now: NOW });
    await expect(verifyRecoveryCode('nonsense', records, crypto, NOW)).resolves.toMatchObject({
      valid: false,
      reason: 'INVALID',
    });
  });

  it('leaves the other codes usable', async () => {
    const codes = generateRecoveryCodes(3);
    const records = await hashRecoveryCodes(codes, crypto, { now: NOW });
    const used = await verifyRecoveryCode(codes[0]!, records, crypto, NOW);
    await expect(verifyRecoveryCode(codes[2]!, used.records, crypto, NOW)).resolves.toMatchObject({
      valid: true,
    });
  });
});
