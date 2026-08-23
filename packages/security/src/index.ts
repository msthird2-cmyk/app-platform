export { SecurityError, SecurityErrorCode } from './errors';
export type {
  CryptoService,
  EncryptedPayload,
  EncryptionContext,
  SecretHash,
} from './types/crypto';
export type { SecureStorage, BiometricsService } from './types/storage';
export { WebCryptoService } from './services/WebCryptoService';
export { InMemorySecureStorage, UnavailableBiometrics } from './services/InMemorySecureStorage';
export {
  type RecoveryCodeRecord,
  type HashRecoveryCodesOptions,
  type VerifyRecoveryCodeResult,
  RECOVERY_CODE_ENTROPY_BITS,
  DEFAULT_RECOVERY_CODE_LIFETIME_MS,
  generateRecoveryCode,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCodes,
  verifyRecoveryCode,
  remainingRecoveryCodes,
} from './recoveryCodes';
export {
  type PassphrasePolicy,
  type PassphraseIssue,
  type PassphraseAssessment,
  DEFAULT_PASSPHRASE_POLICY,
  assessPassphrase,
  assertStrongPassphrase,
} from './passphrase';
export {
  type AppLockPolicy,
  type AppLockState,
  DEFAULT_APP_LOCK_POLICY,
  initialAppLockState,
  isLockedOut,
  shouldAutoLock,
  registerFailedAttempt,
  registerSuccess,
  assertUnlockable,
} from './appLock';
export {
  type SessionTokens,
  type SessionState,
  type SessionStore,
  REFRESH_SKEW_MS,
  isExpired,
  needsRefresh,
  msUntilRefresh,
  assertActive,
  createSessionStore,
} from './session';
export {
  type RegisteredDevice,
  type DeviceRegistry,
  getOrCreateDeviceId,
  assertRegistered,
} from './deviceRegistration';
