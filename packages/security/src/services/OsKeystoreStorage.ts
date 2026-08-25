import { SecurityError, SecurityErrorCode } from '../errors';
import type { ProtectionTier } from '../protectionTier';
import type { SecureStorage } from '../types/storage';

/**
 * `SecureStorage` over the platform keystore — Android Keystore on Android,
 * Keychain on iOS.
 *
 * The module is **injected rather than imported**, for the same reason
 * `PortableCryptoService` takes its entropy source as an argument: importing
 * `expo-secure-store` here would put an Expo dependency inside the shared,
 * platform-neutral security package and drag it into every web and Node build
 * that consumes it. The application passes the module in from its composition
 * root, and this file stays free of any React Native or Expo import.
 */

/** Exactly the shape of `expo-secure-store`, and nothing more. */
export interface SecureStoreBackend {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(key: string, options?: SecureStoreItemOptions): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: SecureStoreItemOptions): Promise<void>;
  deleteItemAsync(key: string, options?: SecureStoreItemOptions): Promise<void>;
  /**
   * Present only where the platform implements keychain accessibility.
   *
   * `expo-secure-store` reads this off the native module, and only
   * `ios/SecureStoreModule.swift` defines it — the Android module defines no
   * accessibility constants, and the library documents the option itself as
   * `@platform ios`. So on Android this is `undefined`, and that absence is the
   * signal used below to decide whether an accessibility choice is meaningful.
   */
  readonly AFTER_FIRST_UNLOCK?: number | undefined;
}

export interface SecureStoreItemOptions {
  keychainService?: string;
  keychainAccessible?: number;
  requireAuthentication?: boolean;
  authenticationPrompt?: string;
}

export interface OsKeystoreStorageOptions {
  /**
   * iOS `kSecAttrAccessible`. Pass `SecureStore.AFTER_FIRST_UNLOCK`.
   *
   * The library's default is `WHEN_UNLOCKED`, under which every read fails
   * while the screen is locked — which is precisely when a background sync
   * runs. `AFTER_FIRST_UNLOCK` keeps the item readable once the device has been
   * unlocked since boot. Android ignores this; its equivalent behaviour is
   * inherent to the keystore.
   *
   * The trade-off is real and deliberate: the key is reachable by this process
   * whenever the device has been unlocked once. That is the price of syncing
   * without prompting a user who is not there.
   */
  keychainAccessible?: number | undefined;
  /** Namespaces entries so two applications on one device do not collide. */
  keychainService?: string;
}

/**
 * Note what is *not* configurable here: `requireAuthentication`.
 *
 * Setting it would gate every read behind a biometric prompt, and
 * `expo-secure-store` documents that such a read blocks the JavaScript thread
 * until the user responds. A background sync has no user, so it would hang
 * rather than fail. App lock is the right place for user presence; key custody
 * is not.
 */
export class OsKeystoreStorage implements SecureStorage {
  readonly protection: ProtectionTier = 'os-keystore';

  private readonly itemOptions: SecureStoreItemOptions;
  private readonly written = new Set<string>();

  private constructor(
    private readonly backend: SecureStoreBackend,
    options: OsKeystoreStorageOptions,
  ) {
    this.itemOptions = {
      ...(options.keychainAccessible === undefined
        ? {}
        : { keychainAccessible: options.keychainAccessible }),
      ...(options.keychainService === undefined
        ? {}
        : { keychainService: options.keychainService }),
      requireAuthentication: false,
    };
  }

  /**
   * Asynchronous because availability has to be asked, not assumed. A device
   * with no keystore fails here, at startup, rather than at the first write —
   * and there is no degraded mode to fall back to.
   */
  static async create(
    backend: SecureStoreBackend,
    options: OsKeystoreStorageOptions,
  ): Promise<OsKeystoreStorage> {
    let available: boolean;
    try {
      available = await backend.isAvailableAsync();
    } catch (cause) {
      throw new SecurityError(SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE, cause);
    }
    if (!available) throw new SecurityError(SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE);

    // Whether an accessibility choice is required depends on whether the
    // platform has one, and the backend answers that: the constants come from
    // the native module, so they exist on iOS and not on Android.
    //
    // Requiring one unconditionally is what broke Android. The guard was right
    // about iOS — the library default is WHEN_UNLOCKED, under which every read
    // fails while the screen is locked — but on Android there is no such
    // setting to choose, `AFTER_FIRST_UNLOCK` is `undefined`, and demanding a
    // number made secure storage impossible to construct at all. The rule is
    // therefore conditional, and still fails closed on the platform that has
    // a dangerous default.
    const platformHasAccessibility = typeof backend.AFTER_FIRST_UNLOCK === 'number';

    if (platformHasAccessibility && typeof options.keychainAccessible !== 'number') {
      // iOS without an explicit choice would silently take WHEN_UNLOCKED.
      throw new SecurityError(SecurityErrorCode.SECURE_STORAGE_MISCONFIGURED);
    }
    if (!platformHasAccessibility && options.keychainAccessible !== undefined) {
      // A value here would be dropped by the native module, leaving the caller
      // believing it had set a policy that does not exist on this platform.
      throw new SecurityError(SecurityErrorCode.SECURE_STORAGE_MISCONFIGURED);
    }

    return new OsKeystoreStorage(backend, options);
  }

  async get(key: string): Promise<string | null> {
    // Deliberately not wrapped: a throw here means the entry may exist and be
    // unreadable, and callers distinguish that from absence. Swallowing it and
    // returning null is the bug that orphans a user's records.
    return this.backend.getItemAsync(key, this.itemOptions);
  }

  async set(key: string, value: string): Promise<void> {
    await this.backend.setItemAsync(key, value, this.itemOptions);
    this.written.add(key);
  }

  async remove(key: string): Promise<void> {
    await this.backend.deleteItemAsync(key, this.itemOptions);
    this.written.delete(key);
  }

  /**
   * Removes only what this store wrote.
   *
   * `expo-secure-store` offers no enumeration, and an unscoped wipe is banned
   * by the architecture anyway — it would delete keys belonging to other parts
   * of the application. Keys written by a previous process are not tracked and
   * are not touched; sign-out should remove the specific entries it owns.
   */
  async clear(): Promise<void> {
    const keys = [...this.written];
    for (const key of keys) await this.remove(key);
  }
}
