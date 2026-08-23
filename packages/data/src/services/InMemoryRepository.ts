import { DataError, DataErrorCode } from '../errors';
import type { QueryOptions, SyncableRecord } from '../types/record';
import type { Repository } from '../types/repository';

export class InMemoryRepository<T extends object = Record<string, unknown>> implements Repository<T> {
  private readonly collections = new Map<string, Map<string, SyncableRecord<T>>>();

  private bucket(collection: string): Map<string, SyncableRecord<T>> {
    let bucket = this.collections.get(collection);
    if (!bucket) {
      bucket = new Map();
      this.collections.set(collection, bucket);
    }
    return bucket;
  }

  async get(collection: string, id: string): Promise<SyncableRecord<T> | null> {
    return this.bucket(collection).get(id) ?? null;
  }

  async list(collection: string, options: QueryOptions = {}): Promise<SyncableRecord<T>[]> {
    let records = [...this.bucket(collection).values()];
    if (!options.includeDeleted) records = records.filter((record) => record.deletedAt === null);
    if (options.updatedAfter !== undefined) {
      records = records.filter((record) => record.updatedAt > options.updatedAfter!);
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    return options.limit ? records.slice(0, options.limit) : records;
  }

  async put(collection: string, record: SyncableRecord<T>): Promise<void> {
    if (!record.id) throw new DataError(DataErrorCode.RECORD_INVALID);
    this.bucket(collection).set(record.id, record);
  }

  async delete(collection: string, id: string, deletedAt: number): Promise<void> {
    const existing = this.bucket(collection).get(id);
    if (!existing) throw new DataError(DataErrorCode.RECORD_NOT_FOUND);
    this.bucket(collection).set(id, { ...existing, deletedAt, revision: existing.revision + 1, updatedAt: deletedAt });
  }

  async purgeAll(): Promise<void> {
    this.collections.clear();
  }
}
