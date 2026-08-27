import { describe, expect, it } from 'vitest';
import { InMemoryBackupService } from '../src/services/InMemoryBackupService';
import { runBackup, runRestore } from '../src/services/backupFlow';
import { BackupErrorCode } from '../src/errors';
import {
  EncryptingRepository,
  InMemoryRepository,
  createRecord,
  type EncryptedRepository,
} from '@platform/data';
import { PortableRecordCipher, WebCryptoService } from '@platform/security';
import { webcrypto } from 'node:crypto';

const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));
const DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);

/** What an application actually holds: the boundary, not the store below it. */
function encryptedRepository(userId = 'user-1'): EncryptedRepository {
  return new EncryptingRepository({
    inner: new InMemoryRepository(),
    cipher: new PortableRecordCipher(randomBytes),
    dataKey: async () => DEK,
    userId,
    appName: 'Net Worth',
  });
}

const crypto = new WebCryptoService(100_000);
const PASSPHRASE = 'correct1horse-battery';
const CONTEXT = { userId: 'user-1', appName: 'Net Worth' };
const NOW = 1_700_000_000_000;

describe('InMemoryBackupService', () => {
  it('round-trips a real backup and restore', async () => {
    const source = encryptedRepository();
    await source.put('assets', createRecord('a1', { name: 'Savings' }, NOW));

    const backups = new InMemoryBackupService();
    const summary = await runBackup(source, crypto, backups, {
      appName: 'Net Worth',
      userId: 'user-1',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      now: NOW,
    });

    const target = encryptedRepository();
    await runRestore(target, crypto, backups, {
      backupId: summary.id,
      userId: 'user-1',
      appName: 'Net Worth',
      collections: ['assets'],
      passphrase: PASSPHRASE,
      confirmed: true,
    });

    expect(await target.list('assets')).toHaveLength(1);
  });

  it('lists newest first', async () => {
    const backups = new InMemoryBackupService();
    const payload = await crypto.encrypt('{}', PASSPHRASE, CONTEXT);
    const bundle = { schemaVersion: 1, appName: 'X', exportedAt: NOW, payload };
    await backups.upload(bundle, { id: 'first', createdAt: NOW, sizeBytes: 1, recordCount: 1, appName: 'X' });
    await backups.upload(bundle, { id: 'second', createdAt: NOW + 1000, sizeBytes: 1, recordCount: 1, appName: 'X' });
    expect((await backups.list()).map((b) => b.createdAt)).toEqual([NOW + 1000, NOW]);
  });

  it('reports a missing backup with a typed code', async () => {
    await expect(new InMemoryBackupService().download('nope')).rejects.toMatchObject({
      code: BackupErrorCode.BACKUP_NOT_FOUND,
    });
  });

  it('removes a backup from both the list and storage', async () => {
    const backups = new InMemoryBackupService();
    const payload = await crypto.encrypt('{}', PASSPHRASE, CONTEXT);
    const stored = await backups.upload(
      { schemaVersion: 1, appName: 'X', exportedAt: NOW, payload },
      { id: 'only', createdAt: NOW, sizeBytes: 1, recordCount: 1, appName: 'X' },
    );
    await backups.remove(stored.id);
    expect(await backups.list()).toEqual([]);
    await expect(backups.download(stored.id)).rejects.toMatchObject({
      code: BackupErrorCode.BACKUP_NOT_FOUND,
    });
  });
});
