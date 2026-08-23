import { CodedError } from '@platform/utils';

export class DataError extends CodedError {
  readonly domain = 'data';
}

export const DataErrorCode = {
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
  RECORD_INVALID: 'RECORD_INVALID',
  WRITE_FAILED: 'WRITE_FAILED',
  READ_FAILED: 'READ_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  SYNC_FAILED: 'SYNC_FAILED',
  IMPORT_INVALID: 'IMPORT_INVALID',
  IMPORT_VERSION_UNSUPPORTED: 'IMPORT_VERSION_UNSUPPORTED',
  EXPORT_FAILED: 'EXPORT_FAILED',
} as const;

export type DataErrorCode = (typeof DataErrorCode)[keyof typeof DataErrorCode];
