import { createLogger } from '@platform/utils';
import {
  buildExportBundle,
  decryptExportBundle,
  encryptExportBundle,
  type ExportBundle,
  type Repository,
  type SyncableRecord,
} from '@platform/data';
import type { CryptoService } from '@platform/security';
import { BackupError, BackupErrorCode } from '../errors';
import type { BackupProgress, BackupService, BackupSummary } from '../types/backup';

const log = createLogger({ scope: 'backup' });

export interface RunBackupOptions {
  appName: string;
  collections: readonly string[];
  passphrase: string;
  now: number;
  onProgress?: (progress: BackupProgress) => void;
}

export async function runBackup(
  repository: Repository,
  crypto: CryptoService,
  backups: BackupService,
  options: RunBackupOptions,
): Promise<BackupSummary> {
  const { onProgress } = options;
  if (options.passphrase.length === 0) throw new BackupError(BackupErrorCode.PASSPHRASE_REQUIRED);

  try {
    onProgress?.({ phase: 'collecting', completion: 0.1 });
    const collections: Record<string, SyncableRecord[]> = {};
    let recordCount = 0;
    for (const name of options.collections) {
      const records = await repository.list(name, { includeDeleted: true });
      collections[name] = records;
      recordCount += records.length;
    }

    onProgress?.({ phase: 'encrypting', completion: 0.5 });
    const bundle = buildExportBundle(options.appName, collections, options.now);
    const encrypted = await encryptExportBundle(bundle, options.passphrase, crypto);

    onProgress?.({ phase: 'uploading', completion: 0.8 });
    const summary = await backups.upload(encrypted, {
      createdAt: options.now,
      sizeBytes: encrypted.payload.ciphertext.length,
      recordCount,
      appName: options.appName,
    });

    onProgress?.({ phase: 'done', completion: 1 });
    log.info('backup complete', { recordCount, collections: options.collections.length });
    return summary;
  } catch (cause) {
    onProgress?.({ phase: 'failed', completion: 0 });
    if (cause instanceof BackupError) throw cause;
    throw new BackupError(BackupErrorCode.BACKUP_FAILED, cause);
  }
}

export interface RunRestoreOptions {
  backupId: string;
  passphrase: string;
  /** Restoring overwrites local records, so it needs explicit confirmation. */
  confirmed: boolean;
  onProgress?: (progress: BackupProgress) => void;
}

export async function runRestore(
  repository: Repository,
  crypto: CryptoService,
  backups: BackupService,
  options: RunRestoreOptions,
): Promise<{ restored: number; bundle: ExportBundle }> {
  if (!options.confirmed) throw new BackupError(BackupErrorCode.RESTORE_CONFIRMATION_REQUIRED);
  if (options.passphrase.length === 0) throw new BackupError(BackupErrorCode.PASSPHRASE_REQUIRED);

  try {
    options.onProgress?.({ phase: 'collecting', completion: 0.2 });
    const encrypted = await backups.download(options.backupId);

    options.onProgress?.({ phase: 'encrypting', completion: 0.5 });
    const bundle = await decryptExportBundle(encrypted, options.passphrase, crypto);

    options.onProgress?.({ phase: 'uploading', completion: 0.8 });
    let restored = 0;
    for (const [collection, records] of Object.entries(bundle.collections)) {
      for (const record of records) {
        await repository.put(collection, record);
        restored += 1;
      }
    }

    options.onProgress?.({ phase: 'done', completion: 1 });
    log.info('restore complete', { restored });
    return { restored, bundle };
  } catch (cause) {
    options.onProgress?.({ phase: 'failed', completion: 0 });
    if (cause instanceof BackupError) throw cause;
    throw new BackupError(BackupErrorCode.RESTORE_FAILED, cause);
  }
}
