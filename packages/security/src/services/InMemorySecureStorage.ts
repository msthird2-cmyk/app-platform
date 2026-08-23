import type { SecureStorage } from '../types/storage';

/**
 * Fallback used in tests and on platforms without a keystore. Applications
 * inject a keychain/keystore-backed implementation in production.
 */
export class InMemorySecureStorage implements SecureStorage {
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
