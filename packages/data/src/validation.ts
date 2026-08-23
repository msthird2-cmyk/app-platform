import { DataError, DataErrorCode } from './errors';
import type { SyncableRecord } from './types/record';

export function isSyncableRecord(value: unknown): value is SyncableRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<SyncableRecord>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.updatedAt === 'number' &&
    typeof record.revision === 'number' &&
    (record.deletedAt === null || typeof record.deletedAt === 'number')
  );
}

export function assertSyncableRecord(value: unknown): SyncableRecord {
  if (!isSyncableRecord(value)) throw new DataError(DataErrorCode.RECORD_INVALID);
  return value;
}

export function createRecord<T extends object>(id: string, payload: T, now: number): SyncableRecord<T> {
  return { id, updatedAt: now, revision: 1, deletedAt: null, ...payload };
}
