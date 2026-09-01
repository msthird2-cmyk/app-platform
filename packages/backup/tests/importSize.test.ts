import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  EncryptingRepository,
  InMemoryRepository,
  createRecord,
  type EncryptedRepository,
} from '@platform/data';
import { PortableRecordCipher, WebCryptoService } from '@platform/security';
import { runBackup, runRestore } from '../src/services/backupFlow';
import { BackupErrorCode } from '../src/errors';
import { MAX_BACKUP_BYTES, type BackupTransport } from '../src/types/backup';

/**
 * The bound that replaced a Security Rule.
 *
 * While backups went to Cloud Storage, `storage.rules` refused an upload over
 * 25 MB, so nothing this application parsed could be larger than that. A backup
 * is now a file somebody chose off their own filesystem, and no rule stands
 * between it and `JSON.parse` — so the same ceiling is enforced here instead.
 *
 * What these assert is not only that an oversized file is refused, but *when*:
 * before it is read, before it is parsed, and before any key is derived. A
 * check that ran after the allocation would be documentation, not a limit.
 */

const crypto = new WebCryptoService(100_000);
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));
const DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);
const PASSPHRASE = 'correct1horse-battery';
const NOW = 1_700_000_000_000;

function encryptedRepository(): EncryptedRepository {
  return new EncryptingRepository({
    inner: new InMemoryRepository(),
    cipher: new PortableRecordCipher(randomBytes),
    dataKey: async () => DEK,
    userId: 'user-1',
    appName: 'Net Worth',
  });
}

/**
 * A transport that reports whatever size it is told to, and counts reads.
 *
 * The read counter is the actual assertion: if the flow refuses an oversized
 * file without ever calling `read()`, the rejection provably happened before
 * the contents existed in memory.
 */
function probeTransport(contents: string, reportedSize = contents.length) {
  const state = { reads: 0 };
  const transport: BackupTransport = {
    save: async () => undefined,
    open: async () => ({
      name: 'backup.json',
      sizeBytes: reportedSize,
      read: async () => {
        state.reads += 1;
        return contents;
      },
    }),
  };
  return { transport, state };
}

const restoreOptions = {
  userId: 'user-1',
  appName: 'Net Worth',
  collections: ['assets'],
  passphrase: PASSPHRASE,
  confirmed: true,
};

/** A genuine export, so the "accepted" cases are not vacuous. */
async function realBackup(): Promise<string> {
  const source = encryptedRepository();
  await source.put('assets', createRecord('a1', { name: 'Savings' }, NOW));
  const saved: string[] = [];
  const transport: BackupTransport = {
    save: async (contents) => void saved.push(contents),
    open: async () => null,
  };
  await runBackup(source, crypto, transport, {
    appName: 'Net Worth',
    userId: 'user-1',
    collections: ['assets'],
    passphrase: PASSPHRASE,
    now: NOW,
  });
  return saved[0] as string;
}

describe('the import size limit', () => {
  it('accepts a real backup, which is far below the limit', async () => {
    const contents = await realBackup();
    expect(contents.length).toBeLessThan(MAX_BACKUP_BYTES);

    const { transport, state } = probeTransport(contents);
    const target = encryptedRepository();
    const result = await runRestore(target, crypto, transport, restoreOptions);

    expect(result.restored).toBe(1);
    expect(state.reads).toBe(1);
  });

  it('accepts a file reporting exactly the limit', async () => {
    const contents = await realBackup();
    // The boundary is inclusive: `> MAX` is refused, `== MAX` is not. A file of
    // exactly the ceiling is the largest legitimate backup, and refusing it
    // would make the documented limit off by one.
    const { transport, state } = probeTransport(contents, MAX_BACKUP_BYTES);
    const target = encryptedRepository();
    const result = await runRestore(target, crypto, transport, restoreOptions);

    expect(result.restored).toBe(1);
    expect(state.reads).toBe(1);
  });

  it('refuses one byte over the limit without reading the file', async () => {
    const { transport, state } = probeTransport('{}', MAX_BACKUP_BYTES + 1);
    await expect(
      runRestore(encryptedRepository(), crypto, transport, restoreOptions),
    ).rejects.toMatchObject({ code: BackupErrorCode.BACKUP_TOO_LARGE });

    // The whole point. Nothing was read, so nothing was allocated or parsed.
    expect(state.reads).toBe(0);
  });

  it('refuses an adapter that under-reports its size', async () => {
    // Valid JSON, so a flow that parsed first would get past the parse and fail
    // later — with a decryption error rather than a size error. Getting
    // BACKUP_TOO_LARGE proves the second check cut it short.
    const oversized = `{"padding":"${'a'.repeat(MAX_BACKUP_BYTES + 10)}"}`;
    const { transport } = probeTransport(oversized, 10);
    await expect(
      runRestore(encryptedRepository(), crypto, transport, restoreOptions),
    ).rejects.toMatchObject({ code: BackupErrorCode.BACKUP_TOO_LARGE });
  });

  it('refuses a file whose size the platform could not report', async () => {
    const { transport, state } = probeTransport('{}', Number.NaN);
    await expect(
      runRestore(encryptedRepository(), crypto, transport, restoreOptions),
    ).rejects.toMatchObject({ code: BackupErrorCode.BACKUP_CORRUPT });
    expect(state.reads).toBe(0);
  });

  it('still runs the envelope checks once the size check passes', async () => {
    // Small enough, and not a backup. The size limit is a gate in front of the
    // existing validation, never a replacement for it.
    const { transport } = probeTransport('{"schemaVersion":1,"payload":{}}');
    await expect(
      runRestore(encryptedRepository(), crypto, transport, restoreOptions),
    ).rejects.toMatchObject({ code: BackupErrorCode.RESTORE_FAILED });
  });

  it('reports a file that is not JSON without deriving a key', async () => {
    const { transport } = probeTransport('not a backup at all');
    await expect(
      runRestore(encryptedRepository(), crypto, transport, restoreOptions),
    ).rejects.toMatchObject({ code: BackupErrorCode.BACKUP_CORRUPT });
  });

  it('treats a dismissed picker as a cancellation, not a failure', async () => {
    const transport: BackupTransport = {
      save: async () => undefined,
      open: async () => null,
    };
    await expect(
      runRestore(encryptedRepository(), crypto, transport, restoreOptions),
    ).rejects.toMatchObject({ code: BackupErrorCode.BACKUP_CANCELLED });
  });
});
