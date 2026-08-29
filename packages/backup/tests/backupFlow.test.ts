import { describe, expect, it } from 'vitest';
import { runBackup, runRestore } from '../src/services/backupFlow';
import { BackupErrorCode } from '../src/errors';
import type { BackupService, BackupSummary, BackupProgress } from '../src/types/backup';
import {
  EncryptingRepository,
  InMemoryRepository,
  createRecord,
  type EncryptedExportBundle,
  type EncryptedRepository,
} from '@platform/data';
import { PortableRecordCipher, WebCryptoService } from '@platform/security';
import { webcrypto } from 'node:crypto';
import { DataErrorCode } from '@platform/data';

const crypto = new WebCryptoService(100_000);
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));
const DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);

/**
 * The repository these flows are actually given in an application: the
 * encryption boundary, not the store beneath it.
 *
 * The tests used to construct `InMemoryRepository` directly, which is exactly
 * the wiring the boundary now forbids — and the reason it forbids it is
 * `runRestore`, whose `repository.put` would otherwise send plaintext domain
 * fields straight at persistence.
 */
function encryptedRepository(): EncryptedRepository {
  return new EncryptingRepository({
    inner: new InMemoryRepository(),
    cipher: new PortableRecordCipher(randomBytes),
    dataKey: async () => DEK,
    userId: 'user-1',
    appName: 'Net Worth',
  });
}
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
  const repo = encryptedRepository();
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

    const target = encryptedRepository();
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
    const source = encryptedRepository();
    await source.put('assets', createRecord('a1', { name: 'Savings' }, NOW));
    const { service } = memoryBackupService();
    const summary = await runBackup(source, crypto, service, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = encryptedRepository();
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
    const source = encryptedRepository();
    await source.put('assets', createRecord('a1', {}, NOW));
    const { service } = memoryBackupService();
    const summary = await runBackup(source, crypto, service, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = encryptedRepository();
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
    const source = encryptedRepository();
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
      runRestore(encryptedRepository(), crypto, service, {
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
      runRestore(encryptedRepository(), crypto, service, {
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

    const target = encryptedRepository();
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

/**
 * The control that stops a backup flow writing plaintext.
 *
 * `runRestore` calls `repository.put` with domain records straight out of a
 * decrypted bundle. Given the store beneath the encryption boundary those
 * fields reach persistence in the clear — the Firestore rules refuse a document
 * with no envelope, so it fails closed, but the architecture must not rely on
 * the server noticing. The type says `EncryptedRepository`; this is the check
 * that still holds when a cast, an `any` at a module edge or a JavaScript
 * caller gets past the compiler.
 */
describe('the encryption boundary these flows require', () => {
  const unencrypting = () => new InMemoryRepository() as unknown as EncryptedRepository;

  it('refuses to back up from a repository that does not encrypt', async () => {
    const { service } = memoryBackupService();
    await expect(
      runBackup(unencrypting(), crypto, service, {
        appName: 'Net Worth',
        userId: 'user-1',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: DataErrorCode.REPOSITORY_NOT_ENCRYPTING });
  });

  it('refuses before it reads anything, so a rejected backup touches no record', async () => {
    const { service } = memoryBackupService();
    const inner = new InMemoryRepository();
    let reads = 0;
    const counting = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'list') reads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as unknown as EncryptedRepository;
    await expect(
      runBackup(counting, crypto, service, {
        appName: 'Net Worth',
        userId: 'user-1',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: DataErrorCode.REPOSITORY_NOT_ENCRYPTING });
    expect(reads).toBe(0);
  });

  it('refuses to restore into a repository that does not encrypt', async () => {
    const { service } = memoryBackupService();
    await expect(
      runRestore(unencrypting(), crypto, service, {
        backupId: 'anything',
        userId: 'user-1',
        appName: 'Net Worth',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: DataErrorCode.REPOSITORY_NOT_ENCRYPTING });
  });

  it('refuses before the confirmation check, so nothing is written either way', async () => {
    const { service } = memoryBackupService();
    const target = new InMemoryRepository();
    await expect(
      runRestore(target as unknown as EncryptedRepository, crypto, service, {
        backupId: 'anything',
        userId: 'user-1',
        appName: 'Net Worth',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: DataErrorCode.REPOSITORY_NOT_ENCRYPTING });
    expect(await target.list('assets')).toEqual([]);
  });
});
