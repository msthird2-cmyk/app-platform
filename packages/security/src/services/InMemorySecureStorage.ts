import type { ProtectionTier } from '../protectionTier';
import type { SecureStorage } from '../types/storage';

/**
 * Fallback used in tests. It reports the `memory` tier, so every caller that
 * requires real protection refuses it — which is the point. Nothing here
 * survives a process exit, and no production secret should ever reach it.
 */
export class InMemorySecureStorage implements SecureStorage {
  readonly protection: ProtectionTier = 'memory';

  private readonly entries = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

/** Web has no biometric prompt; the app falls back to the PIN lock. */
export class UnavailableBiometrics {
  async isAvailable(): Promise<boolean> {
    return false;
  }

  async authenticate(): Promise<boolean> {
    return false;
  }
}
