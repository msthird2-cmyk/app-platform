import type { EncryptedExportBundle } from '@platform/data';
import { BackupError, BackupErrorCode } from '../errors';
import type { BackupService, BackupSummary } from '../types/backup';

/** A working BackupService with no backend, for previews and tests. */
export class InMemoryBackupService implements BackupService {
  private readonly bundles = new Map<string, EncryptedExportBundle>();
  private readonly summaries: BackupSummary[] = [];

  async list(): Promise<BackupSummary[]> {
    return [...this.summaries].sort((a, b) => b.createdAt - a.createdAt);
  }

  async upload(bundle: EncryptedExportBundle, summary: Omit<BackupSummary, 'id'>): Promise<BackupSummary> {
    const stored: BackupSummary = { ...summary, id: `backup-${summary.createdAt}` };
    this.bundles.set(stored.id, bundle);
    this.summaries.push(stored);
    return stored;
  }

  async download(id: string): Promise<EncryptedExportBundle> {
    const bundle = this.bundles.get(id);
    if (!bundle) throw new BackupError(BackupErrorCode.BACKUP_NOT_FOUND);
    return bundle;
  }

  async remove(id: string): Promise<void> {
    this.bundles.delete(id);
    const index = this.summaries.findIndex((summary) => summary.id === id);
    if (index >= 0) this.summaries.splice(index, 1);
  }
}
