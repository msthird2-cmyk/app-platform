import { createId } from '@platform/utils';
import { AuthError, AuthErrorCode } from '../errors';
import type { AuthService, AuthUser, Credentials } from '../types/auth';

export interface InMemoryAuthOptions {
  /** Seed accounts so a preview can sign in without a backend. */
  users?: ReadonlyArray<{ email: string; password: string; displayName?: string }>;
  /** Start already signed in as this email. */
  signedInAs?: string;
  /** The code `confirmDeviceVerification` will accept. */
  deviceVerificationCode?: string;
}

interface StoredUser extends AuthUser {
  password: string;
}

/**
 * A working AuthService with no backend, for previews and tests. It has the
 * same shape as the Firebase implementation, so a screen cannot tell them apart.
 */
export class InMemoryAuthService implements AuthService {
  private readonly users = new Map<string, StoredUser>();
  private readonly listeners = new Set<(user: AuthUser | null) => void>();
  private readonly verifications = new Map<string, string>();
  private current: AuthUser | null = null;
  private readonly code: string;
  /** Counted so tests can assert a verification message was sent. */
  verificationsSent = 0;

  constructor(options: InMemoryAuthOptions = {}) {
    this.code = options.deviceVerificationCode ?? '000000';
    for (const seed of options.users ?? []) {
      const email = seed.email.toLowerCase();
      this.users.set(email, {
        id: createId(12),
        email,
        displayName: seed.displayName ?? null,
        emailVerified: true,
        createdAt: 0,
        password: seed.password,
      });
    }
    if (options.signedInAs) {
      const user = this.users.get(options.signedInAs.toLowerCase());
      if (user) this.current = this.publicView(user);
    }
  }

  private publicView({ password: _password, ...user }: StoredUser): AuthUser {
    return user;
  }

  private emit(user: AuthUser | null): void {
    this.current = user;
    for (const listener of this.listeners) listener(user);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.current;
  }

  async signIn({ email, password }: Credentials): Promise<AuthUser> {
    const stored = this.users.get(email.toLowerCase());
    if (!stored || stored.password !== password) {
      throw new AuthError(AuthErrorCode.INVALID_CREDENTIALS);
    }
    const user = this.publicView(stored);
    this.emit(user);
    return user;
  }

  async signUp({ email, password }: Credentials, displayName?: string): Promise<AuthUser> {
    const key = email.toLowerCase();
    if (this.users.has(key)) throw new AuthError(AuthErrorCode.EMAIL_ALREADY_IN_USE);
    const stored: StoredUser = {
      id: createId(12),
      email: key,
      displayName: displayName ?? null,
      emailVerified: false,
      createdAt: 0,
      password,
    };
    this.users.set(key, stored);
    this.verificationsSent += 1;
    const user = this.publicView(stored);
    this.emit(user);
    return user;
  }

  async signOut(): Promise<void> {
    this.emit(null);
  }

  async sendPasswordReset(email: string): Promise<void> {
    if (!this.users.has(email.toLowerCase())) throw new AuthError(AuthErrorCode.USER_NOT_FOUND);
  }

  async resendEmailVerification(): Promise<void> {
    if (!this.current) throw new AuthError(AuthErrorCode.USER_NOT_FOUND);
    this.verificationsSent += 1;
  }

  async reauthenticate(password: string): Promise<void> {
    if (!this.current) throw new AuthError(AuthErrorCode.USER_NOT_FOUND);
    const stored = this.users.get(this.current.email);
    if (!stored || stored.password !== password) {
      throw new AuthError(AuthErrorCode.INVALID_CREDENTIALS);
    }
  }

  async sendDeviceVerification(deviceId: string): Promise<void> {
    this.verifications.set(deviceId, this.code);
  }

  async confirmDeviceVerification(deviceId: string, code: string): Promise<void> {
    const expected = this.verifications.get(deviceId);
    if (!expected || expected !== code) throw new AuthError(AuthErrorCode.DEVICE_VERIFICATION_FAILED);
  }

  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => void this.listeners.delete(listener);
  }
}
