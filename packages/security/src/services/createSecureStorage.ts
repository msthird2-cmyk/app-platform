import { SecurityError, SecurityErrorCode } from '../errors';
import type { SecureStorage } from '../types/storage';
import {
  OsKeystoreStorage,
  type SecureStoreBackend,
} from './OsKeystoreStorage';
import {
  WebNonExtractableStorage,
  type KeyValueDatabase,
  type SubtleLike,
} from './WebNonExtractableStorage';

/**
 * Picks the strongest secure storage the runtime can actually provide.
 *
 * Capability detection rather than `Platform.OS`, for the same reason
 * `createCryptoService` detects `crypto.subtle`: what matters is whether a
 * keystore is reachable, not which operating system is underneath. It also
 * keeps this module free of any React Native import.
 *
 * There is no fallback below the two real tiers. A runtime that offers neither
 * gets an error, not an in-memory store dressed up as secure — that is the
 * whole point of the tier system.
 */
export interface PlatformSecureStorageOptions {
  /**
   * The `expo-secure-store` module, on React Native. Passed in rather than
   * imported so the shared package acquires no Expo dependency.
   */
  secureStore?: SecureStoreBackend | undefined;
  /**
   * Pass `SecureStore.AFTER_FIRST_UNLOCK` — on every platform, unconditionally.
   *
   * On iOS that is a number and is required, because the library's
   * `WHEN_UNLOCKED` default makes every read fail while the screen is locked,
   * which is exactly when background sync runs. On Android the same expression
   * evaluates to `undefined`, because the platform has no such setting, and
   * passing it through is correct there too. `OsKeystoreStorage` enforces the
   * rule for whichever platform the injected backend turns out to be.
   */
  keychainAccessible?: number | undefined;
  keychainService?: string | undefined;

  /** Browser fallback. All three are needed together. */
  subtle?: SubtleLike | undefined;
  database?: KeyValueDatabase | undefined;
  randomBytes?: ((length: number) => Uint8Array) | undefined;
}

export async function createPlatformSecureStorage(
  options: PlatformSecureStorageOptions,
): Promise<SecureStorage> {
  const { secureStore, keychainAccessible, subtle, database, randomBytes } = options;

  if (secureStore) {
    // No accessibility check here. It lives in OsKeystoreStorage.create, which
    // has the backend in hand and so can tell iOS from Android; duplicating it
    // here is how this selector came to reject Android outright.
    return OsKeystoreStorage.create(secureStore, {
      ...(keychainAccessible === undefined ? {} : { keychainAccessible }),
      ...(options.keychainService === undefined
        ? {}
        : { keychainService: options.keychainService }),
    });
  }

  if (subtle && database && randomBytes) {
    return WebNonExtractableStorage.create({ subtle, database, randomBytes });
  }

  throw new SecurityError(SecurityErrorCode.SECURE_STORAGE_UNAVAILABLE);
}
