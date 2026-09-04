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
  /**
   * Subscribes to the signed-in identity, and **must invoke `listener` with the
   * current state once, promptly, after subscribing** — including with `null`
   * when nobody is signed in.
   *
   * Stated because callers depend on it rather than merely benefit from it:
   * this is the only signal that initialisation has finished, so an
   * implementation that stays silent until something changes leaves an
   * application waiting forever. Both implementations here satisfy it —
   * `InMemoryAuthService` calls the listener directly on subscribe, and
   * Firebase's SDK delivers the initial state once persistence is restored.
   */
  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void;
}
