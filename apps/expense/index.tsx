import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { registerRootComponent } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import {
  createIndexedDbDatabase,
  createPlatformSecureStorage,
  type SecureStorage,
} from '@platform/security';
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

/**
 * Secure storage is chosen here, at the composition root, and injected — the
 * shared packages never reach for a platform module themselves.
 *
 * `AFTER_FIRST_UNLOCK` rather than the `expo-secure-store` default of
 * `WHEN_UNLOCKED`: the key has to be readable by a background sync running
 * while the screen is locked. There is deliberately no `requireAuthentication`,
 * which would block the JavaScript thread waiting for a user who is not there.
 */
function buildSecureStorage(): Promise<SecureStorage> {
  const subtle = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
  if (typeof subtle === 'object' && subtle !== null && typeof indexedDB !== 'undefined') {
    return createPlatformSecureStorage({
      subtle: subtle as Parameters<typeof createPlatformSecureStorage>[0]['subtle'],
      database: createIndexedDbDatabase(),
      randomBytes: getRandomBytes,
    });
  }
  return createPlatformSecureStorage({
    secureStore: SecureStore,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    keychainService: 'expense',
  });
}

function Root() {
  const [secureStorage, setSecureStorage] = useState<SecureStorage | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildSecureStorage().then(
      (storage) => !cancelled && setSecureStorage(storage),
      // Fails closed: no in-memory substitute, no plaintext fallback.
      (error: unknown) => !cancelled && setFailure(String(error)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (failure) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text>Secure storage is unavailable on this device, so the app cannot start.</Text>
      </View>
    );
  }
  if (!secureStorage) return <View style={{ flex: 1 }} />;

  return (
    <App
      authService={authService}
      accountService={accountService}
      backupService={backupService}
      secureStorage={secureStorage}
    />
  );
}

registerRootComponent(Root);
