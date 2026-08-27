import { useMemo, type ReactNode } from 'react';
import { AuthProvider, useAuth } from '@platform/auth';
import { createPairingSession } from '@platform/security';
import type {
  DataKeyLifecycle,
  PairingRelay,
  PairingRole,
  PairingSession,
  RandomBytes,
  RecordCipher,
} from '@platform/security';
import { ThemeProvider, type ThemePreference } from '@platform/theme';
import { Loading } from '@platform/ui';
import { ServicesProvider, type PlatformServices } from './ServicesProvider';
import { DataKeyGate } from './DataKeyGate';
import { EncryptedRepositoryProvider } from './EncryptedRepositoryProvider';
import type { AppConfig } from './config';

export interface AppCoreProps extends Omit<PlatformServices, 'config'> {
  appName: string;
  collections: readonly string[];
  featureFlags?: Readonly<Record<string, boolean>>;
  initialThemePreference?: ThemePreference;
  onThemePreferenceChange?: (preference: ThemePreference) => void;
  /** Rendered once a user is signed in. */
  children: ReactNode;
  /** Rendered when nobody is signed in — usually the application's auth flow. */
  signedOut: ReactNode;
  /**
   * Builds the data-key lifecycle for a signed-in user. Optional: without it
   * the application renders as before and no key is ever created.
   */
  dataKeyLifecycleFor?: ((userId: string) => DataKeyLifecycle) | undefined;
  /**
   * Encrypts record payloads before they reach the repository. Supplied
   * together with `dataKeyLifecycleFor`; without both, records are stored as
   * the injected repository stores them.
   */
  recordCipher?: RecordCipher | undefined;
  /**
   * The pairing transport. Firestore in production; absent in a preview, and
   * then trusted-device pairing is not offered anywhere in the application.
   *
   * Supplied together with `dataKeyLifecycleFor`, `recordCipher` and
   * `randomBytes`: pairing needs a key to share, a cipher to wrap it with and
   * entropy for the ephemeral key, and offering it without all four would be a
   * button that cannot finish what it starts.
   */
  pairingRelay?: PairingRelay | undefined;
  /** The platform CSPRNG, injected by the entry point as everywhere else. */
  randomBytes?: RandomBytes | undefined;
}

function AuthGate({
  appName,
  children,
  signedOut,
  dataKeyLifecycleFor,
  recordCipher,
  pairingRelay,
  randomBytes,
}: {
  appName: string;
  children: ReactNode;
  signedOut: ReactNode;
  dataKeyLifecycleFor?: ((userId: string) => DataKeyLifecycle) | undefined;
  recordCipher?: RecordCipher | undefined;
  pairingRelay?: PairingRelay | undefined;
  randomBytes?: RandomBytes | undefined;
}) {
  const { user, initializing } = useAuth();
  // Built here rather than in the composition root because the escrow is bound
  // to a specific user: the identity is part of the authenticated data, and it
  // does not exist until somebody has signed in. Memoised on the id so a
  // re-render does not construct a second one.
  const lifecycle = useMemo(
    () => (user && dataKeyLifecycleFor ? dataKeyLifecycleFor(user.id) : null),
    [user?.id, dataKeyLifecycleFor],
  );

  /**
   * The factory the gate uses to open a pairing, or `undefined`.
   *
   * Built here for the same reason the lifecycle is: pairing is bound to the
   * signed-in user, whose identity goes into the transport key's HKDF info and
   * into the verification code. No cryptography happens in this file — the
   * session constructs its own key agreement from the injected entropy.
   */
  const pairingSessionFor = useMemo<((role: PairingRole) => PairingSession) | undefined>(() => {
    if (!user || !lifecycle || !pairingRelay || !recordCipher || !randomBytes) return undefined;
    const userId = user.id;
    return (role) =>
      createPairingSession({
        role,
        relay: pairingRelay,
        lifecycle,
        cipher: recordCipher,
        randomBytes,
        userId,
        appName,
      });
  }, [user?.id, lifecycle, pairingRelay, recordCipher, randomBytes, appName]);

  if (initializing) return <Loading label="Starting" />;
  if (!user) return <>{signedOut}</>;
  if (!lifecycle) return <>{children}</>;
  return (
    <DataKeyGate lifecycle={lifecycle} pairingSessionFor={pairingSessionFor}>
      {recordCipher ? (
        // Inside the key gate: by the time this renders, the lifecycle has
        // reported the key ready, so every repository call below has one.
        <EncryptedRepositoryProvider
          userId={user.id}
          lifecycle={lifecycle}
          cipher={recordCipher}
        >
          {children}
        </EncryptedRepositoryProvider>
      ) : (
        children
      )}
    </DataKeyGate>
  );
}

/**
 * The composition root. Applications wire their concrete services here; no
 * shared component ever constructs one for itself.
 */
export function AppCore({
  appName,
  collections,
  featureFlags,
  initialThemePreference = 'system',
  onThemePreferenceChange,
  children,
  signedOut,
  dataKeyLifecycleFor,
  recordCipher,
  pairingRelay,
  randomBytes,
  ...services
}: AppCoreProps) {
  const config: AppConfig = featureFlags
    ? { appName, collections, featureFlags }
    : { appName, collections };

  return (
    <ThemeProvider
      initialPreference={initialThemePreference}
      {...(onThemePreferenceChange ? { onPreferenceChange: onThemePreferenceChange } : {})}
    >
      <ServicesProvider config={config} {...services}>
        <AuthProvider service={services.authService}>
          <AuthGate
            appName={appName}
            signedOut={signedOut}
            dataKeyLifecycleFor={dataKeyLifecycleFor}
            recordCipher={recordCipher}
            pairingRelay={pairingRelay}
            randomBytes={randomBytes}
          >
            {children}
          </AuthGate>
        </AuthProvider>
      </ServicesProvider>
    </ThemeProvider>
  );
}
