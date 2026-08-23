import type { QueryOptions, SyncableRecord } from './record';

/**
 * The persistence boundary. Applications inject a concrete implementation
 * (Firestore in production, in-memory in tests) — no component ever knows
 * which one it is talking to.
 */
export interface Repository<T extends object = Record<string, unknown>> {
  get(collection: string, id: string): Promise<SyncableRecord<T> | null>;
  list(collection: string, options?: QueryOptions): Promise<SyncableRecord<T>[]>;
  /**
   * Writes a record and returns it as stored. A remote implementation stamps
   * `updatedAt` with the server clock, so the caller must use the returned
   * record rather than the one it sent, or the two copies never converge.
   */
  put(collection: string, record: SyncableRecord<T>): Promise<SyncableRecord<T>>;
  delete(collection: string, id: string, deletedAt: number): Promise<void>;
  /** Hard-removes every record the signed-in user owns. */
  purgeAll(): Promise<void>;
}
