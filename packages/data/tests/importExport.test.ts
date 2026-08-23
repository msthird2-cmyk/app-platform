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

const crypto = new WebCryptoService(1000);

const bundle = buildExportBundle(
  'Net Worth',
  { assets: [{ id: 'a1', updatedAt: 1, revision: 1, deletedAt: null }] },
  1_700_000_000_000,
);

describe('export bundles', () => {
  it('encrypts the whole bundle, leaving no plaintext record', async () => {
    const encrypted = await encryptExportBundle(bundle, 'passphrase', crypto);
    expect(JSON.stringify(encrypted)).not.toContain('a1');
    expect(encrypted.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
  });

  it('round-trips', async () => {
    const encrypted = await encryptExportBundle(bundle, 'passphrase', crypto);
    await expect(decryptExportBundle(encrypted, 'passphrase', crypto)).resolves.toEqual(bundle);
  });

  it('fails on the wrong passphrase', async () => {
    const encrypted = await encryptExportBundle(bundle, 'passphrase', crypto);
    await expect(decryptExportBundle(encrypted, 'wrong', crypto)).rejects.toMatchObject({
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

  it('rejects a non-object payload', () => {
    expect(() => parseExportBundle('nope')).toThrowError(
      expect.objectContaining({ code: DataErrorCode.IMPORT_INVALID }),
    );
  });

  it('accepts a well-formed bundle', () => {
    expect(parseExportBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });
});
