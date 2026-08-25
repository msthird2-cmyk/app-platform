import { fromBase64, toBase64 } from './crypto/base64';
import { assertSupportedPayload } from './crypto/envelope';
import { SecurityError, SecurityErrorCode } from './errors';
import type { KeyCustody } from './keyCustody';
import { normalizeRecoveryCode } from './recoveryCodes';
import type { CryptoService, EncryptedPayload, EncryptionContext } from './types/crypto';

/**
 * Recovery-code escrow for a data encryption key that already exists.
 *
 * This is the zero-trusted-device path: a user who has lost every paired
 * device holds one thing that can still reach their records, and it is a code
 * on paper rather than a credential the server can check.
 *
 * The distinction that shapes the whole module is that the recovery code is
 * **key material, not an authentication factor**. As a factor it would have to
 * be compared against something stored, and the comparison would have to happen
 * somewhere the client cannot forge — a trusted server, which the Spark plan
 * does not provide. As escrow nothing is compared: the code derives a wrapping
 * key, the wrapping key opens an AEAD envelope, and a wrong code produces an
 * authentication-tag failure. The check *is* the decryption, so no server is
 * involved and no authorization decision is ever made by the client.
 *
 * `docs/ARCHITECTURE.md` states this directly, and also that the authentication
 * form may be added alongside the escrow form if server infrastructure arrives
 * later. That is why `users/{uid}/recoveryCodes` stays closed to clients and
 * this material lives somewhere else: they are two different mechanisms holding
 * two different kinds of object, not one mechanism being migrated.
 *
 * What this module does not do: it never creates a key. The DEK is supplied by
 * the caller, exactly as `keyCustody` requires, so no path through recovery can
 * end in a freshly minted key that orphans every existing record.
 */

/** Names the KDF domain, bound into the AEAD tag. */
export const RECOVERY_ESCROW_PURPOSE = 'recovery-escrow.v1';

export const RECOVERY_ESCROW_VERSION = 1;

/** AES-256. A wrapped key of any other length did not come from this system. */
const DEK_BYTES = 32;

/**
 * The escrowed key and the minimum needed to open it.
 *
 * Every field here is either non-secret metadata or ciphertext. There is
 * deliberately no digest, checksum or verifier of the DEK or of the recovery
 * code: any such value would let an attacker holding this document test
 * candidate codes without the AEAD, which is the one thing making a 60-bit
 * secret expensive to attack. The authentication tag inside `wrappedKey` is the
 * only verifier, and it costs a full key derivation per guess.
 */
export interface RecoveryEscrowEnvelope {
  version: number;
  /** The wrapped DEK, as produced by the shared `CryptoService` envelope. */
  wrappedKey: EncryptedPayload;
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as EncryptedPayload;
  return (
    typeof payload.ciphertext === 'string' &&
    typeof payload.iv === 'string' &&
    typeof payload.salt === 'string' &&
    typeof payload.algorithm === 'string' &&
    typeof payload.iterations === 'number' &&
    typeof payload.version === 'number'
  );
}

/**
 * Rejects anything that is not an escrow envelope this system produced.
 *
 * Runs before any key derivation, so a malformed document costs nothing. The
 * payload's own version, algorithm and iteration bounds are checked by
 * `assertSupportedPayload`, which is the same gate every other envelope goes
 * through — a hostile document cannot demand a billion PBKDF2 rounds here any
 * more than it can anywhere else.
 */
export function assertRecoveryEscrowEnvelope(
  value: unknown,
): asserts value is RecoveryEscrowEnvelope {
  if (typeof value !== 'object' || value === null) {
    throw new SecurityError(SecurityErrorCode.RECOVERY_ESCROW_INVALID);
  }
  const envelope = value as RecoveryEscrowEnvelope;
  if (envelope.version !== RECOVERY_ESCROW_VERSION) {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_VERSION_UNSUPPORTED);
  }
  if (!isEncryptedPayload(envelope.wrappedKey)) {
    throw new SecurityError(SecurityErrorCode.RECOVERY_ESCROW_INVALID);
  }
  assertSupportedPayload(envelope.wrappedKey);
}

/** The context the wrapping key and the AEAD tag are bound to. */
function escrowContext(context: EncryptionContext): EncryptionContext {
  return { ...context, purpose: RECOVERY_ESCROW_PURPOSE };
}

function assertDataKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== DEK_BYTES) {
    throw new SecurityError(SecurityErrorCode.RECOVERY_ESCROW_INVALID);
  }
  let anySet = 0;
  for (const byte of key) anySet |= byte;
  // An all-zero key is a stub someone wired in, not a key.
  if (anySet === 0) throw new SecurityError(SecurityErrorCode.RECOVERY_ESCROW_INVALID);
}

/**
 * Wraps an existing DEK under a key derived from the recovery code.
 *
 * The code is normalised first, so the escrow opens whatever spacing or case
 * the user types it back in. The DEK never leaves this process in the clear:
 * what the caller gets back is an envelope whose only key material is
 * ciphertext.
 */
export async function createRecoveryEscrow(
  dataKey: Uint8Array,
  recoveryCode: string,
  crypto: CryptoService,
  context: EncryptionContext,
): Promise<RecoveryEscrowEnvelope> {
  assertDataKey(dataKey);
  // Throws RECOVERY_CODE_INVALID on a code that is not the right shape, before
  // anything is derived or written.
  const normalized = normalizeRecoveryCode(recoveryCode);
  const wrappedKey = await crypto.encrypt(
    toBase64(dataKey),
    normalized,
    escrowContext(context),
  );
  return { version: RECOVERY_ESCROW_VERSION, wrappedKey };
}

/**
 * Opens an escrow envelope and returns the DEK.
 *
 * A wrong recovery code fails here as a GCM tag failure — `DECRYPTION_FAILED` —
 * and there is no other outcome for it. Nothing about the failure distinguishes
 * "wrong code" from "tampered ciphertext", and nothing needs to: neither can
 * produce a key.
 */
export async function openRecoveryEscrow(
  envelope: unknown,
  recoveryCode: string,
  crypto: CryptoService,
  context: EncryptionContext,
): Promise<Uint8Array> {
  assertRecoveryEscrowEnvelope(envelope);
  const normalized = normalizeRecoveryCode(recoveryCode);
  const encoded = await crypto.decrypt(
    envelope.wrappedKey,
    normalized,
    escrowContext(context),
  );

  let dataKey: Uint8Array;
  try {
    dataKey = fromBase64(encoded);
  } catch (cause) {
    // The tag verified, so this came from us and is corrupt rather than
    // hostile — but it is still not a key, and it is not treated as one.
    throw new SecurityError(SecurityErrorCode.RECOVERY_ESCROW_INVALID, cause);
  }
  assertDataKey(dataKey);
  return dataKey;
}

export interface RecoverDataKeyOptions {
  /** The stored envelope, or `null` when the user has no escrow at all. */
  escrow: unknown;
  recoveryCode: string;
  crypto: CryptoService;
  context: EncryptionContext;
  /** Gate 2 custody. The recovered key is placed here and nowhere else. */
  custody: KeyCustody;
}

/**
 * The whole zero-trusted-device recovery, end to end.
 *
 * Note what happens on every failure: nothing. The key is stored only after it
 * has been unwrapped and validated, so a wrong code, a corrupt envelope or a
 * missing escrow all leave custody exactly as it was. In particular a missing
 * escrow throws rather than falling through to key creation — this module
 * cannot create a key, and a recovery flow that quietly produced a new one
 * would orphan every record encrypted under the old one while appearing to
 * succeed.
 */
export async function recoverDataKey(options: RecoverDataKeyOptions): Promise<Uint8Array> {
  const { escrow, recoveryCode, crypto, context, custody } = options;
  if (escrow === null || escrow === undefined) {
    throw new SecurityError(SecurityErrorCode.RECOVERY_ESCROW_MISSING);
  }
  const dataKey = await openRecoveryEscrow(escrow, recoveryCode, crypto, context);
  // Custody validates the bytes again on the way in. That is deliberate
  // duplication: it is the only writer of the stored key and does not trust
  // its callers to have checked.
  await custody.store(dataKey);
  return dataKey;
}

/**
 * The escrow as a flat document, for storage.
 *
 * Flat rather than nested because Security Rules have to validate it field by
 * field, and a rule that can state `iterations is int && iterations >= 100000`
 * directly is one an auditor can read. The persistence layer adds `createdAt`
 * and `updatedAt`; they are not part of the cryptographic envelope and nothing
 * here depends on them.
 *
 * `kdf` and `algorithm` are recorded even though only one value of each is
 * currently accepted. They are already covered by the authentication tag, so
 * they cannot be edited to change how the payload is read; writing them down
 * makes the stored document self-describing rather than dependent on a constant
 * in whatever version of the client happens to read it next.
 */
export interface RecoveryEscrowDocument {
  id: string;
  version: number;
  algorithm: string;
  kdf: string;
  iterations: number;
  salt: string;
  iv: string;
  /** Base64 ciphertext of the DEK. The only secret-derived value here. */
  wrappedKey: string;
}

export function toRecoveryEscrowDocument(
  id: string,
  envelope: RecoveryEscrowEnvelope,
): RecoveryEscrowDocument {
  assertRecoveryEscrowEnvelope(envelope);
  return {
    id,
    version: envelope.version,
    algorithm: envelope.wrappedKey.algorithm,
    kdf: 'PBKDF2-SHA256',
    iterations: envelope.wrappedKey.iterations,
    salt: envelope.wrappedKey.salt,
    iv: envelope.wrappedKey.iv,
    wrappedKey: envelope.wrappedKey.ciphertext,
  };
}

/**
 * Rebuilds the envelope from a stored document, rejecting anything malformed.
 *
 * Deliberately tolerant of extra fields such as the timestamps the persistence
 * layer adds, and deliberately intolerant of a missing or wrongly typed one:
 * the Security Rules already refuse to store a document of the wrong shape, and
 * this is the second half of that check for anything that reached storage
 * before the rule did, or by some other route.
 */
export function fromRecoveryEscrowDocument(document: unknown): RecoveryEscrowEnvelope {
  if (typeof document !== 'object' || document === null) {
    throw new SecurityError(SecurityErrorCode.RECOVERY_ESCROW_INVALID);
  }
  const stored = document as RecoveryEscrowDocument;
  if (
    typeof stored.salt !== 'string' ||
    typeof stored.iv !== 'string' ||
    typeof stored.wrappedKey !== 'string' ||
    typeof stored.algorithm !== 'string' ||
    typeof stored.iterations !== 'number' ||
    typeof stored.version !== 'number'
  ) {
    throw new SecurityError(SecurityErrorCode.RECOVERY_ESCROW_INVALID);
  }
  const envelope: RecoveryEscrowEnvelope = {
    version: stored.version,
    wrappedKey: {
      ciphertext: stored.wrappedKey,
      iv: stored.iv,
      salt: stored.salt,
      algorithm: stored.algorithm as 'AES-GCM',
      iterations: stored.iterations,
      version: 1,
    },
  };
  assertRecoveryEscrowEnvelope(envelope);
  return envelope;
}
