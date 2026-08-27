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
import type { BackupService } from '@platform/backup';
import { ExpensesScreen } from './src/screens/ExpensesScreen';
import { messageForCode } from './src/messages';
import { DEMO_BUDGETS, DEMO_EXPENSES, DEMO_MONTH } from './src/demo';

export const APP_NAME = 'Expense';

export const COLLECTIONS = ['expenses', 'budgets', 'rules'] as const;

export interface ExpenseAppProps {
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
  backupService: BackupService;
  now?: Date;
}

export default function App({
  authService,
  accountService,
  backupService,
  secureStorage,
  now,
  minimumProtection = 'os-keystore',
  escrowStore = new InMemoryRecoveryEscrowStore(),
  pairingRelay,
}: ExpenseAppProps) {
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
      custody: createKeyCustody(secureStorage, { minimumProtection }),
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
      backupService={backupService}
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
        <ExpensesScreen
          expenses={DEMO_EXPENSES}
          budgets={DEMO_BUDGETS}
          month={now ?? DEMO_MONTH}
          onAddSpend={() => undefined}
        />
      </>
    </AppCore>
  );
}
