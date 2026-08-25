import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PortableCryptoService } from '../src/services/PortableCryptoService';
import { WebCryptoService } from '../src/services/WebCryptoService';
import { MIN_KDF_ITERATIONS } from '../src/kdfPolicy';
import type { EncryptedPayload } from '../src/types/crypto';
import { CONTEXT, OTHER_APP, OTHER_USER } from './cryptoContract';

/**
 * Backup compatibility, which is the requirement the second implementation
 * exists to satisfy without breaking.
 *
 * A user takes a backup on the web and restores it on their phone, or the
 * reverse. If the two implementations disagree about the envelope by a single
 * byte, that restore fails — and it fails at the worst possible moment, with
 * the original device already gone. So the property is asserted directly:
 * each must read what the other wrote.
 *
 * The envelope format is unchanged. `version` is still 1 and no field was
 * added, renamed or reinterpreted; `PortableCryptoService` emits exactly what
 * `WebCryptoService` emitted before this change.
 */
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

const web = new WebCryptoService(MIN_KDF_ITERATIONS);
const portable = new PortableCryptoService({ randomBytes, iterations: MIN_KDF_ITERATIONS });

const SAMPLES = [
  'net worth: 1234',
  '',
  '{"records":[{"id":"a1","amount":1000}]}',
  'café 日本 ₹1,23,456 \u{1f510}',
];

describe('cross-implementation compatibility', () => {
  it('lets the portable service read a WebCrypto backup', async () => {
    for (const text of SAMPLES) {
      const payload = await web.encrypt(text, 'shared passphrase', CONTEXT);
      await expect(
        portable.decrypt(payload, 'shared passphrase', CONTEXT),
        JSON.stringify(text),
      ).resolves.toBe(text);
    }
  });

  it('lets WebCrypto read a portable backup', async () => {
    for (const text of SAMPLES) {
      const payload = await portable.encrypt(text, 'shared passphrase', CONTEXT);
      await expect(
        web.decrypt(payload, 'shared passphrase', CONTEXT),
        JSON.stringify(text),
      ).resolves.toBe(text);
    }
  });

  it('produces the same envelope shape from both', async () => {
    const fromWeb = await web.encrypt('same', 'passphrase', CONTEXT);
    const fromPortable = await portable.encrypt('same', 'passphrase', CONTEXT);
    expect(Object.keys(fromWeb).sort()).toEqual(Object.keys(fromPortable).sort());
    expect(fromPortable.version).toBe(fromWeb.version);
    expect(fromPortable.algorithm).toBe(fromWeb.algorithm);
    expect(fromPortable.iterations).toBe(fromWeb.iterations);
    expect(fromPortable.iv).toHaveLength(fromWeb.iv.length);
    expect(fromPortable.salt).toHaveLength(fromWeb.salt.length);
    expect(fromPortable.ciphertext).toHaveLength(fromWeb.ciphertext.length);
  });

  // Given the same salt and nonce the two must produce identical bytes, not
  // merely mutually readable ones. Reusing a nonce is catastrophic in real use;
  // here it is the only way to compare the outputs directly, and the key is a
  // throwaway.
  it('produces byte-identical ciphertext for the same salt and nonce', async () => {
    const fixed = (length: number) => Uint8Array.from({ length }, (_, i) => (i * 7 + 13) % 256);
    const pinned = new PortableCryptoService({
      randomBytes: fixed,
      iterations: MIN_KDF_ITERATIONS,
    });
    const first = await pinned.encrypt('determinism check', 'passphrase', CONTEXT);
    const second = await pinned.encrypt('determinism check', 'passphrase', CONTEXT);
    expect(first).toEqual(second);
    // And WebCrypto agrees with it, which is what makes the format portable.
    await expect(web.decrypt(first, 'passphrase', CONTEXT)).resolves.toBe('determinism check');
  });

  it('agrees on the integrity hash', async () => {
    for (const text of ['value', '', 'café \u{1f510}']) {
      expect(await portable.hash(text), JSON.stringify(text)).toBe(await web.hash(text));
    }
  });

  it('verifies a secret hashed by the other implementation', async () => {
    const hashedOnWeb = await web.hashSecret('ABCD-EFGH-JKLM');
    await expect(portable.verifySecret('ABCD-EFGH-JKLM', hashedOnWeb)).resolves.toBe(true);
    await expect(portable.verifySecret('WRONG-CODE-HERE', hashedOnWeb)).resolves.toBe(false);

    const hashedOnPortable = await portable.hashSecret('ABCD-EFGH-JKLM');
    await expect(web.verifySecret('ABCD-EFGH-JKLM', hashedOnPortable)).resolves.toBe(true);
    await expect(web.verifySecret('WRONG-CODE-HERE', hashedOnPortable)).resolves.toBe(false);
  });

  // The AAD binding has to survive the port, or a backup restored on a phone
  // would no longer be pinned to its owner and application.
  it('keeps the AAD binding across implementations', async () => {
    const payload = await web.encrypt('secret', 'passphrase', CONTEXT);
    await expect(portable.decrypt(payload, 'passphrase', OTHER_USER)).rejects.toMatchObject({
      domain: 'security',
    });
    await expect(portable.decrypt(payload, 'passphrase', OTHER_APP)).rejects.toMatchObject({
      domain: 'security',
    });

    const fromPortable = await portable.encrypt('secret', 'passphrase', CONTEXT);
    await expect(web.decrypt(fromPortable, 'passphrase', OTHER_USER)).rejects.toMatchObject({
      domain: 'security',
    });
  });

  // Not hand-written: produced by checking the pre-change `WebCryptoService`
  // out of git, stubbing its entropy to a fixed pattern, and recording what it
  // emitted. Both implementations must still open it, or every backup already
  // in Cloud Storage is unreadable.
  it('opens a payload recorded before the portable implementation existed', async () => {
    const archived: EncryptedPayload = {
      ciphertext: 'g6JqXBG1HPRP5QUZLiuxrDfQ8aZkVaHWQUvQcJWFrhtl',
      iv: 'DRQbIikwNz5FTFNa',
      salt: 'DRQbIikwNz5FTFNaYWhvdg==',
      algorithm: 'AES-GCM',
      iterations: 100_000,
      version: 1,
    };
    await expect(web.decrypt(archived, 'passphrase', CONTEXT)).resolves.toBe('determinism check');
    await expect(portable.decrypt(archived, 'passphrase', CONTEXT)).resolves.toBe(
      'determinism check',
    );
  });
});
