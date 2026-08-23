import { registerRootComponent } from 'expo';
import { InMemoryAuthService } from '@platform/auth';
import { InMemoryAccountService } from '@platform/account';
import { InMemoryBackupService } from '@platform/backup';
import App from './App';

/**
 * Preview entry point: every service is in-memory, so the app runs with no
 * backend. A production entry point constructs the Firebase implementations
 * from `@platform/firebase` and injects them exactly the same way.
 */
const authService = new InMemoryAuthService({
  users: [{ email: 'you@example.com', password: 'correct1horse', displayName: 'You' }],
  signedInAs: 'you@example.com',
});

const accountService = new InMemoryAccountService({
  profile: { id: 'preview', email: 'you@example.com', displayName: 'You', createdAt: 0 },
});

const backupService = new InMemoryBackupService();

function Root() {
  return <App authService={authService} accountService={accountService} backupService={backupService} />;
}

registerRootComponent(Root);
