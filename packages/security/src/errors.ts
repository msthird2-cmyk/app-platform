import { CodedError } from '@platform/utils';

export class SecurityError extends CodedError {
  readonly domain = 'security';
}

export const SecurityErrorCode = {
  ENCRYPTION_FAILED: 'ENCRYPTION_FAILED',
  DECRYPTION_FAILED: 'DECRYPTION_FAILED',
  KEY_DERIVATION_FAILED: 'KEY_DERIVATION_FAILED',
  SECURE_STORAGE_UNAVAILABLE: 'SECURE_STORAGE_UNAVAILABLE',
  BIOMETRICS_UNAVAILABLE: 'BIOMETRICS_UNAVAILABLE',
  RECOVERY_CODE_INVALID: 'RECOVERY_CODE_INVALID',
  APP_LOCKED_OUT: 'APP_LOCKED_OUT',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  DEVICE_NOT_REGISTERED: 'DEVICE_NOT_REGISTERED',
  ENCRYPTION_VERSION_UNSUPPORTED: 'ENCRYPTION_VERSION_UNSUPPORTED',
  ENCRYPTION_ALGORITHM_UNSUPPORTED: 'ENCRYPTION_ALGORITHM_UNSUPPORTED',
  ENCRYPTION_PARAMETERS_INVALID: 'ENCRYPTION_PARAMETERS_INVALID',
  RECOVERY_CODE_EXPIRED: 'RECOVERY_CODE_EXPIRED',
  RECOVERY_CODE_ALREADY_USED: 'RECOVERY_CODE_ALREADY_USED',
  PASSPHRASE_TOO_WEAK: 'PASSPHRASE_TOO_WEAK',
  /** An entry exists but cannot be read back — never treat this as "no key". */
  KEY_CUSTODY_UNUSABLE: 'KEY_CUSTODY_UNUSABLE',
  /** The caller offered something that is not a key this system produced. */
  KEY_CUSTODY_INVALID: 'KEY_CUSTODY_INVALID',
  /**
   * Secure storage is reachable, but the way it was asked for cannot be
   * honoured on this platform. Distinct from SECURE_STORAGE_UNAVAILABLE on
   * purpose: reporting a configuration mistake as "unavailable" is what made
   * the Android startup failure this code was added for unreadable.
   */
  SECURE_STORAGE_MISCONFIGURED: 'SECURE_STORAGE_MISCONFIGURED',
  /**
   * The escrow document is not one this system wrote — wrong shape, wrong
   * field types, or a wrapped key of the wrong size once opened. Distinct from
   * a decryption failure, which is what a wrong recovery code produces.
   */
  RECOVERY_ESCROW_INVALID: 'RECOVERY_ESCROW_INVALID',
  /**
   * There is no escrow to open. Recovery stops here; it never proceeds to
   * mint a replacement key, which would orphan every record under the old one.
   */
  RECOVERY_ESCROW_MISSING: 'RECOVERY_ESCROW_MISSING',
} as const;

export type SecurityErrorCode = (typeof SecurityErrorCode)[keyof typeof SecurityErrorCode];
