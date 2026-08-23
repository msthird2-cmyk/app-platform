import { describe, expect, it } from 'vitest';
import {
  assertUnlockable,
  DEFAULT_APP_LOCK_POLICY,
  initialAppLockState,
  isLockedOut,
  registerFailedAttempt,
  registerSuccess,
  shouldAutoLock,
} from '../src/appLock';
import { SecurityErrorCode } from '../src/errors';

const NOW = 1_700_000_000_000;

describe('app lock', () => {
  it('locks out after the configured number of attempts', () => {
    let state = initialAppLockState(NOW);
    for (let attempt = 1; attempt < DEFAULT_APP_LOCK_POLICY.maxAttempts; attempt += 1) {
      state = registerFailedAttempt(state, NOW);
      expect(isLockedOut(state, NOW)).toBe(false);
    }
    state = registerFailedAttempt(state, NOW);
    expect(isLockedOut(state, NOW)).toBe(true);
  });

  it('releases the lockout once the window passes', () => {
    let state = initialAppLockState(NOW);
    for (let attempt = 0; attempt < DEFAULT_APP_LOCK_POLICY.maxAttempts; attempt += 1) {
      state = registerFailedAttempt(state, NOW);
    }
    expect(isLockedOut(state, NOW + DEFAULT_APP_LOCK_POLICY.lockoutMs - 1)).toBe(true);
    expect(isLockedOut(state, NOW + DEFAULT_APP_LOCK_POLICY.lockoutMs)).toBe(false);
  });

  it('clears the counter on success', () => {
    const state = registerSuccess(NOW);
    expect(state.failedAttempts).toBe(0);
    expect(state.lockedUntil).toBeNull();
  });

  it('auto-locks after the idle window', () => {
    const state = initialAppLockState(NOW);
    expect(shouldAutoLock(state, NOW + DEFAULT_APP_LOCK_POLICY.autoLockMs - 1, DEFAULT_APP_LOCK_POLICY)).toBe(false);
    expect(shouldAutoLock(state, NOW + DEFAULT_APP_LOCK_POLICY.autoLockMs, DEFAULT_APP_LOCK_POLICY)).toBe(true);
  });

  it('refuses to unlock while locked out', () => {
    let state = initialAppLockState(NOW);
    for (let attempt = 0; attempt < DEFAULT_APP_LOCK_POLICY.maxAttempts; attempt += 1) {
      state = registerFailedAttempt(state, NOW);
    }
    expect(() => assertUnlockable(state, NOW)).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.APP_LOCKED_OUT }),
    );
  });
});
