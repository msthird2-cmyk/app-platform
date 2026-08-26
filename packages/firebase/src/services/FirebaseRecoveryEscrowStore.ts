import {
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import type {
  RecoveryEscrowDocument,
  RecoveryEscrowStore,
  SecurityErrorCode,
} from '@platform/security';
import { securityError } from '../errors';

/**
 * The recovery escrow document, in Firestore.
 *
 * What reaches the server is the wrapped key and the parameters needed to open
 * it. The recovery code never comes near this class — it is not a parameter of
 * any method here — and neither does the plaintext key. Both exist only inside
 * `packages/security`, and only for as long as a wrap or an unwrap takes.
 *
 * This is not a second key store. The key itself goes to `KeyCustody` and
 * nowhere else; this holds ciphertext, which is why the owner is allowed to
 * read it at all. See `firestore.rules`, `users/{uid}/recoveryEscrow`.
 */
const COLLECTION = 'recoveryEscrow';

export class FirebaseRecoveryEscrowStore implements RecoveryEscrowStore {
  private readonly db: Firestore;
  private readonly auth: Auth;

  constructor(app: FirebaseApp, private readonly escrowId = 'current') {
    this.db = getFirestore(app);
    this.auth = getAuth(app);
  }

  private path(): string {
    const userId = this.auth.currentUser?.uid;
    // Anchored to the token, never to a value a caller supplied — the same
    // rule the Security Rules enforce on the other side.
    if (!userId) {
      throw securityError('RECOVERY_ESCROW_INVALID' satisfies SecurityErrorCode);
    }
    return `users/${userId}/${COLLECTION}/${this.escrowId}`;
  }

  /**
   * Returns `null` only when there is genuinely no escrow.
   *
   * A read that fails is left to throw. Reporting it as absence would tell the
   * lifecycle that this user never had a recovery path, and first-time setup
   * would then mint a second key for someone who already has one.
   */
  async load(): Promise<unknown | null> {
    const snapshot = await getDoc(doc(this.db, this.path()));
    if (!snapshot.exists()) return null;
    return snapshot.data();
  }

  async save(document: RecoveryEscrowDocument): Promise<void> {
    if (document.id !== this.escrowId) {
      throw securityError('RECOVERY_ESCROW_INVALID' satisfies SecurityErrorCode);
    }
    const reference = doc(this.db, this.path());
    const existing = await getDoc(reference);
    // `createdAt` is immutable in the rules, so an update has to carry the
    // stored value back unchanged; only a first write may set it.
    await setDoc(reference, {
      ...document,
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}
