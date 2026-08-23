import { SecurityError, SecurityErrorCode } from './errors';
import type { CryptoService } from './types/crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
const GROUP = 4;
const GROUPS = 3;

function randomChar(): string {
  const bytes = new Uint8Array(1);
  globalThis.crypto.getRandomValues(bytes);
  const index = (bytes[0] ?? 0) % ALPHABET.length;
  return ALPHABET[index] ?? ALPHABET[0]!;
}

/** One code, e.g. `K7QM-2XPD-9RTF`. Shown once, never persisted in plaintext. */
export function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g += 1) {
    let group = '';
    for (let c = 0; c < GROUP; c += 1) group += randomChar();
    groups.push(group);
  }
  return groups.join('-');
}

export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => generateRecoveryCode());
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

export async function hashRecoveryCodes(codes: readonly string[], crypto: CryptoService): Promise<string[]> {
  return Promise.all(codes.map((code) => crypto.hash(normalizeRecoveryCode(code))));
}

/**
 * Verifies a code against stored hashes and reports which hash was consumed,
 * so the caller can invalidate it. A recovery code is single use.
 */
export async function verifyRecoveryCode(
  input: string,
  hashes: readonly string[],
  crypto: CryptoService,
): Promise<{ valid: boolean; remaining: string[] }> {
  let candidate: string;
  try {
    candidate = await crypto.hash(normalizeRecoveryCode(input));
  } catch {
    return { valid: false, remaining: [...hashes] };
  }
  const index = hashes.indexOf(candidate);
  if (index === -1) return { valid: false, remaining: [...hashes] };
  return { valid: true, remaining: hashes.filter((_, i) => i !== index) };
}
