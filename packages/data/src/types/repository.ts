import type { QueryOptions, SyncableRecord } from './record';

/**
 * The persistence boundary. Applications inject a concrete implementation
 * (Firestore in production, in-memory in tests) — no component ever knows
 * which one it is talking to.
 */
export interface Repository<T extends object = Record<string, unknown>> {
  get(collection: string, id: string): Promise<SyncableRecord<T> | null>;
  list(collection: string, options?: QueryOptions): Promise<SyncableRecord<T>[]>;
  put(collection: string, record: SyncableRecord<T>): Promise<void>;
  delete(collection: string, id: string, deletedAt: number): Promise<void>;
  /** Hard-removes every record the signed-in user owns. */
  purgeAll(): Promise<void>;
}
