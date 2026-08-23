/**
 * A key-value store for secret material.
 *
 * `isHardwareBacked` is part of the contract, not documentation: callers that
 * persist token material check it and refuse to write to a store that cannot
 * protect it. An implementation must not claim it unless the platform really
 * provides a keystore, keychain or equivalent.
 */
export interface SecureStorage {
  readonly isHardwareBacked: boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface BiometricsService {
  isAvailable(): Promise<boolean>;
  authenticate(reason: string): Promise<boolean>;
}
