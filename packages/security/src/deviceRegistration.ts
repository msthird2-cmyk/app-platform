import { createId } from '@platform/utils';
import { SecurityError, SecurityErrorCode } from './errors';

export interface RegisteredDevice {
  deviceId: string;
  name: string;
  platform: 'ios' | 'android' | 'web';
  registeredAt: number;
  lastSeenAt: number;
}

export interface DeviceRegistry {
  list(): Promise<RegisteredDevice[]>;
  register(device: RegisteredDevice): Promise<void>;
  revoke(deviceId: string): Promise<void>;
}

const DEVICE_KEY = 'platform.deviceId';

/** The subset of secure storage a device identifier needs. */
export interface MinimalSecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Stable per-install identifier. Not a secret and not an authentication
 * factor — it labels an install so a user can recognise and revoke it.
 */
export async function getOrCreateDeviceId(storage: MinimalSecureStorage): Promise<string> {
  const existing = await storage.get(DEVICE_KEY);
  if (existing) return existing;
  const deviceId = createId(24);
  await storage.set(DEVICE_KEY, deviceId);
  return deviceId;
}

export function assertRegistered(devices: readonly RegisteredDevice[], deviceId: string): RegisteredDevice {
  const device = devices.find((candidate) => candidate.deviceId === deviceId);
  if (!device) throw new SecurityError(SecurityErrorCode.DEVICE_NOT_REGISTERED);
  return device;
}
