import { InMemoryAuthService } from '@platform/auth';
import { InMemoryAccountService } from '@platform/account';
import { InMemoryRepository } from '@platform/data';
import { InMemoryRecoveryEscrowStore } from '@platform/security';
import { createFirebaseApp, createFirebaseBackend } from '@platform/firebase';
import type { FirebaseConfig } from '@platform/firebase';
import type { AccountService } from '@platform/account';
import type { AuthService } from '@platform/auth';
import type { BackupTransport } from '@platform/backup';
import type { Repository } from '@platform/data';
import type { PairingRelay, RecoveryEscrowStore } from '@platform/security';
import { COLLECTIONS } from '../collections';

/**
 * The two compositions, side by side and never blended.
 *
 * They are in one file deliberately: the difference between them is the
 * security-relevant fact about a build, and it should be readable in one screen
 * rather than inferred from which of two directories got imported. What they
 * share is the shape — the same six services, injected the same way — so
 * nothing downstream can tell which it received, and nothing downstream should.
 *
 * There is no third option and no path from one to the other. A production
 * build that cannot construct Firebase does not become a preview build; that
 * decision belongs to `selectBackend`, and its failure case is a failure.
 */
export interface NetWorthServices {
  authService: AuthService;
  accountService: AccountService;
  /**
   * Where an exported backup goes. Not part of the backend: a backup never
   * reaches a server, so this comes from the platform rather than from
   * Firebase, and both compositions leave it to the entry point to supply.
   */
  backupTransport?: BackupTransport | undefined;
  repository: Repository;
  escrowStore: RecoveryEscrowStore;
  pairingRelay: PairingRelay | undefined;
  /** Named so a screen, a log line or a bug report can say which this is. */
  backend: 'firebase' | 'preview';
}

/**
 * Production. Every service is Firebase-backed and every path is anchored to
 * `auth.currentUser.uid`, which is the same value the Security Rules check.
 *
 * App Check is explicitly disabled with a stated reason rather than omitted.
 * `createFirebaseApp` requires the decision either way, so shipping without
 * attestation is a recorded choice: on React Native, attestation is provided by
 * the native SDK, and the web SDK's reCAPTCHA providers do not apply. Wiring
 * the native side is separate work and is not in this change.
 */
export function createProductionServices(config: FirebaseConfig): NetWorthServices {
  const app = createFirebaseApp(config, {
    appCheck: {
      provider: 'disabled',
      reason:
        'React Native build: attestation is provided by the native Firebase SDK, not by '
        + "the web SDK's reCAPTCHA providers. Enabling it natively is separate work.",
    },
  });
  const backend = createFirebaseBackend(app, { collections: COLLECTIONS });
  return {
    authService: backend.authService,
    accountService: backend.accountService,
    repository: backend.repository,
    escrowStore: backend.escrowStore,
    pairingRelay: backend.pairingRelay,
    backend: 'firebase',
  };
}

/**
 * Preview. Everything is in this process, so the app runs with no backend and
 * nothing survives a restart.
 *
 * It is not a weaker security posture, it is a different backend: records still
 * pass through `EncryptingRepository`, the key still lives in Gate 2 custody on
 * the real device keystore, and the escrow is still the Gate 3 envelope. What
 * is absent is the network — and pairing, which needs a relay two devices can
 * both reach, so it is not offered here at all.
 */
export function createPreviewServices(): NetWorthServices {
  return {
    authService: new InMemoryAuthService({
      users: [{ email: 'you@example.com', password: 'correct1horse', displayName: 'You' }],
      signedInAs: 'you@example.com',
    }),
    accountService: new InMemoryAccountService({
      profile: { id: 'preview', email: 'you@example.com', displayName: 'You', createdAt: 0 },
    }),
    repository: new InMemoryRepository(),
    escrowStore: new InMemoryRecoveryEscrowStore(),
    pairingRelay: undefined,
    backend: 'preview',
  };
}
