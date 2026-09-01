import { describe, expect, it } from 'vitest';
import {
  buildExportBundle,
  decryptExportBundle,
  encryptExportBundle,
  EXPORT_SCHEMA_VERSION,
  parseExportBundle,
} from '../src/importExport';
import { DataErrorCode } from '../src/errors';
import { WebCryptoService } from '@platform/security';

const crypto = new WebCryptoService(100_000);
const CONTEXT = { userId: 'user-1', appName: 'Net Worth' };

/**
 * Every value here contains a hyphen, deliberately.
 *
 * The leak assertion below is a substring search against a document that is
 * mostly fresh random base64, and base64's alphabet is `A-Za-z0-9+/=`. A needle
 * containing a hyphen therefore cannot appear in it by chance — not merely
 * unlikely, impossible. The id used to be `a1`, and two characters drawn from
 * the base64 alphabet turn up in ~230 characters of ciphertext about 6% of the
 * time, so the test failed roughly one run in sixteen for no reason at all.
 * Keep the hyphens.
 */
const bundle = buildExportBundle(
  'Net Worth',
  {
    assets: [
      {
        id: 'asset-one',
        name: 'Savings-Account',
        amount: 1234.56,
        updatedAt: 1,
        revision: 1,
        deletedAt: null,
      },
    ],
  },
  1_700_000_000_000,
);

describe('export bundles', () => {
  it('encrypts the whole bundle, leaving no plaintext record', async () => {
    const encrypted = await encryptExportBundle(bundle, 'passphrase', crypto, CONTEXT);
    const serialised = JSON.stringify(encrypted);

    // The id and every domain value, not just the id: the claim is that no
    // plaintext record survives, and one token was never enough to show it.
    for (const secret of ['asset-one', 'Savings-Account', '1234.56']) {
      expect(serialised, secret).not.toContain(secret);
    }
    expect(encrypted.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
  });

  it('round-trips', async () => {
    const encrypted = await encryptExportBundle(bundle, 'passphrase', crypto, CONTEXT);
    await expect(decryptExportBundle(encrypted, 'passphrase', crypto, CONTEXT)).resolves.toEqual(bundle);
  });

  it('fails on the wrong passphrase', async () => {
    const encrypted = await encryptExportBundle(bundle, 'passphrase', crypto, CONTEXT);
    await expect(decryptExportBundle(encrypted, 'wrong', crypto, CONTEXT)).rejects.toMatchObject({
      domain: 'security',
    });
  });
});

describe('parseExportBundle', () => {
  it('rejects a newer schema version', () => {
    expect(() => parseExportBundle({ ...bundle, schemaVersion: EXPORT_SCHEMA_VERSION + 1 })).toThrowError(
      expect.objectContaining({ code: DataErrorCode.IMPORT_VERSION_UNSUPPORTED }),
    );
  });

  it('rejects a malformed record', () => {
    expect(() =>
      parseExportBundle({ ...bundle, collections: { assets: [{ id: 'a1' }] } }),
    ).toThrowError(expect.objectContaining({ code: DataErrorCode.RECORD_INVALID }));
  });

  it('rejects a reserved collection name', () => {
    // `__proto__` as a dynamic key would otherwise replace the accumulator's
    // prototype rather than becoming an entry.
    const hostile = JSON.parse('{"__proto__": [], "assets": []}') as Record<string, unknown>;
    expect(() => parseExportBundle({ ...bundle, collections: hostile })).toThrowError(
      expect.objectContaining({ code: DataErrorCode.IMPORT_INVALID }),
    );
  });

  it('builds collections on a null prototype', () => {
    const parsed = parseExportBundle(JSON.parse(JSON.stringify(bundle)));
    expect(Object.getPrototypeOf(parsed.collections)).toBeNull();
  });

  it('rejects a non-object payload', () => {
    expect(() => parseExportBundle('nope')).toThrowError(
      expect.objectContaining({ code: DataErrorCode.IMPORT_INVALID }),
    );
  });

  it('accepts a well-formed bundle', () => {
    expect(parseExportBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });
});
