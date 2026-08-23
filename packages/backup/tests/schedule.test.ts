import { describe, expect, it } from 'vitest';
import { describeStaleness, isBackupDue, nextBackupAt } from '../src/services/schedule';
import { DEFAULT_BACKUP_SETTINGS, type BackupSettings } from '../src/types/backup';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function settings(overrides: Partial<BackupSettings> = {}): BackupSettings {
  return { ...DEFAULT_BACKUP_SETTINGS, ...overrides };
}

describe('backup schedule', () => {
  it('is due when no backup has ever run', () => {
    expect(isBackupDue(settings(), NOW)).toBe(true);
    expect(describeStaleness(settings(), NOW)).toBe('never');
  });

  it('is not due before the interval elapses', () => {
    const current = settings({ lastBackupAt: NOW - 23 * HOUR });
    expect(isBackupDue(current, NOW)).toBe(false);
    expect(describeStaleness(current, NOW)).toBe('fresh');
  });

  it('is due exactly at the interval', () => {
    expect(isBackupDue(settings({ lastBackupAt: NOW - 24 * HOUR }), NOW)).toBe(true);
  });

  it('is overdue after three intervals', () => {
    expect(describeStaleness(settings({ lastBackupAt: NOW - 72 * HOUR }), NOW)).toBe('overdue');
  });

  it('never runs when automatic backup is off', () => {
    const off = settings({ automatic: false, lastBackupAt: NOW - 100 * HOUR });
    expect(isBackupDue(off, NOW)).toBe(false);
    expect(nextBackupAt(off)).toBeNull();
  });

  it('projects the next run', () => {
    expect(nextBackupAt(settings({ lastBackupAt: NOW }))).toBe(NOW + 24 * HOUR);
  });
});
