import { CodedError } from '@platform/utils';

export class AuthError extends CodedError {
  readonly domain = 'auth';
}

export const AuthErrorCode = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_IN_USE: 'EMAIL_ALREADY_IN_USE',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  REAUTHENTICATION_REQUIRED: 'REAUTHENTICATION_REQUIRED',
  DEVICE_VERIFICATION_FAILED: 'DEVICE_VERIFICATION_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  SIGN_OUT_FAILED: 'SIGN_OUT_FAILED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_VERIFICATION_FAILED: 'EMAIL_VERIFICATION_FAILED',
  /** Device verification cannot be performed safely without a trusted server. */
  DEVICE_VERIFICATION_UNAVAILABLE: 'DEVICE_VERIFICATION_UNAVAILABLE',
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];
