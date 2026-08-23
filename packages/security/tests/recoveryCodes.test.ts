import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCodes,
  normalizeRecoveryCode,
  verifyRecoveryCode,
} from '../src/recoveryCodes';
import { WebCryptoService } from '../src/services/WebCryptoService';

const crypto = new WebCryptoService(1000);

describe('recovery codes', () => {
  it('generates codes in the documented shape', () => {
    expect(generateRecoveryCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('omits ambiguous characters', () => {
    const codes = generateRecoveryCodes(40).join('');
    expect(codes).not.toMatch(/[IO01]/);
  });

  it('normalizes user typing', () => {
    expect(normalizeRecoveryCode('k7qm 2xpd9rtf')).toBe('K7QM-2XPD-9RTF');
  });

  it('rejects a code of the wrong length', () => {
    expect(() => normalizeRecoveryCode('K7QM-2XPD')).toThrow();
  });

  it('accepts a valid code once and consumes it', async () => {
    const codes = generateRecoveryCodes(3);
    const hashes = await hashRecoveryCodes(codes, crypto);

    const first = await verifyRecoveryCode(codes[1]!, hashes, crypto);
    expect(first.valid).toBe(true);
    expect(first.remaining).toHaveLength(2);

    const reuse = await verifyRecoveryCode(codes[1]!, first.remaining, crypto);
    expect(reuse.valid).toBe(false);
  });

  it('rejects an unknown code without throwing', async () => {
    const hashes = await hashRecoveryCodes(generateRecoveryCodes(2), crypto);
    await expect(verifyRecoveryCode('ZZZZ-ZZZZ-ZZZZ', hashes, crypto)).resolves.toMatchObject({
      valid: false,
    });
  });

  it('rejects malformed input without throwing', async () => {
    const hashes = await hashRecoveryCodes(generateRecoveryCodes(2), crypto);
    await expect(verifyRecoveryCode('nonsense', hashes, crypto)).resolves.toMatchObject({ valid: false });
  });

  it('never stores a code in plaintext', async () => {
    const codes = generateRecoveryCodes(2);
    const hashes = await hashRecoveryCodes(codes, crypto);
    for (const code of codes) expect(hashes.join()).not.toContain(code);
  });
});
