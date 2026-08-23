import { SecurityError, SecurityErrorCode } from './errors';

/**
 * The KDF cost policy, stated exactly once.
 *
 * Two separate things used to decide this independently: a constructor that
 * accepted any count from 1 upwards, and a decrypt path that refused anything
 * below 100,000. A service configured between those two numbers produced
 * ciphertext and secret hashes that the very same object then refused to read
 * back — the failure surfaced later, on the restore, as unreadable data rather
 * than as a rejected configuration.
 *
 * So the bounds live here and every entry point defers to them. The rule is
 * symmetric on purpose: a count above the ceiling is the same defect in the
 * other direction, because `assertSupportedPayload` rejects that too.
 *
 * The ceiling is not a security limit — a higher count is cryptographically
 * stronger. It bounds the work a *hostile* payload can demand, since the
 * iteration count travels inside the envelope and is read before any key is
 * derived. A payload claiming a billion rounds is a denial-of-service request,
 * not a stronger secret.
 */
export const MIN_KDF_ITERATIONS = 100_000;
export const MAX_KDF_ITERATIONS = 1_000_000;

/** OWASP's PBKDF2-SHA256 floor at the time of writing, with headroom. */
export const DEFAULT_KDF_ITERATIONS = 210_000;

export function isAllowedIterationCount(iterations: unknown): iterations is number {
  return (
    typeof iterations === 'number' &&
    Number.isInteger(iterations) &&
    iterations >= MIN_KDF_ITERATIONS &&
    iterations <= MAX_KDF_ITERATIONS
  );
}

/**
 * Throws unless the count is one this implementation will both produce and
 * accept. Used at configuration time and again on every payload read, so a
 * value can never enter through one door and be refused at the other.
 */
export function assertAllowedIterationCount(iterations: unknown): asserts iterations is number {
  if (!isAllowedIterationCount(iterations)) {
    throw new SecurityError(SecurityErrorCode.ENCRYPTION_PARAMETERS_INVALID);
  }
}
