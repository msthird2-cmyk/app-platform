import { AppCore } from '@platform/core';
import { LoginScreen } from '@platform/auth';
import { InMemoryRepository } from '@platform/data';
import { InMemorySecureStorage, WebCryptoService } from '@platform/security';
import type { AuthService } from '@platform/auth';
import type { AccountService } from '@platform/account';
import type { BackupService } from '@platform/backup';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { messageForCode } from './src/messages';

export const COLLECTIONS = ['holdings', 'transactions', 'prices'] as const;

export interface InvestmentAppProps {
  authService: AuthService;
  accountService: AccountService;
  backupService: BackupService;
}

export default function App({ authService, accountService, backupService }: InvestmentAppProps) {
  return (
    <AppCore
      appName="Investment"
      collections={COLLECTIONS}
      authService={authService}
      accountService={accountService}
      backupService={backupService}
      repository={new InMemoryRepository()}
      cryptoService={new WebCryptoService()}
      secureStorage={new InMemorySecureStorage()}
      signedOut={
        <LoginScreen
          messageForCode={messageForCode}
          onForgotPassword={() => undefined}
          onCreateAccount={() => undefined}
        />
      }
    >
      <PortfolioScreen holdings={[]} onAddHolding={() => undefined} onSelectHolding={() => undefined} />
    </AppCore>
  );
}
