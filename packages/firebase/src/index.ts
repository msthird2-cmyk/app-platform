export {
  createFirebaseApp,
  type FirebaseConfig,
  type AppCheckOptions,
  type CreateFirebaseAppOptions,
} from './app';
export { ServiceError, isServiceError } from './errors';
export { FirebaseAuthService } from './services/FirebaseAuthService';
export { FirebaseRepository } from './services/FirebaseRepository';
export { FirebaseAccountService } from './services/FirebaseAccountService';
export { FirebaseBackupService } from './services/FirebaseBackupService';
export { FirebaseRecoveryEscrowStore } from './services/FirebaseRecoveryEscrowStore';
export {
  AdaptedSecureStorage,
  type AdaptedSecureStorageOptions,
} from './services/FirebaseSecureStorage';
