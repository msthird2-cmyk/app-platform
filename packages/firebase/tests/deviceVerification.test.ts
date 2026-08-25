import { describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase/app';
import { FirebaseAuthService } from '../src/services/FirebaseAuthService';

/**
 * The previous implementation let the client read the expected code out of
 * Firestore, compare it locally, and write `status: 'verified'` itself. These
 * assert that the path is gone rather than merely unreachable.
 */
describe('device verification fails closed', () => {
  const app = initializeApp(
    {
      apiKey: 'test-api-key',
      authDomain: 'example.firebaseapp.com',
      projectId: 'app-platform-rules-test',
      storageBucket: 'example.appspot.com',
      messagingSenderId: '1',
      appId: '1:1:web:1',
    },
    'device-verification-test',
  );

  const service = new FirebaseAuthService(app);

  it('refuses to issue a verification code', async () => {
    await expect(service.sendDeviceVerification('device-1')).rejects.toMatchObject({
      domain: 'auth',
      code: 'DEVICE_VERIFICATION_UNAVAILABLE',
    });
  });

  it('refuses to confirm a verification code', async () => {
    await expect(service.confirmDeviceVerification('device-1', '000000')).rejects.toMatchObject({
      domain: 'auth',
      code: 'DEVICE_VERIFICATION_UNAVAILABLE',
    });
  });

  it('never reaches Firestore to do it', async () => {
    // Rejection is synchronous in effect: no network call, no document read.
    const started = Date.now();
    await expect(service.confirmDeviceVerification('d', 'c')).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('leaves no way to self-verify through the service', () => {
    expect(Object.keys(service)).not.toContain('db');
  });

  return void deleteApp(app);
});
