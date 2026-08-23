import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PortableCryptoService } from '../src/services/PortableCryptoService';
import { WebCryptoService } from '../src/services/WebCryptoService';
import { SecurityErrorCode } from '../src/errors';
import {
  DEFAULT_KDF_ITERATIONS,
  MAX_KDF_ITERATIONS,
  MIN_KDF_ITERATIONS,
  assertAllowedIterationCount,
  isAllowedIterationCount,
} from '../src/kdfPolicy';
import type { CryptoService } from '../src/types/crypto';
import { CONTEXT } from './cryptoContract';

/**
 * X-3. The defect was two authorities disagreeing: a constructor that accepted
 * any count from 1 upwards, and a read path that refused anything below
 * 100,000. A service configured in between encrypted happily and then refused
 * its own output — and it surfaced on the restore, as a backup that would not
 * open, rather than at the point the mistake was made.
 *
 * There is now one policy, applied at both ends.
 */
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

const IMPLEMENTATIONS: Array<[string, (iterations: number) => CryptoService]> = [
  ['WebCryptoService', (iterations) => new WebCryptoService(iterations)],
  ['PortableCryptoService', (iterations) => new PortableCryptoService({ randomBytes, iterations })],
];

describe('kdfPolicy', () => {
  it('states one minimum, one maximum and one default', () => {
    expect(MIN_KDF_ITERATIONS).toBe(100_000);
    expect(MAX_KDF_ITERATIONS).toBe(1_000_000);
    expect(DEFAULT_KDF_ITERATIONS).toBe(210_000);
    expect(DEFAULT_KDF_ITERATIONS).toBeGreaterThanOrEqual(MIN_KDF_ITERATIONS);
    expect(DEFAULT_KDF_ITERATIONS).toBeLessThanOrEqual(MAX_KDF_ITERATIONS);
  });

  it('accepts the boundaries and rejects just outside them', () => {
    expect(isAllowedIterationCount(MIN_KDF_ITERATIONS)).toBe(true);
    expect(isAllowedIterationCount(MAX_KDF_ITERATIONS)).toBe(true);
    expect(isAllowedIterationCount(MIN_KDF_ITERATIONS - 1)).toBe(false);
    expect(isAllowedIterationCount(MAX_KDF_ITERATIONS + 1)).toBe(false);
  });

  it('rejects anything that is not a whole number', () => {
    for (const value of [1.5, Number.NaN, Number.POSITIVE_INFINITY, '210000', null, undefined, {}]) {
      expect(isAllowedIterationCount(value), String(value)).toBe(false);
      expect(() => assertAllowedIterationCount(value), String(value)).toThrowError(
        expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
      );
    }
  });
});

describe.each(IMPLEMENTATIONS)('%s — iteration policy', (_name, create) => {
  it('rejects a below-minimum configuration', () => {
    for (const iterations of [1, 2, 1_000, 99_999]) {
      expect(() => create(iterations), String(iterations)).toThrowError(
        expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
      );
    }
  });

  // The ceiling is the same defect mirrored: the read path refuses a count
  // above it, so the write path must not accept one either.
  it('rejects an above-maximum configuration', () => {
    for (const iterations of [MAX_KDF_ITERATIONS + 1, 2_000_000_000]) {
      expect(() => create(iterations), String(iterations)).toThrowError(
        expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
      );
    }
  });

  it('accepts the minimum configuration and round-trips with it', async () => {
    const crypto = create(MIN_KDF_ITERATIONS);
    const payload = await crypto.encrypt('at the floor', 'passphrase', CONTEXT);
    expect(payload.iterations).toBe(MIN_KDF_ITERATIONS);
    await expect(crypto.decrypt(payload, 'passphrase', CONTEXT)).resolves.toBe('at the floor');
  });

  it('accepts the maximum configuration and round-trips with it', async () => {
    const crypto = create(MAX_KDF_ITERATIONS);
    const payload = await crypto.encrypt('at the ceiling', 'passphrase', CONTEXT);
    expect(payload.iterations).toBe(MAX_KDF_ITERATIONS);
    await expect(crypto.decrypt(payload, 'passphrase', CONTEXT)).resolves.toBe('at the ceiling');
    // A million PBKDF2 rounds, four times over, in pure JavaScript on the
    // portable path. The explicit budget is why it is stated per test rather
    // than raised globally, which would hide a genuine hang somewhere else.
  }, 120_000);

  /**
   * The invariant itself, rather than a sample of it: across the whole range a
   * caller might plausibly configure, either the constructor refuses — or
   * everything the service produces, it can read back. There is no third
   * outcome, and specifically no configuration that succeeds at write time and
   * fails at read time on the iteration policy alone.
   */
  it('never produces data it would itself refuse', async () => {
    const candidates = [
      1,
      99_999,
      MIN_KDF_ITERATIONS,
      MIN_KDF_ITERATIONS + 1,
      DEFAULT_KDF_ITERATIONS,
      MAX_KDF_ITERATIONS - 1,
      MAX_KDF_ITERATIONS,
      MAX_KDF_ITERATIONS + 1,
      2_000_000_000,
    ];

    for (const iterations of candidates) {
      let crypto: CryptoService;
      try {
        crypto = create(iterations);
      } catch (error) {
        // Refused at configuration time. That is the whole point.
        expect(error, String(iterations)).toMatchObject({
          code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID,
        });
        expect(isAllowedIterationCount(iterations), String(iterations)).toBe(false);
        continue;
      }

      expect(isAllowedIterationCount(iterations), String(iterations)).toBe(true);

      // Encryption and decryption.
      const payload = await crypto.encrypt('round trip', 'passphrase', CONTEXT);
      await expect(crypto.decrypt(payload, 'passphrase', CONTEXT), String(iterations)).resolves.toBe(
        'round trip',
      );

      // Recovery-code hashing and verification — the same policy governs both,
      // and it was possible before to hash a code that could never be verified.
      const stored = await crypto.hashSecret('ABCD-EFGH-JKLM');
      await expect(
        crypto.verifySecret('ABCD-EFGH-JKLM', stored),
        String(iterations),
      ).resolves.toBe(true);
      await expect(crypto.verifySecret('wrong', stored), String(iterations)).resolves.toBe(false);
    }
  }, 300_000);
});
