import type { SecureStorage } from '@platform/security';

/**
 * A thin adapter over the platform's key-value store. Firebase has no secure
 * storage of its own, so applications hand in the native keystore (or the web
 * fallback) and this class only normalizes the interface.
 */
export class AdaptedSecureStorage implements SecureStorage {
  constructor(
    private readonly backing: {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
      removeItem(key: string): Promise<void>;
      getAllKeys?(): Promise<string[]>;
    },
  ) {}

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
