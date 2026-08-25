import { AppCore } from '@platform/core';
import { LoginScreen } from '@platform/auth';
import { InMemoryRepository } from '@platform/data';
import { getRandomBytes } from 'expo-crypto';
import { createCryptoService } from '@platform/security';
import type { SecureStorage } from '@platform/security';
import type { AuthService } from '@platform/auth';
import type { AccountService } from '@platform/account';
import type { BackupService } from '@platform/backup';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { messageForCode } from './src/messages';
import { DEMO_HOLDINGS } from './src/demo';

export const COLLECTIONS = ['holdings', 'transactions', 'prices'] as const;

export interface InvestmentAppProps {
  authService: AuthService;
  secureStorage: SecureStorage;
  accountService: AccountService;
  backupService: BackupService;
}

export default function App({ authService, accountService, backupService, secureStorage }: InvestmentAppProps) {
  return (
    <AppCore
      appName="Investment"
      collections={COLLECTIONS}
      authService={authService}
      accountService={accountService}
      backupService={backupService}
      repository={new InMemoryRepository()}
      cryptoService={createCryptoService({ randomBytes: getRandomBytes })}
      secureStorage={secureStorage}
      signedOut={
        <LoginScreen
          messageForCode={messageForCode}
          onForgotPassword={() => undefined}
          onCreateAccount={() => undefined}
        />
      }
    >
      <PortfolioScreen
        holdings={DEMO_HOLDINGS}
        onAddHolding={() => undefined}
        onSelectHolding={() => undefined}
      />
    </AppCore>
  );
}
