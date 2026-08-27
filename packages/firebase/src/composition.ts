import type { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import type { AccountService } from '@platform/account';
import type { AuthService } from '@platform/auth';
import type { BackupService } from '@platform/backup';
import type { Repository } from '@platform/data';
import type { PairingRelay, RecoveryEscrowStore } from '@platform/security';
import { FirebaseAccountService } from './services/FirebaseAccountService';
import { FirebaseAuthService } from './services/FirebaseAuthService';
import { FirebaseBackupService } from './services/FirebaseBackupService';
import { FirebasePairingRelay } from './services/FirebasePairingRelay';
import { FirebaseRecoveryEscrowStore } from './services/FirebaseRecoveryEscrowStore';
import { FirebaseRepository } from './services/FirebaseRepository';

/**
 * The Firebase services, built together.
 *
 * **What this is, and what it deliberately is not.** It is not a production
 * entry point. Nothing in `apps/` calls it, and adding it does not make any
 * application talk to Firestore: each application's `index.tsx` still wires the
 * in-memory services, and switching one over is an application-level decision
 * with its own configuration, App Check posture and release.
 *
 * What it is is the smallest thing that removes the reason there was no
 * production wiring: six services that all need the same `FirebaseApp` and the
 * same user id, constructed consistently in one audited place instead of six
 * times in three applications. A production entry point becomes
 *
 * ```ts
 * const backend = createFirebaseBackend(createFirebaseApp(config, { appCheck }), {
 *   collections: COLLECTIONS,
 * });
 * <App {...backend} secureStorage={...} minimumProtection="os-keystore" />
 * ```
 *
 * and the applications already accept exactly those props.
 *
 * The user id is read from Firebase Auth at call time rather than passed in:
 * every one of these services anchors its paths to `auth.currentUser.uid`, which
 * is the same value the Security Rules check, and taking it as an argument would
 * invite a caller to supply a different one.
 */
export interface FirebaseBackendOptions {
  /** The collections this application is allowed to touch. */
  collections: readonly string[];
  /** Document id for the recovery escrow. One per user. */
  escrowId?: string;
}

export interface FirebaseBackend {
  authService: AuthService;
  accountService: AccountService;
  backupService: BackupService;
  repository: Repository;
  escrowStore: RecoveryEscrowStore;
  /**
   * The pairing transport. Passing this to `AppCore` is what makes
   * trusted-device pairing available; without it the flow is not offered.
   */
  pairingRelay: PairingRelay;
}

export function createFirebaseBackend(
  app: FirebaseApp,
  options: FirebaseBackendOptions,
): FirebaseBackend {
  const auth = getAuth(app);
  return {
    authService: new FirebaseAuthService(app),
    accountService: new FirebaseAccountService(app, options.collections),
    backupService: new FirebaseBackupService(app),
    repository: new FirebaseRepository(
      app,
      // Read per call, off the token the rules will check — never off a value
      // a caller passed in.
      () => auth.currentUser?.uid ?? null,
      options.collections,
    ),
    escrowStore:
      options.escrowId === undefined
        ? new FirebaseRecoveryEscrowStore(app)
        : new FirebaseRecoveryEscrowStore(app, options.escrowId),
    pairingRelay: new FirebasePairingRelay(app),
  };
}
