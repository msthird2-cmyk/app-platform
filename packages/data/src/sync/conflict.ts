import type { SyncableRecord } from '../types/record';

export type ConflictResolution<T extends object> =
  | { outcome: 'local'; record: SyncableRecord<T> }
  | { outcome: 'remote'; record: SyncableRecord<T> }
  | { outcome: 'identical'; record: SyncableRecord<T> };

/**
 * Last write wins on `updatedAt`, with `revision` breaking ties and a deletion
 * beating a concurrent edit at an exact tie — a tombstone must never be
 * resurrected by a slower device's stale write.
 *
 * `updatedAt` is compared first, and deliberately so: the remote adapter writes
 * it with the server's clock, which a client cannot forge, whereas `revision`
 * is authored on the device. Trusting the revision first would let one device
 * claim an arbitrarily high number and win every future conflict.
 */
export function resolveConflict<T extends object>(
  local: SyncableRecord<T>,
  remote: SyncableRecord<T>,
): ConflictResolution<T> {
  if (local.updatedAt !== remote.updatedAt) {
    return local.updatedAt > remote.updatedAt
      ? { outcome: 'local', record: local }
      : { outcome: 'remote', record: remote };
  }
  if (local.revision !== remote.revision) {
    return local.revision > remote.revision
      ? { outcome: 'local', record: local }
      : { outcome: 'remote', record: remote };
  }
  const localDeleted = local.deletedAt !== null;
  const remoteDeleted = remote.deletedAt !== null;
  if (localDeleted !== remoteDeleted) {
    return localDeleted
      ? { outcome: 'local', record: local }
      : { outcome: 'remote', record: remote };
  }
  return { outcome: 'identical', record: remote };
}

/** Bumps metadata for a local edit so the result can win a later conflict. */
export function touch<T extends object>(record: SyncableRecord<T>, now: number): SyncableRecord<T> {
  return { ...record, updatedAt: now, revision: record.revision + 1 };
}
