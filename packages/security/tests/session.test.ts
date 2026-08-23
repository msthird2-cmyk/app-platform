import { describe, expect, it } from 'vitest';
import {
  assertActive,
  createSessionStore,
  isExpired,
  msUntilRefresh,
  needsRefresh,
  REFRESH_SKEW_MS,
  type SessionState,
} from '../src/session';
import { InMemorySecureStorage } from '../src/services/InMemorySecureStorage';
import { SecurityErrorCode } from '../src/errors';

const NOW = 1_700_000_000_000;

function session(expiresAt: number): SessionState {
  return { userId: 'user-1', tokens: { accessToken: 'a', refreshToken: 'r', expiresAt } };
}

describe('session lifetime', () => {
  it('treats the expiry instant as expired', () => {
    expect(isExpired(session(NOW).tokens, NOW)).toBe(true);
    expect(isExpired(session(NOW + 1).tokens, NOW)).toBe(false);
  });

  it('asks for a refresh before the deadline', () => {
    expect(needsRefresh(session(NOW + REFRESH_SKEW_MS + 1).tokens, NOW)).toBe(false);
    expect(needsRefresh(session(NOW + REFRESH_SKEW_MS).tokens, NOW)).toBe(true);
  });

  it('never schedules a refresh in the past', () => {
    expect(msUntilRefresh(session(NOW - 5000).tokens, NOW)).toBe(0);
    expect(msUntilRefresh(session(NOW + 5 * 60_000).tokens, NOW)).toBe(4 * 60_000);
  });

  it('throws a typed error for an expired session', () => {
    expect(() => assertActive(session(NOW - 1), NOW)).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.SESSION_EXPIRED }),
    );
    expect(() => assertActive(null, NOW)).toThrow();
  });
});

describe('session store', () => {
  it('round-trips through secure storage', async () => {
    const store = createSessionStore(new InMemorySecureStorage());
    await store.save(session(NOW + 1000));
    await expect(store.load()).resolves.toMatchObject({ userId: 'user-1' });
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it('discards a corrupt entry instead of throwing', async () => {
    const storage = new InMemorySecureStorage();
    await storage.set('platform.session', 'not json');
    const store = createSessionStore(storage);
    await expect(store.load()).resolves.toBeNull();
    await expect(storage.get('platform.session')).resolves.toBeNull();
  });
});
