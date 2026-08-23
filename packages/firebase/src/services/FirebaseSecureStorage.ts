import type { SecureStorage } from '@platform/security';

export interface AdaptedSecureStorageOptions {
  /**
   * Set only when the backing store is a real platform keystore — Keychain,
   * Android Keystore, `expo-secure-store` or equivalent. AsyncStorage and
   * `localStorage` are **not** hardware-backed: they hold plaintext, readable
   * on a rooted device or by any injected script.
   *
   * Callers that persist token material check this and refuse to write when it
   * is false, so claiming it falsely defeats the check.
   */
  hardwareBacked: boolean;
}

/**
 * A thin adapter over the platform's key-value store. Firebase has no secure
 * storage of its own, so applications hand in the native keystore (or the web
 * fallback) and this class only normalizes the interface.
 */
export class AdaptedSecureStorage implements SecureStorage {
  readonly isHardwareBacked: boolean;

  constructor(
    private readonly backing: {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
      getAllKeys?(): Promise<string[]>;
    },
    options: AdaptedSecureStorageOptions,
  ) {
    this.isHardwareBacked = options.hardwareBacked;
  }

  async get(key: string): Promise<string | null> {
    return this.backing.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.backing.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    await this.backing.removeItem(key);
  }

  async clear(): Promise<void> {
    const keys = (await this.backing.getAllKeys?.()) ?? [];
    await Promise.all(keys.map((key) => this.backing.removeItem(key)));
  }
}
