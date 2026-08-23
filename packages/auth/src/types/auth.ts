export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: number;
}

export interface Credentials {
  email: string;
  password: string;
}

/**
 * The authentication boundary. `packages/firebase` provides the production
 * implementation; tests and previews inject their own.
 */
export interface AuthService {
  getCurrentUser(): Promise<AuthUser | null>;
  signIn(credentials: Credentials): Promise<AuthUser>;
  signUp(credentials: Credentials, displayName?: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  /** Required before destructive operations such as account deletion. */
  reauthenticate(password: string): Promise<void>;
  sendDeviceVerification(deviceId: string): Promise<void>;
  confirmDeviceVerification(deviceId: string, code: string): Promise<void>;
  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void;
}
