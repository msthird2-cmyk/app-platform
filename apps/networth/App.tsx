import { AppCore } from '@platform/core';
import { LoginScreen } from '@platform/auth';
import { InMemoryRepository } from '@platform/data';
import { getRandomBytes } from 'expo-crypto';
import { InMemorySecureStorage, createCryptoService } from '@platform/security';
import type { AuthService } from '@platform/auth';
import type { AccountService } from '@platform/account';
import type { BackupService } from '@platform/backup';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { messageForCode } from './src/messages';
import { DEMO_ASSETS, DEMO_LIABILITIES, DEMO_PREVIOUS_NET_WORTH } from './src/demo';

export const COLLECTIONS = ['assets', 'liabilities', 'snapshots'] as const;

export interface NetWorthAppProps {
  authService: AuthService;
  accountService: AccountService;
  backupService: BackupService;
}

/**
 * Composition root for Net Worth. Concrete services are injected here — the
 * production entry point passes the Firebase implementations.
 */
export default function App({ authService, accountService, backupService }: NetWorthAppProps) {
  return (
    <AppCore
      appName="Net Worth"
      collections={COLLECTIONS}
      authService={authService}
      accountService={accountService}
      backupService={backupService}
      repository={new InMemoryRepository()}
      cryptoService={createCryptoService({ randomBytes: getRandomBytes })}
      secureStorage={new InMemorySecureStorage()}
      signedOut={
        <LoginScreen
          messageForCode={messageForCode}
          onForgotPassword={() => undefined}
          onCreateAccount={() => undefined}
        />
      }
    >
      <DashboardScreen
        assets={DEMO_ASSETS}
        liabilities={DEMO_LIABILITIES}
        previousNetWorth={DEMO_PREVIOUS_NET_WORTH}
        onAddAsset={() => undefined}
      />
    </AppCore>
  );
}
