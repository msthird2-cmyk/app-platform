import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  reauthenticateWithCredential,
  EmailAuthProvider,
  type Auth,
  type User,
} from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc, type Firestore } from 'firebase/firestore';
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
  private readonly db: Firestore;

  constructor(app: FirebaseApp) {
    this.auth = getAuth(app);
    this.db = getFirestore(app);
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

  async sendDeviceVerification(deviceId: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw authError('USER_NOT_FOUND' satisfies AuthErrorCode);
    try {
      await setDoc(doc(this.db, 'users', user.uid, 'deviceVerifications', deviceId), {
        requestedAt: Date.now(),
        status: 'pending',
      });
    } catch (cause) {
      throw authError('DEVICE_VERIFICATION_FAILED' satisfies AuthErrorCode, cause);
    }
  }

  async confirmDeviceVerification(deviceId: string, code: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) throw authError('USER_NOT_FOUND' satisfies AuthErrorCode);
    const reference = doc(this.db, 'users', user.uid, 'deviceVerifications', deviceId);
    const snapshot = await getDoc(reference);
    const expected = snapshot.data()?.code;
    if (!snapshot.exists() || typeof expected !== 'string' || expected !== code) {
      throw authError('DEVICE_VERIFICATION_FAILED' satisfies AuthErrorCode);
    }
    await setDoc(reference, { status: 'verified', verifiedAt: Date.now() }, { merge: true });
  }

  onAuthStateChanged(listener: (user: AuthUser | null) => void): () => void {
    return onAuthStateChanged(this.auth, (user) => listener(user ? toAuthUser(user) : null));
  }
}
