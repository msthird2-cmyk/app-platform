import {
  collection as firestoreCollection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  getStorage,
  ref,
  uploadString,
  type FirebaseStorage,
} from 'firebase/storage';
import { getAuth, type Auth } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import type { BackupService, BackupSummary, BackupErrorCode } from '@platform/backup';
import { backupError } from '../errors';
import type { EncryptedExportBundle } from '@platform/data';

/**
 * A backup identifier reaches a Cloud Storage path, so it is validated as a
 * path segment before use. Firebase's `ref()` normalises `..`, which would
 * otherwise let a caller-supplied id escape the owner's prefix.
 */
const SAFE_BACKUP_ID = /^[A-Za-z0-9_-]{1,64}$/;

function assertSafeBackupId(id: string): string {
  if (!SAFE_BACKUP_ID.test(id)) {
    throw backupError('BACKUP_NOT_FOUND' satisfies BackupErrorCode);
  }
  return id;
}

/**
 * Only the encrypted payload is uploaded. The Firestore document carries
 * metadata — timestamps and counts — and never any record content.
 */
export class FirebaseBackupService implements BackupService {
  private readonly db: Firestore;
  private readonly storage: FirebaseStorage;
  private readonly auth: Auth;

  constructor(app: FirebaseApp) {
    this.db = getFirestore(app);
    this.storage = getStorage(app);
    this.auth = getAuth(app);
  }

  private requireUserId(): string {
    const userId = this.auth.currentUser?.uid;
    if (!userId) throw backupError('BACKUP_FAILED' satisfies BackupErrorCode);
    return userId;
  }

  async list(): Promise<BackupSummary[]> {
    const userId = this.requireUserId();
    const snapshot = await getDocs(firestoreCollection(this.db, `users/${userId}/backups`));
    return snapshot.docs
      .map((document) => document.data() as BackupSummary)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async upload(bundle: EncryptedExportBundle, summary: BackupSummary): Promise<BackupSummary> {
    const userId = this.requireUserId();
    const id = assertSafeBackupId(summary.id);
    try {
      // The storage rules reject a write to an existing object, so a collision
      // fails loudly here rather than silently replacing an earlier backup.
      await uploadString(
        ref(this.storage, `users/${userId}/backups/${id}.json`),
        JSON.stringify(bundle),
        'raw',
        { contentType: 'application/json' },
      );
      await setDoc(doc(this.db, `users/${userId}/backups`, id), summary);
      return summary;
    } catch (cause) {
      throw backupError('BACKUP_FAILED' satisfies BackupErrorCode, cause);
    }
  }

  async download(id: string): Promise<EncryptedExportBundle> {
    const userId = this.requireUserId();
    const safeId = assertSafeBackupId(id);
    try {
      const bytes = await getBytes(ref(this.storage, `users/${userId}/backups/${safeId}.json`));
      return JSON.parse(new TextDecoder().decode(bytes)) as EncryptedExportBundle;
    } catch (cause) {
      throw backupError('BACKUP_NOT_FOUND' satisfies BackupErrorCode, cause);
    }
  }

  async remove(id: string): Promise<void> {
    const userId = this.requireUserId();
    const safeId = assertSafeBackupId(id);
    try {
      await deleteObject(ref(this.storage, `users/${userId}/backups/${safeId}.json`));
      await deleteDoc(doc(this.db, `users/${userId}/backups`, safeId));
    } catch (cause) {
      throw backupError('BACKUP_FAILED' satisfies BackupErrorCode, cause);
    }
  }
}
