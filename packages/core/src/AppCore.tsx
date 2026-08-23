import { type ReactNode } from 'react';
import { AuthProvider, useAuth } from '@platform/auth';
import { ThemeProvider, type ThemePreference } from '@platform/theme';
import { Loading } from '@platform/ui';
import { ServicesProvider, type PlatformServices } from './ServicesProvider';
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
}

function AuthGate({ children, signedOut }: { children: ReactNode; signedOut: ReactNode }) {
  const { user, initializing } = useAuth();
  if (initializing) return <Loading label="Starting" />;
  return <>{user ? children : signedOut}</>;
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
          <AuthGate signedOut={signedOut}>{children}</AuthGate>
        </AuthProvider>
      </ServicesProvider>
    </ThemeProvider>
  );
}
