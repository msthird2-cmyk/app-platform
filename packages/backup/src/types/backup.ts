import type { EncryptedExportBundle } from '@platform/data';

export interface BackupSummary {
  id: string;
  createdAt: number;
  /** Bytes of the encrypted payload — never the record contents. */
  sizeBytes: number;
  recordCount: number;
  appName: string;
  /** What the file was called when it was handed to the person. */
  fileName: string;
}

/**
 * The largest backup file this application will parse.
 *
 * Until backups became user-controlled files this bound came from
 * `storage.rules`, which capped an upload at 25 MB. Removing Cloud Storage
 * removed that check, and an import is now an arbitrary file somebody chose —
 * so the same ceiling is stated here instead, and enforced *before* the bytes
 * are read or parsed. A hostile file therefore costs a size lookup and nothing
 * more: no allocation, no parse, no key derivation.
 *
 * The number is deliberately unchanged. It was already the operative limit, so
 * nothing that could be backed up before this change can fail to restore after
 * it.
 */
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

/**
 * A file the person chose, before it has been read.
 *
 * `sizeBytes` is separate from `read()` precisely so the size check can happen
 * without allocating the contents. An adapter must report the size the platform
 * tells it, never one it computes by reading the file first — doing that would
 * put the allocation back before the check and defeat the limit.
 */
export interface BackupFile {
  readonly name: string;
  readonly sizeBytes: number;
  read(): Promise<string>;
}

/**
 * Where a backup goes, and where it comes from.
 *
 * Deliberately not a store. There is no `list`, no `download(id)` and no
 * `remove`, because the application does not hold the backups — the person
 * does, wherever they chose to put the file. An interface carrying those
 * methods is one a server ends up implementing, which is how the previous
 * design ended up with a copy of every user's finances in Cloud Storage.
 *
 * It deals in text rather than a parsed bundle so that the size check and the
 * `JSON.parse` both stay in `backupFlow`, where the rules about untrusted input
 * live, rather than being duplicated into — and eventually forgotten by — an
 * adapter.
 */
export interface BackupTransport {
  /** Hands the encrypted file to the person. */
  save(contents: string, suggestedName: string): Promise<void>;
  /** The file they chose, or `null` if they cancelled. */
  open(): Promise<BackupFile | null>;
}

export type BackupPhase = 'idle' | 'collecting' | 'encrypting' | 'saving' | 'done' | 'failed';

export interface BackupProgress {
  phase: BackupPhase;
  /** 0…1 */
  completion: number;
}

export interface BackupSettings {
  /**
   * Whether the application reminds the person that an export is due.
   *
   * A reminder, not an automatic upload: producing a backup opens a share sheet
   * and needs somebody to choose a destination, so nothing here can run
   * unattended. That is a direct consequence of the backup being theirs rather
   * than the server's.
   */
  automatic: boolean;
  /** How often a reminder should appear. */
  intervalHours: number;
  lastBackupAt: number | null;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  automatic: true,
  intervalHours: 24,
  lastBackupAt: null,
};

export type { EncryptedExportBundle };
