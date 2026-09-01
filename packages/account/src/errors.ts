import { CodedError } from '@platform/utils';

export class AccountError extends CodedError {
  readonly domain = 'account';
}

export const AccountErrorCode = {
  ACCOUNT_DELETION_FAILED: 'ACCOUNT_DELETION_FAILED',
  DATA_DELETION_FAILED: 'DATA_DELETION_FAILED',
  EXPORT_FAILED: 'EXPORT_FAILED',
  PROFILE_UPDATE_FAILED: 'PROFILE_UPDATE_FAILED',
  REAUTHENTICATION_REQUIRED: 'REAUTHENTICATION_REQUIRED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
} as const;

export type AccountErrorCode = (typeof AccountErrorCode)[keyof typeof AccountErrorCode];
