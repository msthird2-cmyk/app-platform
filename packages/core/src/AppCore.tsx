import { useMemo, type ReactNode } from 'react';
import { AuthProvider, useAuth } from '@platform/auth';
import type { DataKeyLifecycle } from '@platform/security';
import { ThemeProvider, type ThemePreference } from '@platform/theme';
import { Loading } from '@platform/ui';
import { ServicesProvider, type PlatformServices } from './ServicesProvider';
import { DataKeyGate } from './DataKeyGate';
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
}

function AuthGate({
  children,
  signedOut,
  dataKeyLifecycleFor,
}: {
  children: ReactNode;
  signedOut: ReactNode;
  dataKeyLifecycleFor?: ((userId: string) => DataKeyLifecycle) | undefined;
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
  return <DataKeyGate lifecycle={lifecycle}>{children}</DataKeyGate>;
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
          <AuthGate signedOut={signedOut} dataKeyLifecycleFor={dataKeyLifecycleFor}>
            {children}
          </AuthGate>
        </AuthProvider>
      </ServicesProvider>
    </ThemeProvider>
  );
}
