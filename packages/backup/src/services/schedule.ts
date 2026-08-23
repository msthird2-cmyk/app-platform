import type { BackupSettings } from '../types/backup';

export function isBackupDue(settings: BackupSettings, now: number): boolean {
  if (!settings.automatic) return false;
  if (settings.lastBackupAt === null) return true;
  return now - settings.lastBackupAt >= settings.intervalHours * 3_600_000;
}

export function nextBackupAt(settings: BackupSettings): number | null {
  if (!settings.automatic) return null;
  if (settings.lastBackupAt === null) return null;
  return settings.lastBackupAt + settings.intervalHours * 3_600_000;
}

export function describeStaleness(settings: BackupSettings, now: number): 'fresh' | 'due' | 'overdue' | 'never' {
  if (settings.lastBackupAt === null) return 'never';
  const age = now - settings.lastBackupAt;
  const interval = settings.intervalHours * 3_600_000;
  if (age < interval) return 'fresh';
  return age >= interval * 3 ? 'overdue' : 'due';
}
