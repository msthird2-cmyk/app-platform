import { fromBase64, toBase64 } from './crypto/base64';
import { SecurityError, SecurityErrorCode } from './errors';
import { assertMeetsProtection, type RequiredProtectionTier } from './protectionTier';
import type { SecureStorage } from './types/storage';

/**
 * Custody of a data encryption key that already exists.
 *
 * This layer holds a key; it never makes one. The distinction is the whole
 * reason the module is separate: a store that could mint a replacement would
 * eventually mint one at the worst moment, when an existing key had become
 * unreadable, and every record encrypted under the old key would be orphaned
 * silently. Generation belongs to whatever later gate introduces it.
 */

/** The subset of secure storage custody needs, following `MinimalSecureStorage`. */
export interface CustodyStorage {
  readonly protection: SecureStorage['protection'];
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * Three states, and the difference between two of them decides whether a user
 * is shown onboarding or recovery:
 *
 * - `absent`   — nothing is stored. The only state in which creating a key is
 *                legitimate.
 * - `protected` — a passphrase-wrapped key is stored. It exists and custody
 *                cannot open it: only the passphrase can, and custody is not
 *                where a passphrase belongs. Distinct from `present` so a
 *                caller cannot mistake "shut" for "available", and distinct
 *                from `absent` so nothing writes over it.
 * - `present`  — a well-formed key is stored and can be loaded.
 * - `unusable` — something is stored and cannot be read back. On Android this
 *                is what a keystore key invalidated by a lock-screen change
 *                looks like: the ciphertext survives, the key that opens it
 *                does not. Treating this as `absent` is the failure this type
 *                exists to prevent.
 */
export type KeyCustodyStatus = 'absent' | 'present' | 'protected' | 'unusable';

export interface KeyCustody {
  /** Never throws. Reports what is there without committing to reading it. */
  status(): Promise<KeyCustodyStatus>;
  /**
   * The key bytes, or `null` when genuinely absent.
   *
   * Throws when the entry exists but cannot be read. `null` means "there is no
   * key" and nothing else — a caller may safely act on it, and must not receive
   * it for a key that is merely unreachable.
   *
   * A protected key throws `DATA_KEY_LOCKED` rather than returning `null`.
   * Returning `null` would tell a caller there is no key, and the caller that
   * believes that offers to create one.
   */
  load(): Promise<Uint8Array | null>;
  /**
   * Replaces whatever is stored, unprotected.
   *
   * Deliberately unchanged by the passphrase work. Every caller of this —
   * first-time setup, recovery, pairing adoption — is a moment at which a key
   * *arrives* on this device, and none of them holds a passphrase. Making them
   * hold one would put a forgettable secret in front of recovery, which is the
   * one thing the passphrase must never become.
   */
  store(key: Uint8Array): Promise<void>;
  /**
   * Replaces whatever is stored with a passphrase-wrapped form.
   *
   * The only writer of a protected envelope. Custody neither derives nor holds
   * the passphrase: it is handed a wrapper somebody else produced.
   */
  storeWrapped(wrapper: unknown): Promise<void>;
  /**
   * The stored wrapper, for opening or re-wrapping. `null` when the stored key
   * is unprotected or nothing is stored.
   */
  loadWrapped(): Promise<unknown | null>;
  clear(): Promise<void>;
}

export interface KeyCustodyOptions {
  /**
   * Defaults to `os-keystore`. Web has no OS keystore, so a browser
   * composition root lowers this to `browser-nonextractable` explicitly — a
   * visible, auditable decision rather than a silent downgrade. `memory` is not
   * expressible: see `RequiredProtectionTier`.
   */
  minimumProtection?: RequiredProtectionTier;
  /** Namespaces the entry. Applications sharing a device do not share a key. */
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = 'platform.dek.v1';

/** AES-256. A key of any other length did not come from this system. */
const KEY_BYTES = 32;
const ENVELOPE_VERSION = 1;
/** A key wrapped under a passphrase. See `dataKeyWrapper`. */
const WRAPPED_ENVELOPE_VERSION = 2;

interface PlainEnvelope {
  v: 1;
  k: string;
}

/**
 * A passphrase-wrapped key.
 *
 * `w` is a `WrappedDataKey` and is deliberately typed `unknown` here: custody
 * stores it and hands it back, and validating it is `assertWrappedDataKey`'s
 * job in the module that can also open it. Custody has no `CryptoService` and
 * should not acquire one — it is a store, not a cipher.
 */
interface WrappedEnvelope {
  v: 2;
  w: unknown;
}

type StoredEnvelope = PlainEnvelope | WrappedEnvelope;

/** What is stored, decoded. `undefined` means present and unreadable. */
type Decoded =
  | { kind: 'plain'; key: Uint8Array }
  | { kind: 'wrapped'; wrapper: unknown };

function decode(raw: string): Decoded | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const envelope = parsed as StoredEnvelope;

  if (envelope.v === WRAPPED_ENVELOPE_VERSION) {
    // Shape only. Whether it is a wrapper this system produced is decided when
    // somebody tries to open it, which is the only moment that can tell.
    if (typeof envelope.w !== 'object' || envelope.w === null) return undefined;
    return { kind: 'wrapped', wrapper: envelope.w };
  }

  if (envelope.v !== ENVELOPE_VERSION || typeof envelope.k !== 'string') return undefined;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(envelope.k);
  } catch {
    return undefined;
  }
  if (bytes.length !== KEY_BYTES) return undefined;
  return { kind: 'plain', key: bytes };
}

export function createKeyCustody(
  storage: CustodyStorage,
  options: KeyCustodyOptions = {},
): KeyCustody {
  const required = options.minimumProtection ?? 'os-keystore';
  // Checked once, at construction, so a misconfigured application fails at
  // startup rather than the first time it touches a key.
  assertMeetsProtection(storage.protection, required);
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;

  return {
    async status() {
      let raw: string | null;
      try {
        raw = await storage.get(storageKey);
      } catch {
        // A read that throws is not evidence of absence. Something may well be
        // stored; we simply cannot reach it.
        return 'unusable';
      }
      if (raw === null) return 'absent';
      const decoded = decode(raw);
      if (decoded === undefined) return 'unusable';
      return decoded.kind === 'wrapped' ? 'protected' : 'present';
    },

    async load() {
      let raw: string | null;
      try {
        raw = await storage.get(storageKey);
      } catch (cause) {
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_UNUSABLE, cause);
      }
      if (raw === null) return null;
      const decoded = decode(raw);
      if (decoded === undefined) throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_UNUSABLE);
      if (decoded.kind === 'wrapped') {
        // Present and shut. Custody cannot open it and must not pretend it is
        // absent, because "absent" is the state in which a new key gets made.
        throw new SecurityError(SecurityErrorCode.DATA_KEY_LOCKED);
      }
      return decoded.key;
    },

    async store(key: Uint8Array) {
      if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_INVALID);
      }
      let anySet = 0;
      for (const byte of key) anySet |= byte;
      // An all-zero key is a stub someone wired in, not a key.
      if (anySet === 0) throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_INVALID);
      const envelope: StoredEnvelope = { v: ENVELOPE_VERSION, k: toBase64(key) };
      await storage.set(storageKey, JSON.stringify(envelope));
    },

    async storeWrapped(wrapper: unknown) {
      if (typeof wrapper !== 'object' || wrapper === null) {
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_INVALID);
      }
      const envelope: StoredEnvelope = { v: WRAPPED_ENVELOPE_VERSION, w: wrapper };
      await storage.set(storageKey, JSON.stringify(envelope));
    },

    async loadWrapped() {
      let raw: string | null;
      try {
        raw = await storage.get(storageKey);
      } catch (cause) {
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_UNUSABLE, cause);
      }
      if (raw === null) return null;
      const decoded = decode(raw);
      if (decoded === undefined) throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_UNUSABLE);
      return decoded.kind === 'wrapped' ? decoded.wrapper : null;
    },

    async clear() {
      await storage.remove(storageKey);
    },
  };
}
