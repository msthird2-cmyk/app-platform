import type { EncryptedExportBundle } from '@platform/data';

export interface BackupSummary {
  id: string;
  createdAt: number;
  /** Bytes of the encrypted payload — never the record contents. */
  sizeBytes: number;
  recordCount: number;
  appName: string;
}

export interface BackupService {
  list(): Promise<BackupSummary[]>;
  upload(bundle: EncryptedExportBundle, summary: Omit<BackupSummary, 'id'>): Promise<BackupSummary>;
  download(id: string): Promise<EncryptedExportBundle>;
  remove(id: string): Promise<void>;
}

export type BackupPhase = 'idle' | 'collecting' | 'encrypting' | 'uploading' | 'done' | 'failed';

export interface BackupProgress {
  phase: BackupPhase;
  /** 0…1 */
  completion: number;
}

export interface BackupSettings {
  automatic: boolean;
  /** How often an automatic backup should run. */
  intervalHours: number;
  lastBackupAt: number | null;
}

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  automatic: true,
  intervalHours: 24,
  lastBackupAt: null,
};
