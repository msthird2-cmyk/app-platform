import { describe, expect, it } from 'vitest';
import { WebCryptoService } from '../src/services/WebCryptoService';
import { SecurityErrorCode } from '../src/errors';
import type { EncryptionContext } from '../src/types/crypto';

// A low iteration count keeps the suite fast; production uses the default.
const crypto = new WebCryptoService(100_000);
const CONTEXT: EncryptionContext = { userId: 'user-1', appName: 'Net Worth' };

describe('WebCryptoService', () => {
  it('round-trips a payload', async () => {
    const payload = await crypto.encrypt('net worth: 1234', 'correct horse battery', CONTEXT);
    await expect(crypto.decrypt(payload, 'correct horse battery', CONTEXT)).resolves.toBe(
      'net worth: 1234',
    );
  });

  it('never stores the plaintext in the payload', async () => {
    const payload = await crypto.encrypt('secret-value', 'passphrase', CONTEXT);
    expect(JSON.stringify(payload)).not.toContain('secret-value');
  });

  it('uses a fresh salt and nonce for every encryption', async () => {
    const first = await crypto.encrypt('same', 'passphrase', CONTEXT);
    const second = await crypto.encrypt('same', 'passphrase', CONTEXT);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(first.salt).not.toBe(second.salt);
  });

  it('fails with a typed code on the wrong passphrase', async () => {
    const payload = await crypto.encrypt('secret', 'right', CONTEXT);
    await expect(crypto.decrypt(payload, 'wrong', CONTEXT)).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
      domain: 'security',
    });
  });

  it('rejects a tampered ciphertext', async () => {
    const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
    const tampered = { ...payload, ciphertext: `${payload.ciphertext.slice(0, -4)}AAAA` };
    await expect(crypto.decrypt(tampered, 'passphrase', CONTEXT)).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
  });

  it('refuses a payload encrypted for a different user', async () => {
    const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
    await expect(
      crypto.decrypt(payload, 'passphrase', { ...CONTEXT, userId: 'someone-else' }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
  });

  it('refuses a payload encrypted for a different application', async () => {
    const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
    await expect(
      crypto.decrypt(payload, 'passphrase', { ...CONTEXT, appName: 'Expense' }),
    ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
  });

  it('rejects an unknown payload version', async () => {
    const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
    await expect(
      crypto.decrypt({ ...payload, version: 2 as 1 }, 'passphrase', CONTEXT),
    ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED });
  });

  it('rejects an unknown algorithm', async () => {
    const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
    await expect(
      crypto.decrypt({ ...payload, algorithm: 'AES-CBC' as 'AES-GCM' }, 'passphrase', CONTEXT),
    ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_ALGORITHM_UNSUPPORTED });
  });

  it('refuses an iteration count outside the accepted band', async () => {
    const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
    // A hostile bundle claiming a huge cost would otherwise freeze the device.
    await expect(
      crypto.decrypt({ ...payload, iterations: 2_000_000_000 }, 'passphrase', CONTEXT),
    ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID });
    await expect(
      crypto.decrypt({ ...payload, iterations: 1 }, 'passphrase', CONTEXT),
    ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID });
  });

  it('hashes deterministically for integrity use', async () => {
    expect(await crypto.hash('value')).toBe(await crypto.hash('value'));
    expect(await crypto.hash('value')).not.toBe(await crypto.hash('other'));
  });
});

describe('hashSecret', () => {
  it('salts every hash, so two identical secrets store differently', async () => {
    const first = await crypto.hashSecret('same-secret');
    const second = await crypto.hashSecret('same-secret');
    expect(first.salt).not.toBe(second.salt);
    expect(first.digest).not.toBe(second.digest);
  });

  it('is not a bare digest of the secret', async () => {
    const stored = await crypto.hashSecret('the-secret');
    expect(stored.digest).not.toBe(await crypto.hash('the-secret'));
    expect(stored.algorithm).toBe('PBKDF2-SHA256');
    expect(stored.iterations).toBeGreaterThanOrEqual(100_000);
  });

  it('verifies the right secret and rejects the wrong one', async () => {
    const stored = await crypto.hashSecret('the-secret');
    await expect(crypto.verifySecret('the-secret', stored)).resolves.toBe(true);
    await expect(crypto.verifySecret('other-secret', stored)).resolves.toBe(false);
  });

  it('refuses a stored hash with an implausible cost', async () => {
    const stored = await crypto.hashSecret('the-secret');
    await expect(crypto.verifySecret('the-secret', { ...stored, iterations: 1 })).rejects.toMatchObject(
      { code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID },
    );
  });

  it('never contains the plaintext', async () => {
    const stored = await crypto.hashSecret('the-secret');
    expect(JSON.stringify(stored)).not.toContain('the-secret');
  });
});
