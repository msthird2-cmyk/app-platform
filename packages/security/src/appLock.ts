import { SecurityError, SecurityErrorCode } from './errors';

export interface AppLockPolicy {
  maxAttempts: number;
  lockoutMs: number;
  /** Idle time after which the app re-locks itself. */
  autoLockMs: number;
}

export const DEFAULT_APP_LOCK_POLICY: AppLockPolicy = {
  maxAttempts: 5,
  lockoutMs: 5 * 60_000,
  autoLockMs: 2 * 60_000,
};

export interface AppLockState {
  failedAttempts: number;
  lockedUntil: number | null;
  lastActiveAt: number;
}

export function initialAppLockState(now: number): AppLockState {
  return { failedAttempts: 0, lockedUntil: null, lastActiveAt: now };
}

export function isLockedOut(state: AppLockState, now: number): boolean {
  return state.lockedUntil !== null && state.lockedUntil > now;
}

export function shouldAutoLock(state: AppLockState, now: number, policy: AppLockPolicy): boolean {
  return now - state.lastActiveAt >= policy.autoLockMs;
}

export function registerFailedAttempt(
  state: AppLockState,
  now: number,
  policy: AppLockPolicy = DEFAULT_APP_LOCK_POLICY,
): AppLockState {
  const failedAttempts = state.failedAttempts + 1;
  const lockedOut = failedAttempts >= policy.maxAttempts;
  return {
    failedAttempts: lockedOut ? 0 : failedAttempts,
    lockedUntil: lockedOut ? now + policy.lockoutMs : state.lockedUntil,
    lastActiveAt: now,
  };
}

export function registerSuccess(now: number): AppLockState {
  return { failedAttempts: 0, lockedUntil: null, lastActiveAt: now };
}

export function assertUnlockable(
  state: AppLockState,
  now: number,
): void {
  if (isLockedOut(state, now)) throw new SecurityError(SecurityErrorCode.APP_LOCKED_OUT);
}
