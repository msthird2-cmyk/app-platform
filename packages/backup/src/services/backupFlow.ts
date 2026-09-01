import { createId, createLogger } from '@platform/utils';
import {
  assertEncryptedRepository,
  buildExportBundle,
  decryptExportBundle,
  encryptExportBundle,
  type EncryptedRepository,
  type ExportBundle,
  type SyncableRecord,
} from '@platform/data';
import { assertStrongPassphrase, type CryptoService } from '@platform/security';
import { BackupError, BackupErrorCode } from '../errors';
import {
  MAX_BACKUP_BYTES,
  type BackupProgress,
  type BackupSummary,
  type BackupTransport,
} from '../types/backup';

const log = createLogger({ scope: 'backup' });

/**
 * A filename a person can recognise a year later, and that every platform will
 * accept. The application name is slugged rather than interpolated raw: it
 * reaches a filesystem, and a share sheet is not the place to discover that a
 * space or a slash was allowed through.
 */
function backupFileName(appName: string, now: number): string {
  const slug =
    appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
  const day = new Date(now).toISOString().slice(0, 10);
  // A random suffix, not a counter: two exports on the same day must not
  // collide in whatever folder the person keeps them in.
  return `${slug}-backup-${day}-${createId(8)}.json`;
}

export interface RunBackupOptions {
  appName: string;
  /** Owner of the data. Bound into the ciphertext as authenticated data. */
  userId: string;
  collections: readonly string[];
  passphrase: string;
  now: number;
  onProgress?: (progress: BackupProgress) => void;
}

/**
 * Both directions of this flow require the repository *above* the encryption
 * boundary, and for opposite reasons.
 *
 * Backup reads. Given the raw repository it would read stored documents rather
 * than domain objects — envelopes, not records — and produce an export that
 * decrypts to ciphertext nobody can open without a data encryption key the
 * bundle does not contain. A backup that silently cannot be restored is worse
 * than a failed one.
 *
 * Restore writes, and that is the dangerous half: `repository.put` on a raw
 * repository sends plaintext domain fields straight at Firestore. The Security
 * Rules reject a document with no envelope, so it fails closed — but the
 * architecture must not depend on the server for that, which is why the type
 * says `EncryptedRepository` and the first statement checks it anyway.
 *
 * What changed when backups became user-controlled is only where the ciphertext
 * goes. The bundle format, the KDF cost, the AAD binding, the passphrase policy
 * and both assertions are exactly what they were when the destination was Cloud
 * Storage.
 */
export async function runBackup(
  repository: EncryptedRepository,
  crypto: CryptoService,
  transport: BackupTransport,
  options: RunBackupOptions,
): Promise<BackupSummary> {
  // Before the passphrase check and before any read: a cast or a JavaScript
  // caller gets past the type, and this is the moment that would matter.
  assertEncryptedRepository(repository);
  const { onProgress } = options;
  if (options.passphrase.length === 0) throw new BackupError(BackupErrorCode.PASSPHRASE_REQUIRED);
  // A weak passphrase defeats every other control on this path, so it is
  // rejected before any data is read. It carries more weight than it used to:
  // the file leaves the application entirely, so the passphrase is the only
  // thing between whoever ends up holding it and the person's finances.
  assertStrongPassphrase(options.passphrase);

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
    const encrypted = await encryptExportBundle(bundle, options.passphrase, crypto, {
      userId: options.userId,
      appName: options.appName,
    });

    onProgress?.({ phase: 'saving', completion: 0.8 });
    const fileName = backupFileName(options.appName, options.now);
    // Serialised here rather than inside the adapter, so every transport hands
    // over byte-identical contents and a file written on one platform imports
    // on another.
    await transport.save(JSON.stringify(encrypted), fileName);

    onProgress?.({ phase: 'done', completion: 1 });
    log.info('backup exported', { recordCount, collections: options.collections.length });
    return {
      id: createId(20),
      createdAt: options.now,
      sizeBytes: encrypted.payload.ciphertext.length,
      recordCount,
      appName: options.appName,
      fileName,
    };
  } catch (cause) {
    onProgress?.({ phase: 'failed', completion: 0 });
    if (cause instanceof BackupError) throw cause;
    throw new BackupError(BackupErrorCode.BACKUP_FAILED, cause);
  }
}

export interface RunRestoreOptions {
  /** Must match the owner the bundle was encrypted for. */
  userId: string;
  appName: string;
  /** Only these collection names may be written by a restore. */
  collections: readonly string[];
  passphrase: string;
  /** Restoring overwrites local records, so it needs explicit confirmation. */
  confirmed: boolean;
  onProgress?: (progress: BackupProgress) => void;
}

/**
 * Reads a chosen file, refusing anything too large before it is touched.
 *
 * The order is the whole point. `sizeBytes` comes from the platform, so an
 * oversized file is rejected without being read, allocated or parsed — the
 * protection `storage.rules` used to give with its 25 MB upload cap, now that
 * nothing stands between a person's filesystem and this function.
 */
async function readChosenBackup(transport: BackupTransport): Promise<unknown> {
  const file = await transport.open();
  if (file === null) throw new BackupError(BackupErrorCode.BACKUP_CANCELLED);

  if (!Number.isFinite(file.sizeBytes) || file.sizeBytes < 0) {
    throw new BackupError(BackupErrorCode.BACKUP_CORRUPT);
  }
  if (file.sizeBytes > MAX_BACKUP_BYTES) {
    throw new BackupError(BackupErrorCode.BACKUP_TOO_LARGE);
  }

  const contents = await file.read();
  // Checked again against what was actually returned. The first check trusts
  // the adapter's metadata; this one does not, so an adapter that under-reports
  // its size cannot turn that into an unbounded parse.
  if (contents.length > MAX_BACKUP_BYTES) {
    throw new BackupError(BackupErrorCode.BACKUP_TOO_LARGE);
  }

  try {
    return JSON.parse(contents) as unknown;
  } catch (cause) {
    // A file that is not JSON is not a backup. It says nothing about whether
    // the passphrase was right, and no key is derived to find out.
    throw new BackupError(BackupErrorCode.BACKUP_CORRUPT, cause);
  }
}

export async function runRestore(
  repository: EncryptedRepository,
  crypto: CryptoService,
  transport: BackupTransport,
  options: RunRestoreOptions,
): Promise<{ restored: number; bundle: ExportBundle }> {
  assertEncryptedRepository(repository);
  if (!options.confirmed) throw new BackupError(BackupErrorCode.RESTORE_CONFIRMATION_REQUIRED);
  if (options.passphrase.length === 0) throw new BackupError(BackupErrorCode.PASSPHRASE_REQUIRED);

  try {
    options.onProgress?.({ phase: 'collecting', completion: 0.2 });
    // Untrusted from here down. This came off a filesystem, not from a store
    // the application itself wrote under owner-only rules.
    const encrypted = await readChosenBackup(transport);

    options.onProgress?.({ phase: 'encrypting', completion: 0.5 });
    const bundle = await decryptExportBundle(
      encrypted as Parameters<typeof decryptExportBundle>[0],
      options.passphrase,
      crypto,
      { userId: options.userId, appName: options.appName },
    );

    // Collection names come out of a decrypted bundle and are not trusted:
    // only the application's own collections may be written.
    const allowed = new Set(options.collections);
    for (const collection of Object.keys(bundle.collections)) {
      if (!allowed.has(collection)) throw new BackupError(BackupErrorCode.BACKUP_CORRUPT);
    }

    options.onProgress?.({ phase: 'saving', completion: 0.8 });
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
