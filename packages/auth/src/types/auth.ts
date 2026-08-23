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
  /** Re-sends the address verification message for the signed-in account. */
  resendEmailVerification(): Promise<void>;
  /**
   * Device verification requires a server to issue the code and to decide the
   * outcome; a client that can read the expected value, or write the verdict,
   * is not performing a check. Implementations without a trusted server must
   * fail closed with `DEVICE_VERIFICATION_UNAVAILABLE`.
   */
  sendDeviceVerification(deviceId: string): Promise<void>;
  confirmDeviceVerification(deviceId: string, code: string): Promise<void>;
  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void;
}
