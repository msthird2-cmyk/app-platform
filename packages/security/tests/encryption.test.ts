import { describe, expect, it } from 'vitest';
import { WebCryptoService } from '../src/services/WebCryptoService';
import { SecurityErrorCode } from '../src/errors';

// A low iteration count keeps the suite fast; production uses the default.
const crypto = new WebCryptoService(1000);

describe('WebCryptoService', () => {
  it('round-trips a payload', async () => {
    const payload = await crypto.encrypt('net worth: 1234', 'correct horse battery');
    await expect(crypto.decrypt(payload, 'correct horse battery')).resolves.toBe('net worth: 1234');
  });

  it('never stores the plaintext in the payload', async () => {
    const payload = await crypto.encrypt('secret-value', 'passphrase');
    expect(JSON.stringify(payload)).not.toContain('secret-value');
  });

  it('produces a different ciphertext each time', async () => {
    const first = await crypto.encrypt('same', 'passphrase');
    const second = await crypto.encrypt('same', 'passphrase');
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(first.salt).not.toBe(second.salt);
  });

  it('fails with a typed code on the wrong passphrase', async () => {
    const payload = await crypto.encrypt('secret', 'right');
    await expect(crypto.decrypt(payload, 'wrong')).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
      domain: 'security',
    });
  });

  it('rejects a tampered ciphertext', async () => {
    const payload = await crypto.encrypt('secret', 'passphrase');
    const tampered = { ...payload, ciphertext: `${payload.ciphertext.slice(0, -4)}AAAA` };
    await expect(crypto.decrypt(tampered, 'passphrase')).rejects.toMatchObject({
      code: SecurityErrorCode.DECRYPTION_FAILED,
    });
  });

  it('hashes deterministically', async () => {
    expect(await crypto.hash('value')).toBe(await crypto.hash('value'));
    expect(await crypto.hash('value')).not.toBe(await crypto.hash('other'));
  });
});
