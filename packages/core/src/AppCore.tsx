import { useMemo, type ReactNode } from 'react';
import { AuthProvider, useAuth } from '@platform/auth';
import type { DataKeyLifecycle, RecordCipher } from '@platform/security';
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
}

function AuthGate({
  children,
  signedOut,
  dataKeyLifecycleFor,
  recordCipher,
}: {
  children: ReactNode;
  signedOut: ReactNode;
  dataKeyLifecycleFor?: ((userId: string) => DataKeyLifecycle) | undefined;
  recordCipher?: RecordCipher | undefined;
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

  if (initializing) return <Loading label="Starting" />;
  if (!user) return <>{signedOut}</>;
  if (!lifecycle) return <>{children}</>;
  return (
    <DataKeyGate lifecycle={lifecycle}>
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
            signedOut={signedOut}
            dataKeyLifecycleFor={dataKeyLifecycleFor}
            recordCipher={recordCipher}
          >
            {children}
          </AuthGate>
        </AuthProvider>
      </ServicesProvider>
    </ThemeProvider>
  );
}
