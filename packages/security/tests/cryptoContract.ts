import { describe, expect, it } from 'vitest';
import { SecurityErrorCode } from '../src/errors';
import type { CryptoService, EncryptionContext } from '../src/types/crypto';

/**
 * One battery, run against every `CryptoService` implementation.
 *
 * `WebCryptoService` and `PortableCryptoService` deliberately do not share a
 * base class: WebCrypto can hold a derived key as a non-extractable
 * `CryptoKey`, and a common base would have had to give that up to accommodate
 * the pure-JavaScript one. This suite is what stops the two from drifting
 * instead.
 */
export const CONTEXT: EncryptionContext = { userId: 'user-1', appName: 'Net Worth' };
export const OTHER_USER: EncryptionContext = { userId: 'user-2', appName: 'Net Worth' };
export const OTHER_APP: EncryptionContext = { userId: 'user-1', appName: 'Expense' };

export function describeCryptoContract(name: string, create: () => CryptoService): void {
  describe(`${name} — CryptoService contract`, () => {
    const crypto = create();

    describe('AES-GCM round trip', () => {
      it('round-trips a payload', async () => {
        const payload = await crypto.encrypt('net worth: 1234', 'correct horse battery', CONTEXT);
        await expect(crypto.decrypt(payload, 'correct horse battery', CONTEXT)).resolves.toBe(
          'net worth: 1234',
        );
      });

      it('round-trips an empty string and a large payload', async () => {
        const empty = await crypto.encrypt('', 'passphrase', CONTEXT);
        await expect(crypto.decrypt(empty, 'passphrase', CONTEXT)).resolves.toBe('');

        const large = 'x'.repeat(200_000);
        const payload = await crypto.encrypt(large, 'passphrase', CONTEXT);
        await expect(crypto.decrypt(payload, 'passphrase', CONTEXT)).resolves.toBe(large);
      });

      it('round-trips non-ASCII plaintext and a non-ASCII passphrase', async () => {
        const text = 'net worth: ₹1,23,456 — café 日本 \u{1f510}';
        const passphrase = 'passe-partout ключ \u{1f511}';
        const payload = await crypto.encrypt(text, passphrase, CONTEXT);
        await expect(crypto.decrypt(payload, passphrase, CONTEXT)).resolves.toBe(text);
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
    });

    describe('rejection', () => {
      it('rejects the wrong key', async () => {
        const payload = await crypto.encrypt('secret', 'right', CONTEXT);
        await expect(crypto.decrypt(payload, 'wrong', CONTEXT)).rejects.toMatchObject({
          code: SecurityErrorCode.DECRYPTION_FAILED,
          domain: 'security',
        });
      });

      it('rejects a tampered ciphertext', async () => {
        const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
        const bytes = [...payload.ciphertext];
        // Flip a character that is definitely inside the body, not the padding.
        bytes[2] = bytes[2] === 'A' ? 'B' : 'A';
        await expect(
          crypto.decrypt({ ...payload, ciphertext: bytes.join('') }, 'passphrase', CONTEXT),
        ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
      });

      it('rejects a tampered nonce and a tampered salt', async () => {
        const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
        const swap = (value: string) => {
          const chars = [...value];
          chars[0] = chars[0] === 'A' ? 'B' : 'A';
          return chars.join('');
        };
        await expect(
          crypto.decrypt({ ...payload, iv: swap(payload.iv) }, 'passphrase', CONTEXT),
        ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
        await expect(
          crypto.decrypt({ ...payload, salt: swap(payload.salt) }, 'passphrase', CONTEXT),
        ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
      });

      // The AAD is what stops a backup being replayed into another account or
      // another application. Both halves are asserted, not just one.
      it('rejects the wrong AAD — a different user', async () => {
        const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
        await expect(crypto.decrypt(payload, 'passphrase', OTHER_USER)).rejects.toMatchObject({
          code: SecurityErrorCode.DECRYPTION_FAILED,
        });
      });

      it('rejects the wrong AAD — a different application', async () => {
        const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
        await expect(crypto.decrypt(payload, 'passphrase', OTHER_APP)).rejects.toMatchObject({
          code: SecurityErrorCode.DECRYPTION_FAILED,
        });
      });

      // The iteration count is inside the AAD, so editing it down to make the
      // derivation cheap breaks the tag rather than the cost.
      it('rejects an edited iteration count that is still within policy', async () => {
        const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
        await expect(
          crypto.decrypt({ ...payload, iterations: 100_001 }, 'passphrase', CONTEXT),
        ).rejects.toMatchObject({ code: SecurityErrorCode.DECRYPTION_FAILED });
      });
    });

    describe('envelope validation', () => {
      it('rejects an unsupported version', async () => {
        const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
        await expect(
          crypto.decrypt({ ...payload, version: 2 as 1 }, 'passphrase', CONTEXT),
        ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED });
      });

      it('rejects an unsupported algorithm', async () => {
        const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
        await expect(
          crypto.decrypt(
            { ...payload, algorithm: 'AES-CBC' as 'AES-GCM' },
            'passphrase',
            CONTEXT,
          ),
        ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_ALGORITHM_UNSUPPORTED });
      });

      it('rejects an iteration count outside the policy, in both directions', async () => {
        const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
        for (const iterations of [1, 99_999, 1_000_001, 2_000_000_000, 1.5, Number.NaN]) {
          await expect(
            crypto.decrypt({ ...payload, iterations }, 'passphrase', CONTEXT),
            String(iterations),
          ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID });
        }
      });

      it('rejects a malformed base64 field before deriving a key', async () => {
        const payload = await crypto.encrypt('secret', 'passphrase', CONTEXT);
        await expect(
          crypto.decrypt({ ...payload, salt: 'not valid base64!' }, 'passphrase', CONTEXT),
        ).rejects.toMatchObject({ domain: 'security' });
      });
    });

    describe('PBKDF2 secret hashing', () => {
      it('produces a fresh salt for the same secret', async () => {
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

      it('rejects a stored hash with a cost outside the policy', async () => {
        const stored = await crypto.hashSecret('the-secret');
        for (const iterations of [1, 99_999, 1_000_001]) {
          await expect(
            crypto.verifySecret('the-secret', { ...stored, iterations }),
            String(iterations),
          ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID });
        }
      });

      it('rejects a stored hash with an unsupported version or algorithm', async () => {
        const stored = await crypto.hashSecret('the-secret');
        await expect(
          crypto.verifySecret('the-secret', { ...stored, version: 2 as 1 }),
        ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED });
        await expect(
          crypto.verifySecret('the-secret', {
            ...stored,
            algorithm: 'SHA-256' as 'PBKDF2-SHA256',
          }),
        ).rejects.toMatchObject({ code: SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED });
      });

      it('never contains the plaintext', async () => {
        const stored = await crypto.hashSecret('the-secret');
        expect(JSON.stringify(stored)).not.toContain('the-secret');
      });
    });

    describe('integrity hash', () => {
      it('is stable and distinguishes inputs', async () => {
        expect(await crypto.hash('value')).toBe(await crypto.hash('value'));
        expect(await crypto.hash('value')).not.toBe(await crypto.hash('value '));
      });

      it('is a 32-byte digest', async () => {
        // 32 bytes -> 44 base64 characters with one pad.
        expect(await crypto.hash('value')).toHaveLength(44);
      });
    });
  });
}
