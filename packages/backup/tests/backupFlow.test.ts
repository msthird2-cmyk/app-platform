import { describe, expect, it } from 'vitest';
import { runBackup, runRestore } from '../src/services/backupFlow';
import { BackupErrorCode } from '../src/errors';
import type { BackupService, BackupSummary, BackupProgress } from '../src/types/backup';
import { InMemoryRepository, createRecord, type EncryptedExportBundle } from '@platform/data';
import { WebCryptoService } from '@platform/security';

const crypto = new WebCryptoService(100_000);
const PASSPHRASE = 'correct1horse-battery';
const NOW = 1_700_000_000_000;

function memoryBackupService() {
  const stored = new Map<string, EncryptedExportBundle>();
  const summaries: BackupSummary[] = [];
  const service: BackupService = {
    list: async () => [...summaries],
    upload: async (bundle, summary) => {
      stored.set(summary.id, bundle);
      summaries.push(summary);
      return summary;
    },
    download: async (id) => {
      const bundle = stored.get(id);
      if (!bundle) throw new Error('missing');
      return bundle;
    },
    remove: async (id) => void stored.delete(id),
  };
  return { service, stored };
}

async function seededRepository() {
  const repo = new InMemoryRepository();
  await repo.put('assets', createRecord('a1', { name: 'Savings' }, NOW));
  await repo.put('assets', createRecord('a2', { name: 'Flat' }, NOW));
  await repo.put('liabilities', createRecord('l1', { name: 'Home loan' }, NOW));
  return repo;
}

describe('runBackup', () => {
  it('uploads only an encrypted payload', async () => {
    const repo = await seededRepository();
    const { service, stored } = memoryBackupService();
    const summary = await runBackup(repo, crypto, service, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets', 'liabilities'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    expect(summary.recordCount).toBe(3);
    expect(JSON.stringify([...stored.values()])).not.toContain('Savings');
  });

  it('reports progress and ends at done', async () => {
    const repo = await seededRepository();
    const { service } = memoryBackupService();
    const phases: BackupProgress['phase'][] = [];
    await runBackup(repo, crypto, service, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
      onProgress: (progress) => phases.push(progress.phase),
    });
    expect(phases).toEqual(['collecting', 'encrypting', 'uploading', 'done']);
  });

  it('refuses a weak passphrase before reading any data', async () => {
    const repo = await seededRepository();
    const { service, stored } = memoryBackupService();
    await expect(
      runBackup(repo, crypto, service, {
        appName: 'Net Worth',
        userId: 'user-1',
        collections: ['assets'],
        passphrase: 'x',
        now: NOW,
      }),
    ).rejects.toMatchObject({ domain: 'security', code: 'PASSPHRASE_TOO_WEAK' });
    expect(stored.size).toBe(0);
  });

  it('gives each backup a distinct identifier', async () => {
    const repo = await seededRepository();
    const { service } = memoryBackupService();
    const options = {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    };
    const first = await runBackup(repo, crypto, service, options);
    // Same millisecond: the old timestamp-derived id would have collided and
    // silently replaced the earlier backup.
    const second = await runBackup(repo, crypto, service, options);
    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('requires a passphrase', async () => {
    const repo = await seededRepository();
    const { service } = memoryBackupService();
    await expect(
      runBackup(repo, crypto, service, {
        appName: 'Net Worth',
        collections: ['assets'],
        passphrase: '',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.PASSPHRASE_REQUIRED });
  });

  it('reports a failed phase when the upload fails', async () => {
    const repo = await seededRepository();
    const { service } = memoryBackupService();
    const phases: BackupProgress['phase'][] = [];
    await expect(
      runBackup(
        repo,
        crypto,
        {
          ...service,
          upload: async () => {
            throw new Error('offline');
          },
        },
        {
          appName: 'Net Worth',
          userId: 'user-1',
          collections: ['assets'],
          passphrase: PASSPHRASE,
          now: NOW,
          onProgress: (progress) => phases.push(progress.phase),
        },
      ),
    ).rejects.toMatchObject({ code: BackupErrorCode.BACKUP_FAILED });
    expect(phases.at(-1)).toBe('failed');
  });
});

describe('runRestore', () => {
  it('restores every record', async () => {
    const source = await seededRepository();
    const { service } = memoryBackupService();
    const summary = await runBackup(source, crypto, service, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets', 'liabilities'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = new InMemoryRepository();
    const result = await runRestore(target, crypto, service, {
      backupId: summary.id,
      userId: 'user-1',
      appName: 'Net Worth',
      collections: ['assets', 'liabilities'],
      passphrase: PASSPHRASE,
      confirmed: true,
    });

    expect(result.restored).toBe(3);
    expect(await target.list('assets')).toHaveLength(2);
  });

  it('refuses a bundle naming a collection the application does not own', async () => {
    const source = new InMemoryRepository();
    await source.put('assets', createRecord('a1', { name: 'Savings' }, NOW));
    const { service } = memoryBackupService();
    const summary = await runBackup(source, crypto, service, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = new InMemoryRepository();
    await expect(
      runRestore(target, crypto, service, {
        backupId: summary.id,
        userId: 'user-1',
        appName: 'Net Worth',
        collections: ['liabilities'],
        passphrase: PASSPHRASE,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.BACKUP_CORRUPT });
    expect(await target.list('assets')).toEqual([]);
  });

  it('refuses a bundle belonging to another user', async () => {
    const source = new InMemoryRepository();
    await source.put('assets', createRecord('a1', {}, NOW));
    const { service } = memoryBackupService();
    const summary = await runBackup(source, crypto, service, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = new InMemoryRepository();
    await expect(
      runRestore(target, crypto, service, {
        backupId: summary.id,
        userId: 'someone-else',
        appName: 'Net Worth',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.RESTORE_FAILED });
    expect(await target.list('assets')).toEqual([]);
  });

  it('refuses a bundle belonging to another application', async () => {
    const source = new InMemoryRepository();
    await source.put('assets', createRecord('a1', {}, NOW));
    const { service } = memoryBackupService();
    const summary = await runBackup(source, crypto, service, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    await expect(
      runRestore(new InMemoryRepository(), crypto, service, {
        backupId: summary.id,
        userId: 'user-1',
        appName: 'Expense',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.RESTORE_FAILED });
  });

  it('refuses to overwrite without confirmation', async () => {
    const { service } = memoryBackupService();
    await expect(
      runRestore(new InMemoryRepository(), crypto, service, {
        backupId: 'b1',
        userId: 'user-1',
        appName: 'Net Worth',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        confirmed: false,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.RESTORE_CONFIRMATION_REQUIRED });
  });

  it('leaves the target untouched when the passphrase is wrong', async () => {
    const source = await seededRepository();
    const { service } = memoryBackupService();
    const summary = await runBackup(source, crypto, service, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = new InMemoryRepository();
    await expect(
      runRestore(target, crypto, service, {
        backupId: summary.id,
        userId: 'user-1',
        appName: 'Net Worth',
        collections: ['assets'],
        passphrase: 'wrong1horse-battery',
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.RESTORE_FAILED });
    expect(await target.list('assets')).toEqual([]);
  });
});
