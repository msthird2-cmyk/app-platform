import {
  collection as firestoreCollection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit as firestoreLimit,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';
import type { FirebaseApp } from 'firebase/app';
import type { QueryOptions, Repository, SyncableRecord, DataErrorCode } from '@platform/data';
import { dataError, isServiceError } from '../errors';

/**
 * Every document lives under `users/{uid}/{collection}` so a user's data can be
 * deleted, exported and secured as one subtree.
 */
export class FirebaseRepository<T extends object = Record<string, unknown>> implements Repository<T> {
  private readonly db: Firestore;

  constructor(
    app: FirebaseApp,
    private readonly getUserId: () => string | null,
    private readonly collections: readonly string[],
  ) {
    this.db = getFirestore(app);
  }

  private path(collection: string): string {
    const userId = this.getUserId();
    if (!userId) throw dataError('READ_FAILED' satisfies DataErrorCode);
    return `users/${userId}/${collection}`;
  }

  async get(collection: string, id: string): Promise<SyncableRecord<T> | null> {
    try {
      const snapshot = await getDoc(doc(this.db, this.path(collection), id));
      return snapshot.exists() ? (snapshot.data() as SyncableRecord<T>) : null;
    } catch (cause) {
      throw dataError('READ_FAILED' satisfies DataErrorCode, cause);
    }
  }

  async list(collection: string, options: QueryOptions = {}): Promise<SyncableRecord<T>[]> {
    try {
      const constraints: QueryConstraint[] = [orderBy('updatedAt', 'desc')];
      if (options.updatedAfter !== undefined) {
        constraints.unshift(where('updatedAt', '>', options.updatedAfter));
      }
      if (options.limit !== undefined) constraints.push(firestoreLimit(options.limit));
      const snapshot = await getDocs(
        query(firestoreCollection(this.db, this.path(collection)), ...constraints),
      );
      const records = snapshot.docs.map((document) => document.data() as SyncableRecord<T>);
      return options.includeDeleted ? records : records.filter((record) => record.deletedAt === null);
    } catch (cause) {
      throw dataError('READ_FAILED' satisfies DataErrorCode, cause);
    }
  }

  async put(collection: string, record: SyncableRecord<T>): Promise<void> {
    try {
      await setDoc(doc(this.db, this.path(collection), record.id), record);
    } catch (cause) {
      throw dataError('WRITE_FAILED' satisfies DataErrorCode, cause);
    }
  }

  async delete(collection: string, id: string, deletedAt: number): Promise<void> {
    try {
      const reference = doc(this.db, this.path(collection), id);
      const snapshot = await getDoc(reference);
      if (!snapshot.exists()) throw dataError('RECORD_NOT_FOUND' satisfies DataErrorCode);
      const existing = snapshot.data() as SyncableRecord<T>;
      // Soft delete: the tombstone has to reach every device before it can go.
      await setDoc(reference, {
        ...existing,
        deletedAt,
        updatedAt: deletedAt,
        revision: existing.revision + 1,
      });
    } catch (cause) {
      if (isServiceError(cause, 'data')) throw cause;
      throw dataError('DELETE_FAILED' satisfies DataErrorCode, cause);
    }
  }

  async purgeAll(): Promise<void> {
    try {
      for (const collection of this.collections) {
        const snapshot = await getDocs(firestoreCollection(this.db, this.path(collection)));
        // Firestore batches cap at 500 writes.
        for (let index = 0; index < snapshot.docs.length; index += 400) {
          const batch = writeBatch(this.db);
          for (const document of snapshot.docs.slice(index, index + 400)) {
            batch.delete(document.ref);
          }
          await batch.commit();
        }
      }
      const userId = this.getUserId();
      if (userId) await deleteDoc(doc(this.db, 'users', userId));
    } catch (cause) {
      throw dataError('DELETE_FAILED' satisfies DataErrorCode, cause);
    }
  }
}
