export { SecurityError, SecurityErrorCode } from './errors';
export type {
  CryptoService,
  EncryptedPayload,
  EncryptionContext,
  SecretHash,
} from './types/crypto';
export type { SecureStorage, BiometricsService } from './types/storage';
export {
  type ProtectionTier,
  type RequiredProtectionTier,
  meetsProtection,
  assertMeetsProtection,
} from './protectionTier';
export {
  type KeyCustody,
  type KeyCustodyStatus,
  type KeyCustodyOptions,
  type CustodyStorage,
  createKeyCustody,
} from './keyCustody';
export {
  OsKeystoreStorage,
  type SecureStoreBackend,
  type SecureStoreItemOptions,
  type OsKeystoreStorageOptions,
} from './services/OsKeystoreStorage';
export {
  createPlatformSecureStorage,
  type PlatformSecureStorageOptions,
} from './services/createSecureStorage';
export {
  WebNonExtractableStorage,
  createIndexedDbDatabase,
  type KeyValueDatabase,
  type SubtleLike,
  type WebNonExtractableStorageOptions,
} from './services/WebNonExtractableStorage';
export { WebCryptoService } from './services/WebCryptoService';
export {
  createCryptoService,
  type CreateCryptoServiceOptions,
} from './services/createCryptoService';
export {
  PortableCryptoService,
  type PortableCryptoOptions,
} from './services/PortableCryptoService';
export { drawRandomBytes, type RandomBytes } from './crypto/entropy';
export {
  MIN_KDF_ITERATIONS,
  MAX_KDF_ITERATIONS,
  DEFAULT_KDF_ITERATIONS,
  isAllowedIterationCount,
  assertAllowedIterationCount,
} from './kdfPolicy';
export { InMemorySecureStorage, UnavailableBiometrics } from './services/InMemorySecureStorage';
export { InMemoryRecoveryEscrowStore } from './services/InMemoryRecoveryEscrowStore';
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
  type RecoveryEscrowEnvelope,
  type RecoverDataKeyOptions,
  RECOVERY_ESCROW_PURPOSE,
  RECOVERY_ESCROW_VERSION,
  assertRecoveryEscrowEnvelope,
  createRecoveryEscrow,
  openRecoveryEscrow,
  recoverDataKey,
  type RecoveryEscrowDocument,
  toRecoveryEscrowDocument,
  fromRecoveryEscrowDocument,
} from './recoveryEscrow';
export {
  type RecoveryEscrowStore,
  type DataKeyState,
  type DataKeyLifecycle,
  type DataKeyLifecycleOptions,
  type FirstTimeSetupResult,
  createDataKeyLifecycle,
} from './dataKeyLifecycle';
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
export {
  type RecordEnvelope,
  type RecordContext,
  RECORD_ENVELOPE_VERSION,
  RECORD_PURPOSE,
  recordAdditionalData,
  assertRecordEnvelope,
} from './recordEnvelope';
export { encryptRecordPayload, decryptRecordPayload } from './recordCrypto';
export type { RecordCipher } from './types/recordCipher';
export { WebRecordCipher } from './services/WebRecordCipher';
export { PortableRecordCipher } from './services/PortableRecordCipher';
export {
  createRecordCipher,
  type CreateRecordCipherOptions,
} from './services/createRecordCipher';
