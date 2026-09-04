import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { observeAuthSession } from './authSession';
import type { AuthService, AuthUser, Credentials } from './types/auth';

export interface AuthContextValue {
  user: AuthUser | null;
  initializing: boolean;
  signIn: (credentials: Credentials) => Promise<void>;
  signUp: (credentials: Credentials, displayName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  service: AuthService;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  service: AuthService;
  children: ReactNode;
}

export function AuthProvider({ service, children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => observeAuthSession(service, { setUser, setInitializing }), [service]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      service,
      signIn: async (credentials) => {
        setUser(await service.signIn(credentials));
      },
      signUp: async (credentials, displayName) => {
        setUser(await service.signUp(credentials, displayName));
      },
      signOut: async () => {
        await service.signOut();
        setUser(null);
      },
    }),
    [user, initializing, service],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AUTH_PROVIDER_MISSING');
  return context;
}
