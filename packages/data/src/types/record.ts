/**
 * Every synchronizable record carries the metadata the sync engine needs.
 * Application-specific fields live in the generic payload.
 */
export interface RecordMetadata {
  id: string;
  /** Epoch milliseconds of the last local or remote write. */
  updatedAt: number;
  /** Monotonic per-record counter, used to break `updatedAt` ties. */
  revision: number;
  /** Soft delete: tombstones must sync before they can be dropped. */
  deletedAt: number | null;
}

export type SyncableRecord<T extends object = Record<string, unknown>> = RecordMetadata & T;

export interface QueryOptions {
  includeDeleted?: boolean;
  updatedAfter?: number;
  limit?: number;
}
