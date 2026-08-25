import { SecurityError, SecurityErrorCode } from './errors';
import type { SecureStorage } from './types/storage';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface SessionState {
  userId: string;
  tokens: SessionTokens;
}

/** Refresh a little before expiry so a request never races the deadline. */
export const REFRESH_SKEW_MS = 60_000;

export function isExpired(tokens: SessionTokens, now: number): boolean {
  return tokens.expiresAt <= now;
}

export function needsRefresh(tokens: SessionTokens, now: number, skewMs = REFRESH_SKEW_MS): boolean {
  return tokens.expiresAt - skewMs <= now;
}

export function msUntilRefresh(tokens: SessionTokens, now: number, skewMs = REFRESH_SKEW_MS): number {
  return Math.max(0, tokens.expiresAt - skewMs - now);
}

export function assertActive(session: SessionState | null, now: number): SessionState {
  if (!session || isExpired(session.tokens, now)) {
    throw new SecurityError(SecurityErrorCode.SESSION_EXPIRED);
  }
  return session;
}

const SESSION_KEY = 'platform.session';

export interface SessionStore {
  load(): Promise<SessionState | null>;
  save(session: SessionState): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Persists a session only to storage that can actually protect it. A session
 * carries access and refresh tokens, so writing it to AsyncStorage or
 * localStorage would leave them in plaintext; this fails closed instead.
 */
export function createSessionStore(storage: SecureStorage): SessionStore {
  if (!storage.isHardwareBacked) {
    throw new SecurityError(SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE);
  }
  return {
    async load() {
      const raw = await storage.get(SESSION_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as SessionState;
      } catch {
        await storage.remove(SESSION_KEY);
        return null;
      }
    },
    async save(session) {
      await storage.set(SESSION_KEY, JSON.stringify(session));
    },
    async clear() {
      await storage.remove(SESSION_KEY);
    },
  };
}
