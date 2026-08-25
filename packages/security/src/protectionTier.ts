import { SecurityError, SecurityErrorCode } from './errors';

/**
 * How well a store protects what it holds.
 *
 * This replaces a boolean called `isHardwareBacked`, which promised more than
 * any implementation can honestly deliver. `expo-secure-store` exposes no way
 * to discover whether the underlying keystore key lives in a TEE, in StrongBox
 * or in software — there is no `isInsideSecureHardware` passthrough and no
 * attestation — so a store setting that flag to `true` was asserting something
 * it could not check. This codebase already removed one control for letting a
 * client write its own verdict; the same reasoning applies here.
 *
 * A tier is a claim an implementation can actually stand behind:
 *
 * - `os-keystore` — the platform's own secure storage: Android Keystore,
 *   iOS Keychain, or equivalent. Says nothing about hardware.
 * - `browser-nonextractable` — values sealed under a WebCrypto key that cannot
 *   be exported, persisted in browser storage. Not OS-protected: any script
 *   running in the origin can *use* the key, even though it cannot read it.
 * - `memory` — process memory. Not persistent and never acceptable for a key.
 */
export type ProtectionTier = 'os-keystore' | 'browser-nonextractable' | 'memory';

/** Strongest first. Order is the whole meaning of the type. */
const RANK: Record<ProtectionTier, number> = {
  'os-keystore': 2,
  'browser-nonextractable': 1,
  memory: 0,
};

/**
 * Tiers a caller may demand as a minimum.
 *
 * `memory` is deliberately absent: requiring it would mean requiring nothing,
 * and the type system is a better place to rule that out than a code review.
 */
export type RequiredProtectionTier = Exclude<ProtectionTier, 'memory'>;

export function meetsProtection(actual: ProtectionTier, required: RequiredProtectionTier): boolean {
  return RANK[actual] >= RANK[required];
}

/** Throws rather than degrading — the failure mode secret storage must have. */
export function assertMeetsProtection(
  actual: ProtectionTier,
  required: RequiredProtectionTier,
): void {
  if (!meetsProtection(actual, required)) {
    throw new SecurityError(SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE);
  }
}
