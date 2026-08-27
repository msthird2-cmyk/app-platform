import { SecurityError, SecurityErrorCode } from '../errors';
import type { PairingEnvelope, PairingSessionDocument } from '../pairing';
import type { PairingRelay } from '../pairingSession';

/**
 * A pairing relay that lives in this process, for tests and previews.
 *
 * It is not a shortcut around the Security Rules — it is a restatement of them.
 * Every constraint `firestore.rules` places on `users/{uid}/pairing/{sessionId}`
 * is enforced here too: the identifying fields are immutable, each progressive
 * field may be written once and never changed, an expired session cannot be
 * advanced, and a consumed one is finished. A driver that only worked against a
 * permissive fake would pass its tests and fail against Firestore, which is the
 * failure this class exists to make impossible.
 *
 * It relays a session between two *logical* devices in one process. It is not a
 * way for two real devices to pair, and nothing in `apps/` uses it.
 */
export class InMemoryPairingRelay implements PairingRelay {
  private readonly sessions = new Map<string, PairingSessionDocument>();
  private readonly listeners = new Map<string, Set<(session: unknown | null) => void>>();

  /** Injected so a test can age a session past its expiry. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  private require(sessionId: string): PairingSessionDocument {
    const session = this.sessions.get(sessionId);
    if (!session) throw new SecurityError(SecurityErrorCode.PAIRING_SESSION_INVALID);
    return session;
  }

  /** The `isAdvancingPairing()` preconditions, in the same order. */
  private advancing(sessionId: string): PairingSessionDocument {
    const session = this.require(sessionId);
    if (typeof session.consumedAt === 'number') {
      throw new SecurityError(SecurityErrorCode.PAIRING_STATE_INVALID);
    }
    if (this.now() >= session.expiresAt) {
      throw new SecurityError(SecurityErrorCode.PAIRING_EXPIRED);
    }
    return session;
  }

  private commit(session: PairingSessionDocument): void {
    this.sessions.set(session.id, session);
    for (const listener of this.listeners.get(session.id) ?? []) listener({ ...session });
  }

  async create(session: PairingSessionDocument): Promise<void> {
    if (this.sessions.has(session.id)) {
      throw new SecurityError(SecurityErrorCode.PAIRING_SESSION_INVALID);
    }
    this.commit({ ...session });
  }

  async load(sessionId: string): Promise<unknown | null> {
    const session = this.sessions.get(sessionId);
    return session === undefined ? null : { ...session };
  }

  async accept(sessionId: string, responderPublicKey: string): Promise<void> {
    const session = this.advancing(sessionId);
    // Append-only: absent may become present, present never changes.
    if (
      typeof session.responderPublicKey === 'string' &&
      session.responderPublicKey !== responderPublicKey
    ) {
      throw new SecurityError(SecurityErrorCode.PAIRING_STATE_INVALID);
    }
    this.commit({ ...session, responderPublicKey });
  }

  async reveal(sessionId: string, initiatorPublicKey: string): Promise<void> {
    const session = this.advancing(sessionId);
    if (
      typeof session.initiatorPublicKey === 'string' &&
      session.initiatorPublicKey !== initiatorPublicKey
    ) {
      throw new SecurityError(SecurityErrorCode.PAIRING_STATE_INVALID);
    }
    this.commit({ ...session, initiatorPublicKey });
  }

  async confirm(sessionId: string, wrapped: PairingEnvelope): Promise<void> {
    const session = this.advancing(sessionId);
    if (session.wrapped) throw new SecurityError(SecurityErrorCode.PAIRING_STATE_INVALID);
    this.commit({ ...session, wrapped });
  }

  async consume(sessionId: string): Promise<void> {
    const session = this.advancing(sessionId);
    this.commit({ ...session, consumedAt: this.now() });
  }

  watch(sessionId: string, onChange: (session: unknown | null) => void): () => void {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(onChange);
    this.listeners.set(sessionId, set);
    return () => {
      set.delete(onChange);
    };
  }

  /** Test seam: lets a test corrupt what the relay hands back. */
  overwriteForTest(session: PairingSessionDocument): void {
    this.commit({ ...session });
  }
}
