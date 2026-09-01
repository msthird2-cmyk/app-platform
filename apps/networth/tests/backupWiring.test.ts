import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import {
  EncryptingRepository,
  InMemoryRepository,
  createRecord,
  type EncryptedRepository,
} from '@platform/data';
import { PortableRecordCipher, WebCryptoService } from '@platform/security';
import {
  MAX_BACKUP_BYTES,
  createFileBackupTransport,
  runBackup,
  runRestore,
  BackupErrorCode,
  type DocumentPickerLike,
  type FileSystemLike,
  type SharingLike,
} from '@platform/backup';
import { createPreviewServices } from '../src/composition/services';
import { COLLECTIONS } from '../src/collections';

/**
 * The wiring, not the flow.
 *
 * `packages/backup` already proves the transport and the size bound in
 * isolation. What is unproven until here is that *this application* actually
 * builds a native transport and hands it to the composition — a design that is
 * correct and unwired protects nobody.
 */

const crypto = new WebCryptoService(100_000);
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));
const DEK = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
const PASSPHRASE = 'correct1horse-battery';
const NOW = 1_700_000_000_000;
const APP_NAME = 'Net Worth';

function encryptedRepository(): EncryptedRepository {
  return new EncryptingRepository({
    inner: new InMemoryRepository(),
    cipher: new PortableRecordCipher(randomBytes),
    dataKey: async () => DEK,
    userId: 'user-1',
    appName: APP_NAME,
  });
}

/** Stands in for the device, recording everything that touched the disk. */
function fakeDevice(pickedSize?: number) {
  const written = new Map<string, string>();
  const everWritten: { uri: string; contents: string }[] = [];
  const deleted: string[] = [];
  const shared: string[] = [];

  const fileSystem: FileSystemLike = {
    cacheDirectory: 'file:///data/app-private/cache/',
    writeAsStringAsync: async (uri, contents) => {
      written.set(uri, contents);
      everWritten.push({ uri, contents });
    },
    readAsStringAsync: async (uri) => written.get(uri) ?? picked ?? '',
    getInfoAsync: async (uri) =>
      written.has(uri) ? { exists: true, size: (written.get(uri) as string).length } : { exists: false },
    deleteAsync: async (uri) => {
      deleted.push(uri);
      written.delete(uri);
    },
  };
  const sharing: SharingLike = {
    isAvailableAsync: async () => true,
    shareAsync: async (uri) => void shared.push(uri),
  };
  let picked: string | undefined;
  const documentPicker: DocumentPickerLike = {
    getDocumentAsync: async () =>
      picked === undefined
        ? { canceled: true }
        : {
            canceled: false,
            assets: [
              { uri: 'file:///picked.json', name: 'picked.json', size: pickedSize ?? picked.length },
            ],
          },
  };

  return {
    transport: createFileBackupTransport({ fileSystem, sharing, documentPicker }),
    everWritten,
    deleted,
    shared,
    offerForImport: (contents: string) => {
      picked = contents;
      written.set('file:///picked.json', contents);
    },
  };
}

describe('the Net Worth entry point', () => {
  const entryPoint = readFileSync(new URL('../index.tsx', import.meta.url), 'utf8');

  it('builds a native transport from the three Expo modules', () => {
    expect(entryPoint).toContain("import * as FileSystem from 'expo-file-system'");
    expect(entryPoint).toContain("import * as Sharing from 'expo-sharing'");
    expect(entryPoint).toContain("import * as DocumentPicker from 'expo-document-picker'");
    expect(entryPoint).toContain('createFileBackupTransport({');
  });

  it('hands that transport to the composition, in both backends', () => {
    // A backup never depended on the backend — the same transport belongs to a
    // Firebase build and a preview build alike.
    expect(entryPoint).toContain('backupTransport');
    expect(entryPoint).toMatch(/setServices\(\{ \.\.\.composed, backupTransport \}\)/);
  });

  it('declares the Expo modules at the versions this SDK bundles', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies['expo-file-system']).toBe('~18.0.12');
    expect(manifest.dependencies['expo-sharing']).toBe('~13.0.1');
    expect(manifest.dependencies['expo-document-picker']).toBe('~13.0.3');
  });
});

describe('the composition itself', () => {
  it('provides no backup service, because a backup has no backend', () => {
    const preview = createPreviewServices();
    expect('backupService' in preview).toBe(false);
    expect(preview.backupTransport).toBeUndefined();
  });

  it('still works as a preview without one', () => {
    const preview = createPreviewServices();
    expect(preview.backend).toBe('preview');
    expect(preview.repository).toBeDefined();
    expect(preview.escrowStore).toBeDefined();
  });

  it('names no Firebase backup transport anywhere in the composition', () => {
    const source = readFileSync(
      new URL('../src/composition/services.ts', import.meta.url),
      'utf8',
    );
    for (const banned of ['FirebaseBackupService', 'firebase/storage', 'getStorage', 'backups']) {
      expect(source).not.toContain(banned);
    }
  });
});

describe('export through the wired transport', () => {
  it('writes ciphertext to the private cache, shares it, and deletes it', async () => {
    const repository = encryptedRepository();
    await repository.put('assets', createRecord('a1', { name: 'Sovereign gold bonds', value: 310000 }, NOW));
    const device = fakeDevice();

    const summary = await runBackup(repository, crypto, device.transport, {
      appName: APP_NAME,
      userId: 'user-1',
      collections: COLLECTIONS,
      passphrase: PASSPHRASE,
      now: NOW,
    });

    // Written once, under the app-private cache and nowhere else.
    expect(device.everWritten).toHaveLength(1);
    const write = device.everWritten[0] as { uri: string; contents: string };
    expect(write.uri.startsWith('file:///data/app-private/cache/')).toBe(true);

    // Nothing recognisable in what reached the disk.
    for (const secret of ['Sovereign gold bonds', '310000', 'assets']) {
      expect(write.contents).not.toContain(secret);
    }

    expect(device.shared).toEqual([write.uri]);
    // The durable copy is wherever the person sent it. This one is gone.
    expect(device.deleted).toEqual([write.uri]);
    expect(summary.recordCount).toBe(1);
  });
});

describe('import through the wired transport', () => {
  it('round-trips a real export back into records', async () => {
    const source = encryptedRepository();
    await source.put('assets', createRecord('a1', { name: 'Sovereign gold bonds' }, NOW));
    const device = fakeDevice();
    await runBackup(source, crypto, device.transport, {
      appName: APP_NAME,
      userId: 'user-1',
      collections: COLLECTIONS,
      passphrase: PASSPHRASE,
      now: NOW,
    });

    device.offerForImport((device.everWritten[0] as { contents: string }).contents);

    const target = encryptedRepository();
    const result = await runRestore(target, crypto, device.transport, {
      userId: 'user-1',
      appName: APP_NAME,
      collections: COLLECTIONS,
      passphrase: PASSPHRASE,
      confirmed: true,
    });

    expect(result.restored).toBe(1);
    const restored = (await target.list('assets')) as unknown as { name: string }[];
    expect(restored[0]?.name).toBe('Sovereign gold bonds');
  });

  it('refuses an oversized file the picker offers, before reading it', async () => {
    const device = fakeDevice(MAX_BACKUP_BYTES + 1);
    device.offerForImport('{}');

    await expect(
      runRestore(encryptedRepository(), crypto, device.transport, {
        userId: 'user-1',
        appName: APP_NAME,
        collections: COLLECTIONS,
        passphrase: PASSPHRASE,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.BACKUP_TOO_LARGE });
  });

  it('treats a dismissed picker as a cancellation', async () => {
    const device = fakeDevice();
    await expect(
      runRestore(encryptedRepository(), crypto, device.transport, {
        userId: 'user-1',
        appName: APP_NAME,
        collections: COLLECTIONS,
        passphrase: PASSPHRASE,
        confirmed: true,
      }),
    ).rejects.toMatchObject({ code: BackupErrorCode.BACKUP_CANCELLED });
  });
});
