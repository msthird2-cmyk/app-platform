import type { ProtectionTier, SecureStorage } from '@platform/security';

export interface AdaptedSecureStorageOptions {
  /**
   * The tier the backing store actually provides.
   *
   * `os-keystore` only when the backing really is a platform keystore —
   * Keychain, Android Keystore, `expo-secure-store`. AsyncStorage and
   * `localStorage` are `memory` at best: they hold plaintext, readable on a
   * rooted device or by any injected script.
   *
   * Callers that persist secrets compare this against the tier they require and
   * refuse to write when it falls short, so overstating it defeats the check.
   */
  protection: ProtectionTier;
}

/**
 * A thin adapter over the platform's key-value store. Firebase has no secure
 * storage of its own, so applications hand in the native keystore (or the web
 * fallback) and this class only normalizes the interface.
 */
export class AdaptedSecureStorage implements SecureStorage {
  readonly protection: ProtectionTier;

  constructor(
    private readonly backing: {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
      getAllKeys?(): Promise<string[]>;
    },
    options: AdaptedSecureStorageOptions,
  ) {
    this.protection = options.protection;
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
