import { drawRandomBytes, type RandomBytes } from './crypto/entropy';
import { SecurityError, SecurityErrorCode } from './errors';
import type { KeyCustody } from './keyCustody';
import {
  completePairing,
  wrapDataKeyForPairing,
  type PairingContext,
  type PairingEnvelope,
} from './pairing';
import { generateRecoveryCode } from './recoveryCodes';
import {
  createRecoveryEscrow,
  fromRecoveryEscrowDocument,
  recoverDataKey,
  toRecoveryEscrowDocument,
  type RecoveryEscrowDocument,
} from './recoveryEscrow';
import type { CryptoService, EncryptionContext } from './types/crypto';
import type { RecordCipher } from './types/recordCipher';

/**
 * The data encryption key across an application's lifetime.
 *
 * Gate 2 gave the key somewhere safe to live and Gate 3 gave it a way back
 * from a recovery code. Neither decides *when* either happens; this does, and
 * it is the only place that creates a key.
 *
 * It owns no storage of its own. The key goes to `KeyCustody` and nowhere else,
 * the escrow goes to an injected `RecoveryEscrowStore`, and the cryptography is
 * the Gate 3 implementation called rather than reimplemented. What is added
 * here is sequencing and the refusals that go with it.
 */

/** The escrow document's home. Firestore in production; see `packages/firebase`. */
export interface RecoveryEscrowStore {
  /** The stored document, or `null` when the user has no escrow at all. */
  load(): Promise<unknown | null>;
  save(document: RecoveryEscrowDocument): Promise<void>;
}

/**
 * What the application should do next, decided by looking rather than guessing.
 *
 * `unusable` is deliberately not merged into `needs-setup`. A key that exists
 * and cannot be read is the case where creating a new one destroys data, so it
 * gets its own state and no automatic action — exactly the distinction
 * `KeyCustody` exists to preserve, carried up to where the decision is made.
 */
export type DataKeyState = 'ready' | 'needs-setup' | 'needs-recovery' | 'unusable';

export interface DataKeyLifecycleOptions {
  custody: KeyCustody;
  escrowStore: RecoveryEscrowStore;
  crypto: CryptoService;
  /** Binds the escrow to this user and application. */
  context: EncryptionContext;
  /** The platform CSPRNG, injected exactly as everywhere else in this package. */
  randomBytes: RandomBytes;
  /** Document id for the escrow. One escrow, replaced when re-issued. */
  escrowId?: string;
}

export interface FirstTimeSetupResult {
  /**
   * Shown to the user once and never stored. This is the only moment it
   * exists outside their hands: it is not persisted here, not written to the
   * escrow, and not recoverable if they lose it.
   */
  recoveryCode: string;
}

/**
 * What the trusted device needs to hand its key to a new one: a transport key
 * both devices derived, and the identity that key is bound to.
 *
 * The cipher arrives per call rather than at construction because it is the
 * record cipher the application already built, and the lifecycle has no use for
 * one otherwise.
 */
export interface PairingExportOptions {
  transportKey: Uint8Array;
  context: PairingContext;
  cipher: RecordCipher;
}

export interface PairingAdoptOptions {
  /** The relay's snapshot, carrying the wrapped key. */
  session: unknown;
  transportKey: Uint8Array;
  context: PairingContext;
  cipher: RecordCipher;
  now: number;
}

export interface DataKeyLifecycle {
  status(): Promise<DataKeyState>;
  /** The key from custody, or `null` when there is none. Never creates one. */
  load(): Promise<Uint8Array | null>;
  /** First-time setup. Refuses when a key already exists. */
  initialize(): Promise<FirstTimeSetupResult>;
  /** Zero-trusted-device recovery. Refuses when a usable key already exists. */
  recover(recoveryCode: string): Promise<Uint8Array>;
  /**
   * Wraps the key this device already holds, for a paired device.
   *
   * Refuses unless a key is actually in custody. There is no branch here that
   * creates one: a device with nothing to share has nothing to share, and
   * generating a key at this moment would mint a second one for a user who
   * already has records under the first.
   */
  exportForPairing(options: PairingExportOptions): Promise<PairingEnvelope>;
  /**
   * Opens a key wrapped by a trusted device and takes custody of it.
   *
   * Refuses when this device already holds a key, and refuses when it holds one
   * it cannot read — the second case is the one `completePairing` alone does not
   * cover, and treating it as "no key" would write over an unreadable key and
   * orphan every record encrypted under it.
   */
  adoptPairedKey(options: PairingAdoptOptions): Promise<Uint8Array>;
}

const DEFAULT_ESCROW_ID = 'current';

/** AES-256, matching `keyCustody` and `recoveryEscrow`. */
const DEK_BYTES = 32;

export function createDataKeyLifecycle(
  options: DataKeyLifecycleOptions,
): DataKeyLifecycle {
  const { custody, escrowStore, crypto, context, randomBytes } = options;
  const escrowId = options.escrowId ?? DEFAULT_ESCROW_ID;

  async function loadEscrow(): Promise<unknown | null> {
    const stored = await escrowStore.load();
    if (stored === null || stored === undefined) return null;
    // Rebuilt here rather than passed through raw, so a document that is not
    // ours is rejected before a key derivation is paid for.
    return fromRecoveryEscrowDocument(stored);
  }

  return {
    async status() {
      const custodyStatus = await custody.status();
      if (custodyStatus === 'present') return 'ready';
      // Never proceeds past this. Something is stored and cannot be read, and
      // both of the other branches would end in a new key over the top of it.
      if (custodyStatus === 'unusable') return 'unusable';

      let escrow: unknown | null;
      try {
        escrow = await escrowStore.load();
      } catch {
        // The escrow is unreachable, not absent. Offering first-time setup here
        // would mint a second key for a user who already has one.
        return 'unusable';
      }
      return escrow === null || escrow === undefined ? 'needs-setup' : 'needs-recovery';
    },

    async load() {
      return custody.load();
    },

    /**
     * Generate, escrow, then take custody — in that order, deliberately.
     *
     * The order is the one part of this that is not obvious, and the stated
     * lifecycle reads the other way round. Consider each failure:
     *
     * Custody first, escrow second. If the escrow write fails, the user has a
     * working key and no way back. Worse, the next startup sees custody
     * `present`, reports `ready`, and never returns here — so the gap is
     * permanent and silent, and it cannot be repaired later because repairing
     * it needs the recovery code, which was never stored.
     *
     * Escrow first, custody second. If the custody write fails, nothing is
     * lost: the next startup sees custody `absent` with an escrow present,
     * reports `needs-recovery`, and the user finishes with the code they were
     * just shown.
     *
     * One order can strand a user with no recovery path forever; the other
     * ends in a state the system already knows how to resolve.
     */
    async initialize() {
      const state = await this.status();
      if (state !== 'needs-setup') {
        // Requirement, stated plainly: an existing key is never replaced, and
        // an unreadable one is never written over.
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_INVALID);
      }

      const dataKey = drawRandomBytes(randomBytes, DEK_BYTES);
      const recoveryCode = generateRecoveryCode(randomBytes);

      const envelope = await createRecoveryEscrow(dataKey, recoveryCode, crypto, context);
      await escrowStore.save(toRecoveryEscrowDocument(escrowId, envelope));
      await custody.store(dataKey);

      return { recoveryCode };
    },

    /**
     * Idempotent by construction: recovering again with the same code unwraps
     * the same key and writes the same bytes. Recovering while a *usable* key
     * is already held is refused instead — that is not recovery, and quietly
     * replacing a working key is the one thing this module must never do.
     */
    async recover(recoveryCode: string) {
      if ((await custody.status()) === 'present') {
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_INVALID);
      }
      // `null` here reaches `recoverDataKey`, which raises
      // RECOVERY_ESCROW_MISSING rather than falling through to key creation.
      const escrow = await loadEscrow();
      return recoverDataKey({ escrow, recoveryCode, crypto, context, custody });
    },

    async exportForPairing({ transportKey, context: pairingContext, cipher }) {
      const custodyStatus = await custody.status();
      // Distinguished deliberately. "Stored and unreadable" is a device
      // problem the user must be told about; "nothing stored" means this
      // device was never the trusted one and should not be offering.
      if (custodyStatus === 'unusable') {
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_UNUSABLE);
      }
      if (custodyStatus !== 'present') {
        throw new SecurityError(SecurityErrorCode.DATA_KEY_UNAVAILABLE);
      }
      const dataKey = await custody.load();
      if (dataKey === null) throw new SecurityError(SecurityErrorCode.DATA_KEY_UNAVAILABLE);
      return wrapDataKeyForPairing({
        dataKey,
        transportKey,
        context: pairingContext,
        cipher,
      });
    },

    async adoptPairedKey({ session, transportKey, context: pairingContext, cipher, now }) {
      const custodyStatus = await custody.status();
      // `completePairing` refuses `present` too; this is not redundant, because
      // `unusable` is the case it cannot see and the one that loses data.
      if (custodyStatus === 'present') {
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_INVALID);
      }
      if (custodyStatus === 'unusable') {
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_UNUSABLE);
      }
      return completePairing({
        session,
        transportKey,
        context: pairingContext,
        cipher,
        custody,
        now,
      });
    },
  };
}
