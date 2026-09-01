import { describe, expect, it } from 'vitest';
import { createFileBackupTransport } from '../src/services/createFileBackupTransport';
import { createWebBackupTransport } from '../src/services/createWebBackupTransport';
import { BackupErrorCode } from '../src/errors';
import type { DocumentPickerLike, FileSystemLike, SharingLike } from '../src/services/createFileBackupTransport';
import type { WebBackupHost } from '../src/services/createWebBackupTransport';

/**
 * The adapters, driven through the same injected modules a device supplies.
 *
 * Fakes rather than a bypass: each one implements the structural interface the
 * transport declares, so what runs here is the real adapter logic — the
 * temporary write, the share, the delete, the size lookup — with the platform
 * swapped out. The alternative would be testing a mock of the thing under test.
 */

function fakeFileSystem(overrides: Partial<FileSystemLike> = {}) {
  const files = new Map<string, string>();
  const deleted: string[] = [];
  const system: FileSystemLike = {
    cacheDirectory: 'file:///cache/',
    writeAsStringAsync: async (uri, contents) => void files.set(uri, contents),
    readAsStringAsync: async (uri) => files.get(uri) ?? '',
    getInfoAsync: async (uri) =>
      files.has(uri) ? { exists: true, size: (files.get(uri) as string).length } : { exists: false },
    deleteAsync: async (uri) => {
      deleted.push(uri);
      files.delete(uri);
    },
    ...overrides,
  };
  return { system, files, deleted };
}

function fakeSharing(available = true) {
  const shared: string[] = [];
  const sharing: SharingLike = {
    isAvailableAsync: async () => available,
    shareAsync: async (url) => void shared.push(url),
  };
  return { sharing, shared };
}

const noPicker: DocumentPickerLike = { getDocumentAsync: async () => ({ canceled: true }) };

describe('the native file transport', () => {
  it('writes to the private cache, shares it, then deletes the copy', async () => {
    const { system, files, deleted } = fakeFileSystem();
    const { sharing, shared } = fakeSharing();
    const transport = createFileBackupTransport({
      fileSystem: system,
      sharing,
      documentPicker: noPicker,
    });

    await transport.save('{"ciphertext":"…"}', 'net-worth-backup.json');

    expect(shared).toEqual(['file:///cache/net-worth-backup.json']);
    // The durable copy is wherever the person sent it. One left behind here
    // would make the application a backup store again, which is the whole
    // arrangement this design removes.
    expect(deleted).toEqual(['file:///cache/net-worth-backup.json']);
    expect(files.size).toBe(0);
  });

  it('deletes the temporary copy even when sharing throws', async () => {
    const { system, files, deleted } = fakeFileSystem();
    const transport = createFileBackupTransport({
      fileSystem: system,
      sharing: {
        isAvailableAsync: async () => true,
        shareAsync: async () => {
          throw new Error('dismissed');
        },
      },
      documentPicker: noPicker,
    });

    await expect(transport.save('{}', 'b.json')).rejects.toThrow();
    expect(deleted).toHaveLength(1);
    expect(files.size).toBe(0);
  });

  it('refuses to write anything when there is nowhere to share it', async () => {
    const { system, files } = fakeFileSystem();
    const { sharing } = fakeSharing(false);
    const transport = createFileBackupTransport({
      fileSystem: system,
      sharing,
      documentPicker: noPicker,
    });

    await expect(transport.save('{}', 'b.json')).rejects.toMatchObject({
      code: BackupErrorCode.BACKUP_FAILED,
    });
    // Nothing written. A file with no way out is a backup inside the app.
    expect(files.size).toBe(0);
  });

  it('refuses when there is no private directory rather than using a shared one', async () => {
    const { system } = fakeFileSystem({ cacheDirectory: null });
    const { sharing } = fakeSharing();
    const transport = createFileBackupTransport({
      fileSystem: system,
      sharing,
      documentPicker: noPicker,
    });

    await expect(transport.save('{}', 'b.json')).rejects.toMatchObject({
      code: BackupErrorCode.BACKUP_FAILED,
    });
  });

  it('reports the size the picker gave, before reading', async () => {
    const { system } = fakeFileSystem();
    const { sharing } = fakeSharing();
    const transport = createFileBackupTransport({
      fileSystem: system,
      sharing,
      documentPicker: {
        getDocumentAsync: async () => ({
          canceled: false,
          assets: [{ uri: 'file:///picked.json', name: 'picked.json', size: 4242 }],
        }),
      },
    });

    const file = await transport.open();
    expect(file?.sizeBytes).toBe(4242);
    expect(file?.name).toBe('picked.json');
  });

  it('falls back to the filesystem when the picker reports no size', async () => {
    const { system, files } = fakeFileSystem();
    files.set('file:///picked.json', '12345');
    const { sharing } = fakeSharing();
    const transport = createFileBackupTransport({
      fileSystem: system,
      sharing,
      documentPicker: {
        getDocumentAsync: async () => ({
          canceled: false,
          assets: [{ uri: 'file:///picked.json', name: 'picked.json', size: undefined }],
        }),
      },
    });

    expect((await transport.open())?.sizeBytes).toBe(5);
  });

  it('refuses rather than guessing when no size can be established', async () => {
    const { system } = fakeFileSystem({
      getInfoAsync: async () => ({ exists: true, size: undefined }),
    });
    const { sharing } = fakeSharing();
    const transport = createFileBackupTransport({
      fileSystem: system,
      sharing,
      documentPicker: {
        getDocumentAsync: async () => ({
          canceled: false,
          assets: [{ uri: 'file:///picked.json', name: 'picked.json', size: undefined }],
        }),
      },
    });

    // An unknown size is not zero. A caller that cannot learn the size cannot
    // enforce the limit, so this refuses instead of handing back an unbounded
    // file.
    await expect(transport.open()).rejects.toMatchObject({
      code: BackupErrorCode.BACKUP_CORRUPT,
    });
  });

  it('returns null when the person dismisses the picker', async () => {
    const { system } = fakeFileSystem();
    const { sharing } = fakeSharing();
    const transport = createFileBackupTransport({
      fileSystem: system,
      sharing,
      documentPicker: noPicker,
    });
    expect(await transport.open()).toBeNull();
  });
});

describe('the web transport', () => {
  function fakeHost(file: File | null = null) {
    const downloads: { url: string; fileName: string }[] = [];
    const revoked: string[] = [];
    const host: WebBackupHost = {
      createObjectUrl: () => 'blob:fake',
      revokeObjectUrl: (url) => void revoked.push(url),
      download: (url, fileName) => void downloads.push({ url, fileName }),
      chooseFile: async () => file,
    };
    return { host, downloads, revoked };
  }

  it('downloads the file and releases the blob', async () => {
    const { host, downloads, revoked } = fakeHost();
    await createWebBackupTransport(host).save('{}', 'net-worth-backup.json');

    expect(downloads).toEqual([{ url: 'blob:fake', fileName: 'net-worth-backup.json' }]);
    // Released, so the ciphertext is not held alive by a URL nobody will use.
    expect(revoked).toEqual(['blob:fake']);
  });

  it('reads the chosen file`s size from the browser, not by reading it', async () => {
    const file = new File(['{"a":1}'], 'chosen.json', { type: 'application/json' });
    const { host } = fakeHost(file);
    const opened = await createWebBackupTransport(host).open();

    expect(opened?.sizeBytes).toBe(7);
    expect(opened?.name).toBe('chosen.json');
    expect(await opened?.read()).toBe('{"a":1}');
  });

  it('returns null when the person cancels', async () => {
    const { host } = fakeHost(null);
    expect(await createWebBackupTransport(host).open()).toBeNull();
  });
});
