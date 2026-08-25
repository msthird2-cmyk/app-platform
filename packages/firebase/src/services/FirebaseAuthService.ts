import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  reauthenticateWithCredential,
  sendEmailVerification,
  EmailAuthProvider,
  type Auth,
  type User,
} from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import type { AuthService, AuthUser, Credentials, AuthErrorCode } from '@platform/auth';
import { authError, type ServiceError } from '../errors';

function toAuthUser(user: User): AuthUser {
  return {
    id: user.uid,
    email: user.email ?? '',
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    createdAt: user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : Date.now(),
  };
}

/** Maps Firebase's string codes onto the platform's typed codes. */
function toAuthError(cause: unknown): ServiceError {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String(cause.code) : '';
  if (code.includes('wrong-password') || code.includes('invalid-credential') || code.includes('user-not-found')) {
    return authError('INVALID_CREDENTIALS' satisfies AuthErrorCode, cause);
  }
  if (code.includes('email-already-in-use')) return authError('EMAIL_ALREADY_IN_USE' satisfies AuthErrorCode, cause);
  if (code.includes('weak-password')) return authError('WEAK_PASSWORD' satisfies AuthErrorCode, cause);
  if (code.includes('requires-recent-login')) {
    return authError('REAUTHENTICATION_REQUIRED' satisfies AuthErrorCode, cause);
  }
  if (code.includes('network')) return authError('NETWORK_ERROR' satisfies AuthErrorCode, cause);
  return authError('INVALID_CREDENTIALS' satisfies AuthErrorCode, cause);
}

export class FirebaseAuthService implements AuthService {
  private readonly auth: Auth;

  constructor(app: FirebaseApp) {
    this.auth = getAuth(app);
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    const user = this.auth.currentUser;
    return user ? toAuthUser(user) : null;
  }

  async signIn({ email, password }: Credentials): Promise<AuthUser> {
    try {
      const credential = await signInWithEmailAndPassword(this.auth, email, password);
      return toAuthUser(credential.user);
    } catch (cause) {
      throw toAuthError(cause);
    }
  }

  async signUp({ email, password }: Credentials, displayName?: string): Promise<AuthUser> {
    try {
      const credential = await createUserWithEmailAndPassword(this.auth, email, password);
      if (displayName) await updateProfile(credential.user, { displayName });
      // Financial writes are gated on a verified address in the security
      // rules, so verification is sent as part of signing up rather than
      // being left to a screen the user might never reach.
      await sendEmailVerification(credential.user);
      return toAuthUser(credential.user);
    } catch (cause) {
      throw toAuthError(cause);
    }
  }

  async signOut(): Promise<void> {
    try {
      await signOut(this.auth);
    } catch (cause) {
      throw authError('SIGN_OUT_FAILED' satisfies AuthErrorCode, cause);
    }
  }

  async sendPasswordReset(email: string): Promise<void> {
    try {
      await sendPasswordResetEmail(this.auth, email);
    } catch (cause) {
      throw toAuthError(cause);
    }
  }

  async reauthenticate(password: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user?.email) throw authError('USER_NOT_FOUND' satisfies AuthErrorCode);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    } catch (cause) {
      throw toAuthError(cause);
    }
  }

  async resendEmailVerification(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw authError('USER_NOT_FOUND' satisfies AuthErrorCode);
    try {
      await sendEmailVerification(user);
    } catch (cause) {
      throw authError('EMAIL_VERIFICATION_FAILED' satisfies AuthErrorCode, cause);
    }
  }

  /**
   * Fails closed, deliberately.
   *
   * The previous implementation wrote a pending document, then had the client
   * read the expected code out of Firestore, compare it locally, and write
   * `status: 'verified'` itself. A client that can read the secret it is being
   * challenged with — and can write the verdict — is not a second factor. The
   * code path is removed rather than left in place, and the Firestore rules
   * close the collection to clients entirely.
   *
   * Restoring this feature requires a trusted server to issue the code and
   * decide the outcome, which the Spark plan does not provide.
   */
  async sendDeviceVerification(_deviceId: string): Promise<void> {
    throw authError('DEVICE_VERIFICATION_UNAVAILABLE' satisfies AuthErrorCode);
  }

  async confirmDeviceVerification(_deviceId: string, _code: string): Promise<void> {
    throw authError('DEVICE_VERIFICATION_UNAVAILABLE' satisfies AuthErrorCode);
  }

  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void {
    return onAuthStateChanged(this.auth, (user) => listener(user ? toAuthUser(user) : null));
  }
}
