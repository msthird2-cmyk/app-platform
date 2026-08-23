import { describe, expect, it } from 'vitest';
import { assertRegistered, getOrCreateDeviceId, type RegisteredDevice } from '../src/deviceRegistration';
import { InMemorySecureStorage } from '../src/services/InMemorySecureStorage';
import { SecurityErrorCode } from '../src/errors';

describe('device registration', () => {
  it('creates an id once and reuses it', async () => {
    const storage = new InMemorySecureStorage();
    const first = await getOrCreateDeviceId(storage);
    const second = await getOrCreateDeviceId(storage);
    expect(first).toBe(second);
    expect(first).toHaveLength(24);
  });

  it('rejects an unregistered device with a typed code', () => {
    const devices: RegisteredDevice[] = [
      { deviceId: 'a', name: 'Pixel', platform: 'android', registeredAt: 1, lastSeenAt: 2 },
    ];
    expect(assertRegistered(devices, 'a').name).toBe('Pixel');
    expect(() => assertRegistered(devices, 'b')).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.DEVICE_NOT_REGISTERED }),
    );
  });
});
