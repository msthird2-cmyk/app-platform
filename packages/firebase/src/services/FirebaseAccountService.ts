import { deleteUser, getAuth, type Auth } from 'firebase/auth';
import {
  collection as firestoreCollection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { deleteObject, listAll, ref, getStorage, type FirebaseStorage } from 'firebase/storage';
import type { FirebaseApp } from 'firebase/app';
import type { AccountService, UserProfile, AccountErrorCode } from '@platform/account';
import { accountError } from '../errors';

/**
 * Subcollections the platform owns beyond an application's record collections.
 * Firestore does not cascade, so anything omitted here survives deletion and —
 * once the auth account is gone — can never be reached again.
 */
const SECONDARY_COLLECTIONS = ['devices', 'settings'] as const;

const DELETION_JOURNAL = 'deletion';
const DELETION_JOURNAL_DOC = 'status';

/** The single field a client is permitted to write to its own profile. */
const CLIENT_WRITABLE_PROFILE_FIELDS = ['displayName'] as const;

export class FirebaseAccountService implements AccountService {
  private readonly auth: Auth;
  private readonly db: Firestore;
  private readonly storage: FirebaseStorage;

  constructor(
    app: FirebaseApp,
    private readonly collections: readonly string[],
  ) {
    this.auth = getAuth(app);
    this.db = getFirestore(app);
    this.storage = getStorage(app);
  }

  private requireUserId(): string {
    const userId = this.auth.currentUser?.uid;
    if (!userId) throw accountError('REAUTHENTICATION_REQUIRED' satisfies AccountErrorCode);
    return userId;
  }

  async getProfile(): Promise<UserProfile> {
    const user = this.auth.currentUser;
    if (!user) throw accountError('REAUTHENTICATION_REQUIRED' satisfies AccountErrorCode);
    const snapshot = await getDoc(doc(this.db, 'users', user.uid));
    const stored = snapshot.data();
    return {
      id: user.uid,
      email: user.email ?? '',
      displayName: (stored?.displayName as string | undefined) ?? user.displayName,
      createdAt: user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : Date.now(),
    };
  }

  async updateProfile(changes: { displayName?: string }): Promise<UserProfile> {
    const userId = this.requireUserId();
    // Only known fields are forwarded. The rules enforce the same allowlist,
    // so a future server-controlled field cannot be set from here even if a
    // caller passes one.
    const permitted: Record<string, unknown> = {};
    for (const field of CLIENT_WRITABLE_PROFILE_FIELDS) {
      if (changes[field] !== undefined) permitted[field] = changes[field];
    }
    try {
      await setDoc(doc(this.db, 'users', userId), permitted, { merge: true });
      return await this.getProfile();
    } catch (cause) {
      throw accountError('PROFILE_UPDATE_FAILED' satisfies AccountErrorCode, cause);
    }
  }

  async beginDeletion(): Promise<void> {
    const userId = this.requireUserId();
    try {
      await setDoc(doc(this.db, `users/${userId}/${DELETION_JOURNAL}`, DELETION_JOURNAL_DOC), {
        startedAt: Date.now(),
      });
    } catch (cause) {
      throw accountError('DATA_DELETION_FAILED' satisfies AccountErrorCode, cause);
    }
  }

  async hasPendingDeletion(): Promise<boolean> {
    const userId = this.requireUserId();
    const snapshot = await getDoc(
      doc(this.db, `users/${userId}/${DELETION_JOURNAL}`, DELETION_JOURNAL_DOC),
    );
    return snapshot.exists();
  }

  /** Deletes every document in a collection, in batches Firestore accepts. */
  private async purgeCollection(path: string): Promise<void> {
    const snapshot = await getDocs(firestoreCollection(this.db, path));
    for (let index = 0; index < snapshot.docs.length; index += 400) {
      const batch = writeBatch(this.db);
      for (const document of snapshot.docs.slice(index, index + 400)) batch.delete(document.ref);
      await batch.commit();
    }
  }

  /** Storage listings are one level deep, so nested prefixes need recursion. */
  private async purgeStoragePrefix(path: string): Promise<void> {
    const listing = await listAll(ref(this.storage, path));
    await Promise.all(listing.items.map((item) => deleteObject(item)));
    for (const prefix of listing.prefixes) {
      await this.purgeStoragePrefix(prefix.fullPath);
    }
  }

  /** Step 3 — encrypted records first, while the account can still authenticate. */
  async deleteUserData(): Promise<void> {
    const userId = this.requireUserId();
    try {
      for (const collection of this.collections) {
        await this.purgeCollection(`users/${userId}/${collection}`);
      }
    } catch (cause) {
      throw accountError('DATA_DELETION_FAILED' satisfies AccountErrorCode, cause);
    }
  }

  /** Step 4 — backups and file storage. */
  async deleteBackups(): Promise<void> {
    const userId = this.requireUserId();
    try {
      await this.purgeCollection(`users/${userId}/backups`);
      await this.purgeStoragePrefix(`users/${userId}/backups`);
    } catch (cause) {
      throw accountError('BACKUP_DELETION_FAILED' satisfies AccountErrorCode, cause);
    }
  }

  /** Step 5 — devices, settings and any other secondary record. */
  async deleteSecondaryRecords(): Promise<void> {
    const userId = this.requireUserId();
    try {
      for (const collection of SECONDARY_COLLECTIONS) {
        await this.purgeCollection(`users/${userId}/${collection}`);
      }
      await deleteDoc(doc(this.db, 'users', userId));
      // The journal goes last: until it is gone, an interrupted deletion is
      // still detectable and can be resumed.
      await this.purgeCollection(`users/${userId}/${DELETION_JOURNAL}`);
    } catch (cause) {
      throw accountError('DATA_DELETION_FAILED' satisfies AccountErrorCode, cause);
    }
  }

  /** Step 6 — the authentication account, only once its data is gone. */
  async deleteAccount(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw accountError('REAUTHENTICATION_REQUIRED' satisfies AccountErrorCode);
    try {
      await deleteUser(user);
    } catch (cause) {
      throw accountError('ACCOUNT_DELETION_FAILED' satisfies AccountErrorCode, cause);
    }
  }

  async exportUserData(): Promise<unknown> {
    const userId = this.requireUserId();
    try {
      const collections: Record<string, unknown[]> = {};
      for (const collection of this.collections) {
        const snapshot = await getDocs(firestoreCollection(this.db, `users/${userId}/${collection}`));
        collections[collection] = snapshot.docs.map((document) => document.data());
      }
      return collections;
    } catch (cause) {
      throw accountError('EXPORT_FAILED' satisfies AccountErrorCode, cause);
    }
  }
}
