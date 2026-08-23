import { AppCore } from '@platform/core';
import { LoginScreen } from '@platform/auth';
import { InMemoryRepository } from '@platform/data';
import { InMemorySecureStorage, WebCryptoService } from '@platform/security';
import type { AuthService } from '@platform/auth';
import type { AccountService } from '@platform/account';
import type { BackupService } from '@platform/backup';
import { ExpensesScreen } from './src/screens/ExpensesScreen';
import { messageForCode } from './src/messages';
import { DEMO_BUDGETS, DEMO_EXPENSES, DEMO_MONTH } from './src/demo';

export const COLLECTIONS = ['expenses', 'budgets', 'rules'] as const;

export interface ExpenseAppProps {
  authService: AuthService;
  accountService: AccountService;
  backupService: BackupService;
  now?: Date;
}

export default function App({ authService, accountService, backupService, now }: ExpenseAppProps) {
  return (
    <AppCore
      appName="Expense"
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
      <ExpensesScreen
        expenses={DEMO_EXPENSES}
        budgets={DEMO_BUDGETS}
        month={now ?? DEMO_MONTH}
        onAddSpend={() => undefined}
      />
    </AppCore>
  );
}
