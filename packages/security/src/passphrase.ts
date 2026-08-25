import { SecurityError, SecurityErrorCode } from './errors';

export interface PassphrasePolicy {
  minLength: number;
  /** Distinct character classes required: lower, upper, digit, symbol. */
  minCharacterClasses: number;
  minUniqueCharacters: number;
}

/**
 * A backup passphrase is the only thing standing between an exported ciphertext
 * and every financial record it contains. PBKDF2 raises the cost per guess; it
 * cannot rescue a guessable secret.
 */
export const DEFAULT_PASSPHRASE_POLICY: PassphrasePolicy = {
  minLength: 12,
  minCharacterClasses: 2,
  minUniqueCharacters: 6,
};

export type PassphraseIssue =
  | 'PASSPHRASE_TOO_SHORT'
  | 'PASSPHRASE_TOO_SIMPLE'
  | 'PASSPHRASE_TOO_REPETITIVE'
  | 'PASSPHRASE_TOO_COMMON';

/** Lowercased; matched after stripping non-alphanumerics. */
const COMMON = new Set([
  'password', 'passphrase', 'letmein', 'qwerty', 'iloveyou', 'admin',
  'welcome', 'monkey', 'dragon', 'abc123', 'password1', '123456',
  '12345678', '123456789', '1234567890', 'qwertyuiop', 'changeme',
]);

function characterClasses(value: string): number {
  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/\d/.test(value)) classes += 1;
  if (/[^A-Za-z0-9]/.test(value)) classes += 1;
  return classes;
}

export interface PassphraseAssessment {
  ok: boolean;
  issues: PassphraseIssue[];
}

export function assessPassphrase(
  passphrase: string,
  policy: PassphrasePolicy = DEFAULT_PASSPHRASE_POLICY,
): PassphraseAssessment {
  const issues: PassphraseIssue[] = [];

  if (passphrase.length < policy.minLength) issues.push('PASSPHRASE_TOO_SHORT');
  if (characterClasses(passphrase) < policy.minCharacterClasses) {
    issues.push('PASSPHRASE_TOO_SIMPLE');
  }
  if (new Set(passphrase).size < policy.minUniqueCharacters) {
    issues.push('PASSPHRASE_TOO_REPETITIVE');
  }
  const normalized = passphrase.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (COMMON.has(normalized)) issues.push('PASSPHRASE_TOO_COMMON');

  return { ok: issues.length === 0, issues };
}

/** Throws rather than warning: a weak passphrase must not reach encryption. */
export function assertStrongPassphrase(
  passphrase: string,
  policy: PassphrasePolicy = DEFAULT_PASSPHRASE_POLICY,
): void {
  if (!assessPassphrase(passphrase, policy).ok) {
    throw new SecurityError(SecurityErrorCode.PASSPHRASE_TOO_WEAK);
  }
}
