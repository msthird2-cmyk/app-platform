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
  serverTimestamp,
  where,
  writeBatch,
  Timestamp,
  type DocumentData,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';
import type { FirebaseApp } from 'firebase/app';
import type { QueryOptions, Repository, SyncableRecord, DataErrorCode } from '@platform/data';
import { dataError, isServiceError } from '../errors';

/** Firestore stores instants as Timestamps; the domain works in epoch millis. */
function toMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  return typeof value === 'number' ? value : 0;
}

function optionalMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return toMillis(value);
}

/**
 * Every document lives under `users/{uid}/{collection}` so a user's data can be
 * deleted, exported and secured as one subtree.
 *
 * `updatedAt` and `deletedAt` are written with the server's clock and enforced
 * by the security rules, so a device with a skewed or hostile clock cannot
 * claim a future timestamp and win every subsequent conflict.
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

  private fromFirestore(data: DocumentData): SyncableRecord<T> {
    return {
      ...(data as SyncableRecord<T>),
      updatedAt: toMillis(data.updatedAt),
      deletedAt: optionalMillis(data.deletedAt),
    };
  }

  async get(collection: string, id: string): Promise<SyncableRecord<T> | null> {
    try {
      const snapshot = await getDoc(doc(this.db, this.path(collection), id));
      return snapshot.exists() ? this.fromFirestore(snapshot.data()) : null;
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
      const records = snapshot.docs.map((document) => this.fromFirestore(document.data()));
      return options.includeDeleted ? records : records.filter((record) => record.deletedAt === null);
    } catch (cause) {
      throw dataError('READ_FAILED' satisfies DataErrorCode, cause);
    }
  }

  async put(collection: string, record: SyncableRecord<T>): Promise<SyncableRecord<T>> {
    const reference = doc(this.db, this.path(collection), record.id);
    try {
      // `updatedAt` is never taken from the caller: the rules require it to
      // equal the server's own clock, so a forged value is rejected outright.
      await setDoc(reference, {
        ...record,
        updatedAt: serverTimestamp(),
        ...(record.deletedAt === null ? { deletedAt: null } : { deletedAt: serverTimestamp() }),
      });
    } catch (cause) {
      throw dataError('WRITE_FAILED' satisfies DataErrorCode, cause);
    }
    // Read back what the server stored so the caller converges on its clock.
    const stored = await this.get(collection, record.id);
    if (!stored) throw dataError('WRITE_FAILED' satisfies DataErrorCode);
    return stored;
  }

  /**
   * `deletedAt` is accepted for interface compatibility but deliberately
   * ignored: the tombstone time comes from the server, for the same reason
   * `updatedAt` does, and the rules reject any other value.
   */
  async delete(collection: string, id: string, _deletedAt: number): Promise<void> {
    try {
      const reference = doc(this.db, this.path(collection), id);
      const snapshot = await getDoc(reference);
      if (!snapshot.exists()) throw dataError('RECORD_NOT_FOUND' satisfies DataErrorCode);
      const existing = this.fromFirestore(snapshot.data());
      // Soft delete: the tombstone has to reach every device before it can go.
      // `deletedAt` comes from the server for the same reason `updatedAt` does.
      await setDoc(reference, {
        ...existing,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
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
