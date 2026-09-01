import { BackupError, BackupErrorCode } from '../errors';
import type { BackupFile, BackupTransport } from '../types/backup';

/**
 * The React Native transport: write to a private temporary file, hand it to the
 * share sheet, delete it.
 *
 * Every Expo module is injected rather than imported, exactly as
 * `createPlatformSecureStorage` takes `expo-secure-store`. The shared package
 * acquires no Expo dependency, the application entry point stays the only place
 * that names a platform module, and the whole thing is testable with three
 * small fakes instead of a device.
 *
 * The interfaces below are structural and deliberately minimal: they describe
 * the corner of each Expo module this uses, so a version bump that adds or
 * reorders options cannot break the build here.
 */

export interface FileSystemLike {
  /** A private, app-scoped directory. Never shared or external storage. */
  readonly cacheDirectory: string | null;
  writeAsStringAsync(fileUri: string, contents: string): Promise<void>;
  readAsStringAsync(fileUri: string): Promise<string>;
  getInfoAsync(fileUri: string): Promise<{ exists: boolean; size?: number | undefined }>;
  deleteAsync(fileUri: string, options?: { idempotent?: boolean }): Promise<void>;
}

export interface SharingLike {
  isAvailableAsync(): Promise<boolean>;
  shareAsync(url: string, options?: { mimeType?: string; dialogTitle?: string }): Promise<void>;
}

export interface DocumentPickerLike {
  getDocumentAsync(options?: {
    type?: string | string[];
    copyToCacheDirectory?: boolean;
    multiple?: boolean;
  }): Promise<
    | { canceled: true }
    | { canceled: false; assets: { uri: string; name: string; size?: number | undefined }[] }
  >;
}

export interface FileBackupTransportOptions {
  fileSystem: FileSystemLike;
  sharing: SharingLike;
  documentPicker: DocumentPickerLike;
}

const MIME = 'application/json';

export function createFileBackupTransport(
  options: FileBackupTransportOptions,
): BackupTransport {
  const { fileSystem, sharing, documentPicker } = options;

  return {
    async save(contents: string, suggestedName: string): Promise<void> {
      const directory = fileSystem.cacheDirectory;
      // No fallback to a shared or external location. On Android that is
      // world-readable to anything holding storage permission, and a backup
      // landing there quietly would be a worse outcome than not exporting.
      if (!directory) throw new BackupError(BackupErrorCode.BACKUP_FAILED);

      if (!(await sharing.isAvailableAsync())) {
        // Writing the file with nowhere to send it would leave a backup inside
        // the application, which is the arrangement this design removes.
        throw new BackupError(BackupErrorCode.BACKUP_FAILED);
      }

      const uri = `${directory.replace(/\/$/, '')}/${suggestedName}`;
      await fileSystem.writeAsStringAsync(uri, contents);
      try {
        await sharing.shareAsync(uri, { mimeType: MIME, dialogTitle: 'Save your backup' });
      } finally {
        // The temporary copy goes whether the share succeeded, failed or was
        // dismissed. The durable copy is wherever the person sent it; this one
        // existing afterwards would make the application a backup store again.
        // Failing to delete must not fail the export, so it is swallowed.
        await fileSystem
          .deleteAsync(uri, { idempotent: true })
          .catch(() => undefined);
      }
    },

    async open(): Promise<BackupFile | null> {
      const result = await documentPicker.getDocumentAsync({
        type: MIME,
        // Copied into the app cache so the URI stays readable after the picker
        // closes; on Android a content:// URI is otherwise a one-shot grant.
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return null;

      const asset = result.assets[0];
      if (!asset) return null;

      // The picker's own size, or the filesystem's if it did not give one.
      // Established before anything is read, which is what lets the caller
      // refuse an oversized file without allocating it.
      let sizeBytes = asset.size;
      if (sizeBytes === undefined) {
        const info = await fileSystem.getInfoAsync(asset.uri);
        if (!info.exists) throw new BackupError(BackupErrorCode.BACKUP_NOT_FOUND);
        sizeBytes = info.size;
      }
      // An unknown size is not treated as zero. A caller that cannot learn the
      // size cannot enforce a bound, so this refuses rather than guessing.
      if (sizeBytes === undefined) throw new BackupError(BackupErrorCode.BACKUP_CORRUPT);

      return {
        name: asset.name,
        sizeBytes,
        read: () => fileSystem.readAsStringAsync(asset.uri),
      };
    },
  };
}
