import type { ProtectionTier } from '../protectionTier';

/**
 * A key-value store for secret material.
 *
 * `protection` is part of the contract, not documentation: callers that persist
 * secrets compare it against the tier they require and refuse to write to a
 * store that cannot meet it. An implementation must report the tier it actually
 * provides — see `ProtectionTier` for why this is a tier rather than a
 * hardware-backed boolean.
 */
export interface SecureStorage {
  readonly protection: ProtectionTier;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface BiometricsService {
  isAvailable(): Promise<boolean>;
  authenticate(reason: string): Promise<boolean>;
}
