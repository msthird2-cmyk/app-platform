import { CodedError } from '@platform/utils';

export class BackupError extends CodedError {
  readonly domain = 'backup';
}

export const BackupErrorCode = {
  BACKUP_FAILED: 'BACKUP_FAILED',
  RESTORE_FAILED: 'RESTORE_FAILED',
  BACKUP_NOT_FOUND: 'BACKUP_NOT_FOUND',
  BACKUP_CORRUPT: 'BACKUP_CORRUPT',
  PASSPHRASE_REQUIRED: 'PASSPHRASE_REQUIRED',
  RESTORE_CONFIRMATION_REQUIRED: 'RESTORE_CONFIRMATION_REQUIRED',
} as const;

export type BackupErrorCode = (typeof BackupErrorCode)[keyof typeof BackupErrorCode];
