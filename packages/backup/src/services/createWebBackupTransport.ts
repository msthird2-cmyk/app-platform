import { BackupError, BackupErrorCode } from '../errors';
import type { BackupFile, BackupTransport } from '../types/backup';

/**
 * The browser transport: a download for export, a file input for import.
 *
 * Browser storage is deliberately not involved. `localStorage`, IndexedDB and
 * the origin-private filesystem are all *inside* the application, and a backup
 * the application still holds is not a user-controlled backup — it disappears
 * with cleared site data and it survives nothing that matters. The download
 * hands the file to the person's own filesystem and the application forgets it.
 *
 * The DOM is injected for the same reason the Expo modules are: this package is
 * shared, and `document` does not exist under Node or React Native. A caller
 * that has a real DOM passes it; the tests pass a small fake.
 */

export interface WebBackupHost {
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  /** Triggers the download. Separate so a test can observe it without a DOM. */
  download(url: string, fileName: string): void;
  /** Resolves with the chosen file, or `null` if the person cancelled. */
  chooseFile(accept: string): Promise<File | null>;
}

const MIME = 'application/json';

export function createWebBackupTransport(host: WebBackupHost): BackupTransport {
  return {
    async save(contents: string, suggestedName: string): Promise<void> {
      const url = host.createObjectUrl(new Blob([contents], { type: MIME }));
      try {
        host.download(url, suggestedName);
      } finally {
        // Releases the blob so the ciphertext is not held alive in memory by a
        // URL nobody is going to use again.
        host.revokeObjectUrl(url);
      }
    },

    async open(): Promise<BackupFile | null> {
      const file = await host.chooseFile(MIME);
      if (file === null) return null;

      // `File.size` is metadata the browser already holds; reading it costs
      // nothing and, crucially, happens before `text()` allocates the contents.
      const sizeBytes = file.size;
      if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes)) {
        throw new BackupError(BackupErrorCode.BACKUP_CORRUPT);
      }

      return {
        name: file.name,
        sizeBytes,
        read: () => file.text(),
      };
    },
  };
}

/**
 * The real DOM implementation, for an application running in a browser.
 *
 * Kept separate from the transport so the transport itself stays testable, and
 * so this — the only part that touches `document` — is small enough to read in
 * one go.
 */
export function createDomBackupHost(documentRef: Document): WebBackupHost {
  return {
    createObjectUrl: (blob) => URL.createObjectURL(blob),
    revokeObjectUrl: (url) => URL.revokeObjectURL(url),
    download(url, fileName) {
      const anchor = documentRef.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      documentRef.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    chooseFile(accept) {
      return new Promise<File | null>((resolve) => {
        const input = documentRef.createElement('input');
        input.type = 'file';
        input.accept = accept;
        // A cancelled picker fires no `change` event in most browsers, so the
        // promise would hang. `cancel` is the modern signal; the window focus
        // fallback covers browsers that do not send it.
        const finish = (file: File | null) => {
          input.remove();
          resolve(file);
        };
        input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
        input.addEventListener('cancel', () => finish(null), { once: true });
        input.style.display = 'none';
        documentRef.body.appendChild(input);
        input.click();
      });
    },
  };
}
