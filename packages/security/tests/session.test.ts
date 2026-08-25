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
import type { SecureStorage } from '../src/types/storage';
import type { ProtectionTier } from '../src/protectionTier';

const NOW = 1_700_000_000_000;

function session(expiresAt: number): SessionState {
  return { userId: 'user-1', tokens: { accessToken: 'a', refreshToken: 'r', expiresAt } };
}

/** Stands in for a Keychain or Android Keystore implementation. */
class KeystoreBackedStorage extends InMemorySecureStorage implements SecureStorage {
  override readonly protection: ProtectionTier = 'os-keystore';
}

/** The browser tier: real protection, but not the platform keystore. */
class BrowserBackedStorage extends InMemorySecureStorage implements SecureStorage {
  override readonly protection: ProtectionTier = 'browser-nonextractable';
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
  it('refuses storage that cannot protect a token', () => {
    // AsyncStorage and localStorage land here: plaintext on disk.
    expect(() => createSessionStore(new InMemorySecureStorage())).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE }),
    );
  });

  it('refuses the browser tier for tokens unless the caller lowers the bar', () => {
    // Tokens default to the keystore, as they always have. A web application
    // that knowingly accepts the weaker tier has to say so.
    expect(() => createSessionStore(new BrowserBackedStorage())).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE }),
    );
    expect(() =>
      createSessionStore(new BrowserBackedStorage(), 'browser-nonextractable'),
    ).not.toThrow();
  });

  it('still refuses process memory even at the lowest expressible bar', () => {
    expect(() =>
      createSessionStore(new InMemorySecureStorage(), 'browser-nonextractable'),
    ).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE }),
    );
  });

  it('round-trips through keystore-backed storage', async () => {
    const store = createSessionStore(new KeystoreBackedStorage());
    await store.save(session(NOW + 1000));
    await expect(store.load()).resolves.toMatchObject({ userId: 'user-1' });
    await store.clear();
    await expect(store.load()).resolves.toBeNull();
  });

  it('discards a corrupt entry instead of throwing', async () => {
    const storage = new KeystoreBackedStorage();
    await storage.set('platform.session', 'not json');
    const store = createSessionStore(storage);
    await expect(store.load()).resolves.toBeNull();
    await expect(storage.get('platform.session')).resolves.toBeNull();
  });
});
