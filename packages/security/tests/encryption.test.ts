import { describe, expect, it } from 'vitest';
import { WebCryptoService } from '../src/services/WebCryptoService';
import { SecurityErrorCode } from '../src/errors';
import { MIN_KDF_ITERATIONS } from '../src/kdfPolicy';
import { describeCryptoContract, CONTEXT } from './cryptoContract';

/**
 * Every case that used to live here in longhand is now in
 * `cryptoContract.ts`, so it runs against `PortableCryptoService` too — the two
 * implementations have to behave identically or a backup taken on one device
 * cannot be restored on another. What stays here is specific to this one.
 *
 * The minimum cost keeps the suite fast; production uses the default.
 */
describeCryptoContract('WebCryptoService', () => new WebCryptoService(MIN_KDF_ITERATIONS));

describe('WebCryptoService — configuration', () => {
  it('defaults to the policy default rather than a locally chosen number', async () => {
    const payload = await new WebCryptoService().encrypt('secret', 'passphrase', CONTEXT);
    expect(payload.iterations).toBe(210_000);
  });

  it('carries the configured cost into the payload and the stored hash', async () => {
    const crypto = new WebCryptoService(123_456);
    expect((await crypto.encrypt('secret', 'passphrase', CONTEXT)).iterations).toBe(123_456);
    expect((await crypto.hashSecret('secret')).iterations).toBe(123_456);
  });

  it('rejects a cost the read path would refuse', () => {
    for (const iterations of [0, 1, 99_999, 1_000_001, 1.5, Number.NaN]) {
      expect(() => new WebCryptoService(iterations), String(iterations)).toThrowError(
        expect.objectContaining({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID }),
      );
    }
  });
});
