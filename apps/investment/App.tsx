import { AppCore, PairNewDeviceButton } from '@platform/core';
import { LoginScreen } from '@platform/auth';
import { InMemoryRepository } from '@platform/data';
import { getRandomBytes } from 'expo-crypto';
import {
  createCryptoService,
  createDataKeyLifecycle,
  createKeyCustody,
  createRecordCipher,
  InMemoryRecoveryEscrowStore,
} from '@platform/security';
import type { PairingRelay, RecoveryEscrowStore, SecureStorage } from '@platform/security';
import type { AuthService } from '@platform/auth';
import type { AccountService } from '@platform/account';
import type { BackupTransport } from '@platform/backup';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { messageForCode } from './src/messages';
import { DEMO_HOLDINGS } from './src/demo';

export const APP_NAME = 'Investment';

export const COLLECTIONS = ['holdings', 'transactions', 'prices'] as const;

export interface InvestmentAppProps {
  authService: AuthService;
  secureStorage: SecureStorage;
  /**
   * The tier this application will accept for key custody. Decided by the
   * entry point, which knows which storage it built, rather than inferred from
   * whatever turned up — inferring it would accept a downgrade silently.
   */
  minimumProtection?: 'os-keystore' | 'browser-nonextractable';
  /** Firestore in production; in-memory here, so a preview is self-contained. */
  escrowStore?: RecoveryEscrowStore;
  /**
   * The trusted-device pairing transport. Firestore in production; absent in
   * this preview, and pairing is then not offered anywhere — a second device
   * would use the recovery code instead.
   */
  pairingRelay?: PairingRelay;
  accountService: AccountService;
  backupTransport?: BackupTransport | undefined;
}

export default function App({
  authService,
  accountService,
  backupTransport,
  secureStorage,
  minimumProtection = 'os-keystore',
  escrowStore = new InMemoryRecoveryEscrowStore(),
  pairingRelay,
}: InvestmentAppProps) {
  const cryptoService = createCryptoService({ randomBytes: getRandomBytes });
  // AES-256-GCM directly under the data encryption key. No KDF: the key is
  // already 256 random bits, and stretching it at the shipped 210,000 rounds
  // would add roughly 25 seconds to saving a single record on Android.
  const recordCipher = createRecordCipher({ randomBytes: getRandomBytes });

  /**
   * One lifecycle per signed-in user. The escrow is bound to the user id, so
   * it cannot be built until there is one — `AppCore` calls this inside its
   * auth gate. Custody is Gate 2's; nothing here stores a key itself.
   */
  const dataKeyLifecycleFor = (userId: string) =>
    createDataKeyLifecycle({
      // The owner is what makes this record this user's. Without it two
      // people on one device share a key; see `custodyAddress.ts`.
      custody: createKeyCustody(secureStorage, { owner: userId, minimumProtection }),
      escrowStore,
      crypto: cryptoService,
      context: { userId, appName: APP_NAME },
      randomBytes: getRandomBytes,
    });

  return (
    <AppCore
      appName={APP_NAME}
      collections={COLLECTIONS}
      authService={authService}
      accountService={accountService}
      backupTransport={backupTransport}
      repository={new InMemoryRepository()}
      cryptoService={cryptoService}
      dataKeyLifecycleFor={dataKeyLifecycleFor}
      recordCipher={recordCipher}
      pairingRelay={pairingRelay}
      randomBytes={getRandomBytes}
      secureStorage={secureStorage}
      signedOut={
        <LoginScreen
          messageForCode={messageForCode}
          onForgotPassword={() => undefined}
          onCreateAccount={() => undefined}
        />
      }
    >
      <>
        {/* Renders nothing unless a pairing relay was injected. The trusted
            device is the one that can give a copy of the key to another. */}
        <PairNewDeviceButton />
        <PortfolioScreen
          holdings={DEMO_HOLDINGS}
          onAddHolding={() => undefined}
          onSelectHolding={() => undefined}
        />
      </>
    </AppCore>
  );
}
