export {
  createFirebaseApp,
  type FirebaseConfig,
  type AppCheckOptions,
  type CreateFirebaseAppOptions,
} from './app';
export { ServiceError, isServiceError } from './errors';
export {
  createFirebaseBackend,
  type FirebaseBackend,
  type FirebaseBackendOptions,
} from './composition';
export { FirebaseAuthService } from './services/FirebaseAuthService';
export { FirebaseRepository } from './services/FirebaseRepository';
export { FirebaseAccountService } from './services/FirebaseAccountService';
export { FirebaseRecoveryEscrowStore } from './services/FirebaseRecoveryEscrowStore';
export { FirebasePairingRelay } from './services/FirebasePairingRelay';
export {
  AdaptedSecureStorage,
  type AdaptedSecureStorageOptions,
} from './services/FirebaseSecureStorage';
