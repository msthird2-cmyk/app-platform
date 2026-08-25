import { createLogger } from '@platform/utils';
import type { CryptoService, EncryptedPayload, EncryptionContext } from '@platform/security';
import { DataError, DataErrorCode } from './errors';
import { assertSyncableRecord } from './validation';
import type { SyncableRecord } from './types/record';

const log = createLogger({ scope: 'data:export' });

export const EXPORT_SCHEMA_VERSION = 1;

const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export interface ExportBundle {
  schemaVersion: number;
  appName: string;
  exportedAt: number;
  collections: Record<string, SyncableRecord[]>;
}

export interface EncryptedExportBundle {
  schemaVersion: number;
  appName: string;
  exportedAt: number;
  payload: EncryptedPayload;
}

export function buildExportBundle(
  appName: string,
  collections: Record<string, SyncableRecord[]>,
  now: number,
): ExportBundle {
  return { schemaVersion: EXPORT_SCHEMA_VERSION, appName, exportedAt: now, collections };
}

/** Exports leave the device encrypted; the plaintext never touches storage or logs. */
export async function encryptExportBundle(
  bundle: ExportBundle,
  passphrase: string,
  crypto: CryptoService,
  context: EncryptionContext,
): Promise<EncryptedExportBundle> {
  try {
    const payload = await crypto.encrypt(JSON.stringify(bundle), passphrase, context);
    log.info('export encrypted', {
      appName: bundle.appName,
      collections: Object.keys(bundle.collections).length,
    });
    return {
      schemaVersion: bundle.schemaVersion,
      appName: bundle.appName,
      exportedAt: bundle.exportedAt,
      payload,
    };
  } catch (cause) {
    throw new DataError(DataErrorCode.EXPORT_FAILED, cause);
  }
}

export function parseExportBundle(raw: unknown): ExportBundle {
  if (typeof raw !== 'object' || raw === null) throw new DataError(DataErrorCode.IMPORT_INVALID);
  const bundle = raw as Partial<ExportBundle>;
  if (typeof bundle.schemaVersion !== 'number') throw new DataError(DataErrorCode.IMPORT_INVALID);
  if (bundle.schemaVersion > EXPORT_SCHEMA_VERSION) {
    throw new DataError(DataErrorCode.IMPORT_VERSION_UNSUPPORTED);
  }
  if (typeof bundle.appName !== 'string' || typeof bundle.exportedAt !== 'number') {
    throw new DataError(DataErrorCode.IMPORT_INVALID);
  }
  if (typeof bundle.collections !== 'object' || bundle.collections === null) {
    throw new DataError(DataErrorCode.IMPORT_INVALID);
  }

  // A null-prototype accumulator: a `__proto__` collection name would
  // otherwise replace this object's prototype instead of becoming a key.
  const collections: Record<string, SyncableRecord[]> = Object.create(null);
  for (const [name, records] of Object.entries(bundle.collections)) {
    if (RESERVED_KEYS.has(name)) throw new DataError(DataErrorCode.IMPORT_INVALID);
    if (!Array.isArray(records)) throw new DataError(DataErrorCode.IMPORT_INVALID);
    collections[name] = records.map((record) => assertSyncableRecord(record));
  }

  return {
    schemaVersion: bundle.schemaVersion,
    appName: bundle.appName,
    exportedAt: bundle.exportedAt,
    collections,
  };
}

export async function decryptExportBundle(
  encrypted: EncryptedExportBundle,
  passphrase: string,
  crypto: CryptoService,
  context: EncryptionContext,
): Promise<ExportBundle> {
  // The context is authenticated data: a bundle belonging to another user or
  // another application fails the integrity check rather than decrypting.
  const plaintext = await crypto.decrypt(encrypted.payload, passphrase, context);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch (cause) {
    throw new DataError(DataErrorCode.IMPORT_INVALID, cause);
  }
  return parseExportBundle(parsed);
}
