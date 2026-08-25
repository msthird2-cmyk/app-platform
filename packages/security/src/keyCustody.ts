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
 * - `present`  — a well-formed key is stored and can be loaded.
 * - `unusable` — something is stored and cannot be read back. On Android this
 *                is what a keystore key invalidated by a lock-screen change
 *                looks like: the ciphertext survives, the key that opens it
 *                does not. Treating this as `absent` is the failure this type
 *                exists to prevent.
 */
export type KeyCustodyStatus = 'absent' | 'present' | 'unusable';

export interface KeyCustody {
  /** Never throws. Reports what is there without committing to reading it. */
  status(): Promise<KeyCustodyStatus>;
  /**
   * The key bytes, or `null` when genuinely absent.
   *
   * Throws when the entry exists but cannot be read. `null` means "there is no
   * key" and nothing else — a caller may safely act on it, and must not receive
   * it for a key that is merely unreachable.
   */
  load(): Promise<Uint8Array | null>;
  /** Replaces whatever is stored. The caller supplies the bytes. */
  store(key: Uint8Array): Promise<void>;
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

interface StoredEnvelope {
  v: number;
  k: string;
}

function isEnvelope(value: unknown): value is StoredEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredEnvelope).v === 'number' &&
    typeof (value as StoredEnvelope).k === 'string'
  );
}

/** `null` when nothing is stored; `undefined` when something is and is broken. */
function decode(raw: string): Uint8Array | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isEnvelope(parsed) || parsed.v !== ENVELOPE_VERSION) return undefined;
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(parsed.k);
  } catch {
    return undefined;
  }
  if (bytes.length !== KEY_BYTES) return undefined;
  return bytes;
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
      return decode(raw) === undefined ? 'unusable' : 'present';
    },

    async load() {
      let raw: string | null;
      try {
        raw = await storage.get(storageKey);
      } catch (cause) {
        throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_UNUSABLE, cause);
      }
      if (raw === null) return null;
      const bytes = decode(raw);
      if (bytes === undefined) throw new SecurityError(SecurityErrorCode.KEY_CUSTODY_UNUSABLE);
      return bytes;
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

    async clear() {
      await storage.remove(storageKey);
    },
  };
}
