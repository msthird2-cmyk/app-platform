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
import App from './App';
import {
  misconfigurationMessage,
  selectBackend,
  type BackendSelection,
  type Environment,
} from './src/config/backend';
import {
  createPreviewServices,
  createProductionServices,
  type NetWorthServices,
} from './src/composition/services';

/**
 * The entry point, and the only place that decides which backend this build
 * talks to.
 *
 * Two failures are handled here and neither degrades into the other. Secure
 * storage that cannot be built stops the app, because there is nowhere safe to
 * put the data encryption key. Configuration that asks for Firebase and does
 * not supply it also stops the app — it does **not** quietly start the
 * in-memory composition, which would look like a working application while
 * every record went into a process about to exit.
 *
 * `EXPO_PUBLIC_*` is read through `babel-preset-expo`, which inlines the
 * literal at build time. Nothing here reads a secret and nothing is committed:
 * an unconfigured checkout is a preview build, which is the safe default.
 */

/**
 * Read as whole property accesses so the bundler can substitute each literal.
 * `process.env` is not an object at runtime in a React Native bundle, so it
 * cannot be enumerated — every variable has to be named.
 */
function readEnvironment(): Environment {
  return {
    EXPO_PUBLIC_NETWORTH_BACKEND: process.env.EXPO_PUBLIC_NETWORTH_BACKEND,
    EXPO_PUBLIC_FIREBASE_API_KEY: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
      process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    EXPO_PUBLIC_FIREBASE_APP_ID: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  };
}

/**
 * Secure storage is chosen here, at the composition root, and injected — the
 * shared packages never reach for a platform module themselves.
 *
 * `AFTER_FIRST_UNLOCK` rather than the `expo-secure-store` default of
 * `WHEN_UNLOCKED`: the key has to be readable by a background sync running
 * while the screen is locked. There is deliberately no `requireAuthentication`,
 * which would block the JavaScript thread waiting for a user who is not there.
 */
type Custody = {
  secureStorage: SecureStorage;
  /**
   * Stated by the branch that built the storage, not read back off it.
   * Deriving the minimum from whatever turned up would accept any downgrade
   * silently, which is the opposite of what a minimum is for.
   */
  minimumProtection: 'os-keystore' | 'browser-nonextractable';
};

async function buildCustodyStorage(): Promise<Custody> {
  const subtle = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
  if (typeof subtle === 'object' && subtle !== null && typeof indexedDB !== 'undefined') {
    return {
      secureStorage: await createPlatformSecureStorage({
        subtle: subtle as Parameters<typeof createPlatformSecureStorage>[0]['subtle'],
        database: createIndexedDbDatabase(),
        randomBytes: getRandomBytes,
      }),
      // The browser has no OS keystore. Saying so here is the visible,
      // auditable decision the tier system asks for.
      minimumProtection: 'browser-nonextractable',
    };
  }
  const secureStorage = await createPlatformSecureStorage({
    secureStore: SecureStore,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    keychainService: 'networth',
  });
  return { secureStorage, minimumProtection: 'os-keystore' };
}

function Unavailable({ message }: { message: string }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
      <Text>{message}</Text>
    </View>
  );
}

function Root() {
  const [custody, setCustody] = useState<Custody | null>(null);
  const [services, setServices] = useState<NetWorthServices | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const selection: BackendSelection = selectBackend(readEnvironment());
    if (selection.kind === 'misconfigured') {
      // Fails closed. There is deliberately no `else` that reaches for the
      // preview composition.
      setFailure(misconfigurationMessage(selection));
      return () => {
        cancelled = true;
      };
    }

    try {
      setServices(
        selection.kind === 'firebase'
          ? createProductionServices(selection.firebase)
          : createPreviewServices(),
      );
    } catch {
      setFailure('This app could not connect to its backend, so it cannot start.');
      return () => {
        cancelled = true;
      };
    }

    buildCustodyStorage().then(
      (built) => !cancelled && setCustody(built),
      // Fails closed: no in-memory substitute, no plaintext fallback.
      () =>
        !cancelled &&
        setFailure('Secure storage is unavailable on this device, so the app cannot start.'),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (failure) return <Unavailable message={failure} />;
  if (!custody || !services) return <View style={{ flex: 1 }} />;

  return (
    <App
      services={services}
      secureStorage={custody.secureStorage}
      minimumProtection={custody.minimumProtection}
    />
  );
}

registerRootComponent(Root);
