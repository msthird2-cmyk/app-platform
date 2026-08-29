export { DataError, DataErrorCode } from './errors';
export type { RecordMetadata, SyncableRecord, QueryOptions } from './types/record';
export {
  ENCRYPTION_BOUNDARY,
  isEncryptedRepository,
  assertEncryptedRepository,
  type Repository,
  type EncryptedRepository,
} from './types/repository';
export { InMemoryRepository } from './services/InMemoryRepository';
export { resolveConflict, touch, type ConflictResolution } from './sync/conflict';
export { planSync, runSync, type SyncPlan, type SyncResult } from './sync/syncEngine';
export { isSyncableRecord, assertSyncableRecord, createRecord } from './validation';
export {
  EXPORT_SCHEMA_VERSION,
  type ExportBundle,
  type EncryptedExportBundle,
  buildExportBundle,
  encryptExportBundle,
  parseExportBundle,
  decryptExportBundle,
} from './importExport';
export {
  EncryptingRepository,
  ENCRYPTED_FIELD,
  type EncryptingRepositoryOptions,
  type DataKeySource,
} from './services/EncryptingRepository';
