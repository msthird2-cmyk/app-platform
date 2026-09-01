import { describe, expect, it } from 'vitest';
import { runBackup, runRestore } from '../src/services/backupFlow';
import { BackupErrorCode } from '../src/errors';
import type { BackupTransport, BackupProgress } from '../src/types/backup';
import {
  EncryptingRepository,
  InMemoryRepository,
  createRecord,
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

/**
 * Stands in for a share sheet and a file picker.
 *
 * An injected fake rather than a bypass: the flow still serialises, still hands
 * the bytes to a transport, and still gets a `BackupFile` back with a size it
 * did not compute itself. `open()` returns the most recent export, which is
 * what re-importing a file you just saved amounts to.
 */
function memoryTransport() {
  const saved: string[] = [];
  const transport: BackupTransport = {
    save: async (contents) => void saved.push(contents),
    open: async () => {
      const contents = saved.at(-1);
      if (contents === undefined) return null;
      return {
        name: 'backup.json',
        sizeBytes: contents.length,
        read: async () => contents,
      };
    },
  };
  return { transport, saved };
}

async function seededRepository() {
  const repo = encryptedRepository();
  await repo.put('assets', createRecord('a1', { name: 'Savings' }, NOW));
  await repo.put('assets', createRecord('a2', { name: 'Flat' }, NOW));
  await repo.put('liabilities', createRecord('l1', { name: 'Home loan' }, NOW));
  return repo;
}

describe('runBackup', () => {
  it('saves only an encrypted payload', async () => {
    const repo = await seededRepository();
    const { transport, saved } = memoryTransport();
    const summary = await runBackup(repo, crypto, transport, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets', 'liabilities'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    expect(summary.recordCount).toBe(3);
    // The name is what the person will see in their file manager.
    expect(summary.fileName).toMatch(/^net-worth-backup-\d{4}-\d{2}-\d{2}-[A-Za-z0-9_-]{8}\.json$/);
    expect(saved.join('')).not.toContain('Savings');
  });

  it('reports progress and ends at done', async () => {
    const repo = await seededRepository();
    const { transport } = memoryTransport();
    const phases: BackupProgress['phase'][] = [];
    await runBackup(repo, crypto, transport, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
      onProgress: (progress) => phases.push(progress.phase),
    });
    expect(phases).toEqual(['collecting', 'encrypting', 'saving', 'done']);
  });

  it('refuses a weak passphrase before reading any data', async () => {
    const repo = await seededRepository();
    const { transport, saved } = memoryTransport();
    await expect(
      runBackup(repo, crypto, transport, {
        appName: 'Net Worth',
        userId: 'user-1',
        collections: ['assets'],
        passphrase: 'x',
        now: NOW,
      }),
    ).rejects.toMatchObject({ domain: 'security', code: 'PASSPHRASE_TOO_WEAK' });
    expect(saved).toHaveLength(0);
  });

  it('gives each backup a distinct identifier', async () => {
    const repo = await seededRepository();
    const { transport } = memoryTransport();
    const options = {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    };
    const first = await runBackup(repo, crypto, transport, options);
    // Same millisecond: the old timestamp-derived id would have collided and
    // silently replaced the earlier backup.
    const second = await runBackup(repo, crypto, transport, options);
    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it('requires a passphrase', async () => {
    const repo = await seededRepository();
    const { transport } = memoryTransport();
    await expect(
      runBackup(repo, crypto, transport, {
        appName: 'Net Worth',
        collections: ['assets'],
        passphrase: '',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.PASSPHRASE_REQUIRED });
  });

  it('reports a failed phase when saving fails', async () => {
    const repo = await seededRepository();
    const { transport } = memoryTransport();
    const phases: BackupProgress['phase'][] = [];
    await expect(
      runBackup(
        repo,
        crypto,
        {
          ...transport,
          save: async () => {
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
    const { transport } = memoryTransport();
    await runBackup(source, crypto, transport, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets', 'liabilities'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = encryptedRepository();
    const result = await runRestore(target, crypto, transport, {
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
    const { transport } = memoryTransport();
    await runBackup(source, crypto, transport, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = encryptedRepository();
    await expect(
      runRestore(target, crypto, transport, {
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
    const { transport } = memoryTransport();
    await runBackup(source, crypto, transport, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = encryptedRepository();
    await expect(
      runRestore(target, crypto, transport, {
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
    const { transport } = memoryTransport();
    await runBackup(source, crypto, transport, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    await expect(
      runRestore(encryptedRepository(), crypto, transport, {
        userId: 'user-1',
        appName: 'Expense',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.RESTORE_FAILED });
  });

  it('refuses to overwrite without confirmation', async () => {
    const { transport } = memoryTransport();
    await expect(
      runRestore(encryptedRepository(), crypto, transport, {
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
    const { transport } = memoryTransport();
    await runBackup(source, crypto, transport, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = encryptedRepository();
    await expect(
      runRestore(target, crypto, transport, {
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
    const { transport } = memoryTransport();
    await expect(
      runBackup(unencrypting(), crypto, transport, {
        appName: 'Net Worth',
        userId: 'user-1',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: DataErrorCode.REPOSITORY_NOT_ENCRYPTING });
  });

  it('refuses before it reads anything, so a rejected backup touches no record', async () => {
    const { transport } = memoryTransport();
    const inner = new InMemoryRepository();
    let reads = 0;
    const counting = new Proxy(inner, {
      get(target, property, receiver) {
        if (property === 'list') reads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as unknown as EncryptedRepository;
    await expect(
      runBackup(counting, crypto, transport, {
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
    const { transport } = memoryTransport();
    await expect(
      runRestore(unencrypting(), crypto, transport, {
        userId: 'user-1',
        appName: 'Net Worth',
        collections: ['assets'],
        passphrase: PASSPHRASE,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: DataErrorCode.REPOSITORY_NOT_ENCRYPTING });
  });

  it('refuses before the confirmation check, so nothing is written either way', async () => {
    const { transport } = memoryTransport();
    const target = new InMemoryRepository();
    await expect(
      runRestore(target as unknown as EncryptedRepository, crypto, transport, {
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
