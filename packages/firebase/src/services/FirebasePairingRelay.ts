import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  Timestamp,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';
import type {
  PairingEnvelope,
  PairingRelay,
  PairingSessionDocument,
  SecurityErrorCode,
} from '@platform/security';
import { securityError } from '../errors';

/**
 * The pairing relay, in Firestore.
 *
 * A relay and nothing more. It carries public keys, a commitment, timestamps
 * and one ciphertext; it holds no secret either device could not compute, and
 * it renders no verdict. There is deliberately no method here that marks a
 * pairing verified, because there is no such field — a verdict a client can
 * write is a verdict an attacker can write, and on Spark there is no server to
 * write one instead.
 *
 * No cryptography lives in this file. It moves documents. Everything that
 * decides whether a pairing is safe happens in `@platform/security`, on both
 * devices, out of this class's reach.
 */
const COLLECTION = 'pairing';

/**
 * Firestore stores instants as Timestamps; `@platform/security` works in epoch
 * milliseconds, and `assertPairingSession` rejects anything else. The server
 * clock is used for the write — a device with a skewed or hostile clock must
 * not be able to claim a session was created earlier or later than it was — so
 * the conversion happens here, on the way back, exactly as FirebaseRepository
 * does for records.
 */
function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  return typeof value === 'number' ? value : null;
}

function fromFirestore(data: DocumentData): unknown {
  return {
    ...data,
    createdAt: toMillis(data.createdAt) ?? 0,
    consumedAt: toMillis(data.consumedAt),
  };
}

/**
 * The port itself lives in `@platform/security`, beside the protocol that uses
 * it, so nothing on the pairing path depends on Firestore. This class is one
 * implementation of it; `InMemoryPairingRelay` is the other.
 */
export class FirebasePairingRelay implements PairingRelay {
  private readonly db: Firestore;
  private readonly auth: Auth;

  constructor(app: FirebaseApp) {
    this.db = getFirestore(app);
    this.auth = getAuth(app);
  }

  private path(sessionId: string): string {
    const userId = this.auth.currentUser?.uid;
    // Anchored to the token, never to a value a caller supplied — the same
    // rule the Security Rules enforce on the other side. Pairing is between
    // two devices of one account; there is no cross-account pairing to support.
    if (!userId) {
      throw securityError('PAIRING_SESSION_INVALID' satisfies SecurityErrorCode);
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) {
      throw securityError('PAIRING_SESSION_INVALID' satisfies SecurityErrorCode);
    }
    return `users/${userId}/${COLLECTION}/${sessionId}`;
  }

  async create(session: PairingSessionDocument): Promise<void> {
    await setDoc(doc(this.db, this.path(session.id)), {
      id: session.id,
      version: session.version,
      appName: session.appName,
      commitment: session.commitment,
      expiresAt: session.expiresAt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  async load(sessionId: string): Promise<unknown | null> {
    const snapshot = await getDoc(doc(this.db, this.path(sessionId)));
    return snapshot.exists() ? fromFirestore(snapshot.data()) : null;
  }

  async accept(sessionId: string, responderPublicKey: string): Promise<void> {
    await updateDoc(doc(this.db, this.path(sessionId)), {
      responderPublicKey,
      updatedAt: serverTimestamp(),
    });
  }

  async reveal(sessionId: string, initiatorPublicKey: string): Promise<void> {
    await updateDoc(doc(this.db, this.path(sessionId)), {
      initiatorPublicKey,
      updatedAt: serverTimestamp(),
    });
  }

  async confirm(sessionId: string, wrapped: PairingEnvelope): Promise<void> {
    await updateDoc(doc(this.db, this.path(sessionId)), {
      wrapped,
      updatedAt: serverTimestamp(),
    });
  }

  async consume(sessionId: string): Promise<void> {
    await updateDoc(doc(this.db, this.path(sessionId)), {
      consumedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  watch(sessionId: string, onChange: (session: unknown | null) => void): () => void {
    return onSnapshot(
      doc(this.db, this.path(sessionId)),
      (snapshot) => onChange(snapshot.exists() ? fromFirestore(snapshot.data()) : null),
      // A dropped listener is not evidence of anything; the caller re-reads.
      () => onChange(null),
    );
  }
}
