import { SecurityError, SecurityErrorCode } from './errors';
import { drawRandomBytes, type RandomBytes } from './crypto/entropy';
import type { CryptoService, SecretHash } from './types/crypto';

/** 32 symbols, ambiguous characters removed. 256 is a multiple of 32, so
 *  taking a random byte modulo the alphabet length introduces no bias. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUP = 4;
const GROUPS = 3;

/** 12 symbols x log2(32) = 60 bits. */
export const RECOVERY_CODE_ENTROPY_BITS = GROUP * GROUPS * 5;

export const DEFAULT_RECOVERY_CODE_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * A stored recovery code. The plaintext exists only in the moment it is shown
 * to the user; what is persisted is a salted, iterated hash plus the state
 * needed to enforce single use and expiry.
 */
export interface RecoveryCodeRecord {
  hash: SecretHash;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
}

const SYMBOLS = GROUP * GROUPS;

/**
 * One code, e.g. `K7QM-2XPD-9RTF`. Shown once, never persisted in plaintext.
 *
 * Entropy is injected rather than read from a global. This used to call
 * `globalThis.crypto.getRandomValues` directly, which React Native does not
 * provide — the same reason `PortableCryptoService` takes a `RandomBytes`, and
 * it takes the same one. There is no separate abstraction here and no default:
 * a generator that silently falls back to a weaker source is worse than one
 * that refuses to run.
 *
 * The bias argument is unchanged. 256 is a multiple of the 32-symbol alphabet,
 * so a random byte modulo its length is uniform; the bytes are now drawn in one
 * call rather than twelve, which changes nothing about the distribution.
 */
export function generateRecoveryCode(randomBytes: RandomBytes): string {
  const bytes = drawRandomBytes(randomBytes, SYMBOLS);
  const symbols: string[] = [];
  for (let i = 0; i < SYMBOLS; i += 1) {
    symbols.push(ALPHABET[(bytes[i] as number) % ALPHABET.length] as string);
  }
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    groups.push(symbols.slice(g * GROUP, (g + 1) * GROUP).join(''));
  }
  return groups.join('-');
}

export function generateRecoveryCodes(randomBytes: RandomBytes, count = 8): string[] {
  return Array.from({ length: count }, () => generateRecoveryCode(randomBytes));
}

/** Accepts user input in any spacing or case; rejects unknown characters. */
export function normalizeRecoveryCode(input: string): string {
  const stripped = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (stripped.length !== GROUP * GROUPS) {
    throw new SecurityError(SecurityErrorCode.RECOVERY_CODE_INVALID);
  }
  for (const char of stripped) {
    if (!ALPHABET.includes(char)) throw new SecurityError(SecurityErrorCode.RECOVERY_CODE_INVALID);
  }
  return (stripped.match(/.{1,4}/g) ?? []).join('-');
}

export interface HashRecoveryCodesOptions {
  now: number;
  lifetimeMs?: number;
}

/**
 * Turns freshly generated codes into records for storage. Uses the slow,
 * salted `hashSecret` rather than a bare digest: a 60-bit secret behind a
 * single unsalted SHA-256 is within reach of offline attack, and an unsalted
 * digest lets one precomputation attack every user at once.
 */
export async function hashRecoveryCodes(
  codes: readonly string[],
  crypto: CryptoService,
  options: HashRecoveryCodesOptions,
): Promise<RecoveryCodeRecord[]> {
  const lifetimeMs = options.lifetimeMs ?? DEFAULT_RECOVERY_CODE_LIFETIME_MS;
  return Promise.all(
    codes.map(async (code) => ({
      hash: await crypto.hashSecret(normalizeRecoveryCode(code)),
      createdAt: options.now,
      expiresAt: options.now + lifetimeMs,
      usedAt: null,
    })),
  );
}

export interface VerifyRecoveryCodeResult {
  valid: boolean;
  /** The records as they should now be persisted, with the match consumed. */
  records: RecoveryCodeRecord[];
  reason?: 'INVALID' | 'EXPIRED' | 'ALREADY_USED';
}

/**
 * Verifies a code and consumes it. Every candidate is checked even after a
 * match so the work does not depend on the code's position, and a code that is
 * expired or already used is reported without being re-consumable.
 */
export async function verifyRecoveryCode(
  input: string,
  records: readonly RecoveryCodeRecord[],
  crypto: CryptoService,
  now: number,
): Promise<VerifyRecoveryCodeResult> {
  let candidate: string;
  try {
    candidate = normalizeRecoveryCode(input);
  } catch {
    return { valid: false, records: [...records], reason: 'INVALID' };
  }

  let matched = -1;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    if (await crypto.verifySecret(candidate, record.hash)) {
      if (matched === -1) matched = index;
    }
  }

  if (matched === -1) return { valid: false, records: [...records], reason: 'INVALID' };

  const record = records[matched]!;
  if (record.usedAt !== null) {
    return { valid: false, records: [...records], reason: 'ALREADY_USED' };
  }
  if (record.expiresAt <= now) {
    return { valid: false, records: [...records], reason: 'EXPIRED' };
  }

  const consumed = records.map((entry, index) =>
    index === matched ? { ...entry, usedAt: now } : entry,
  );
  return { valid: true, records: consumed };
}

export function remainingRecoveryCodes(
  records: readonly RecoveryCodeRecord[],
  now: number,
): number {
  return records.filter((record) => record.usedAt === null && record.expiresAt > now).length;
}
