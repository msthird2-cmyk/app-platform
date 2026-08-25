import type { SecureStorage } from '../types/storage';

/**
 * Fallback used in tests and on platforms without a keystore. It is explicitly
 * not hardware-backed, so callers holding token material will refuse to use it.
 */
export class InMemorySecureStorage implements SecureStorage {
  readonly isHardwareBacked = false;

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
