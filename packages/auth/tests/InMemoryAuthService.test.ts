import { describe, expect, it, vi } from 'vitest';
import { InMemoryAuthService } from '../src/services/InMemoryAuthService';
import { AuthErrorCode } from '../src/errors';

const SEED = [{ email: 'You@Example.com', password: 'correct1horse', displayName: 'You' }];

describe('InMemoryAuthService', () => {
  it('signs in a seeded user regardless of email case', async () => {
    const service = new InMemoryAuthService({ users: SEED });
    const user = await service.signIn({ email: 'YOU@example.com', password: 'correct1horse' });
    expect(user.email).toBe('you@example.com');
    await expect(service.getCurrentUser()).resolves.toMatchObject({ displayName: 'You' });
  });

  it('rejects a wrong password with the same code as a missing account', async () => {
    const service = new InMemoryAuthService({ users: SEED });
    await expect(service.signIn({ email: 'you@example.com', password: 'wrong' })).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CREDENTIALS,
    });
    await expect(service.signIn({ email: 'nobody@example.com', password: 'x' })).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CREDENTIALS,
    });
  });

  it('never exposes the password on the returned user', async () => {
    const service = new InMemoryAuthService({ users: SEED });
    const user = await service.signIn({ email: 'you@example.com', password: 'correct1horse' });
    expect(JSON.stringify(user)).not.toContain('correct1horse');
  });

  it('refuses a duplicate signup', async () => {
    const service = new InMemoryAuthService({ users: SEED });
    await expect(
      service.signUp({ email: 'you@example.com', password: 'another1pass' }),
    ).rejects.toMatchObject({ code: AuthErrorCode.EMAIL_ALREADY_IN_USE });
  });

  it('starts signed in when asked, and notifies listeners on sign out', async () => {
    const service = new InMemoryAuthService({ users: SEED, signedInAs: 'you@example.com' });
    const listener = vi.fn();
    service.onAuthStateChanged(listener);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ email: 'you@example.com' }));

    await service.signOut();
    expect(listener).toHaveBeenLastCalledWith(null);
    await expect(service.getCurrentUser()).resolves.toBeNull();
  });

  it('stops notifying after unsubscribe', async () => {
    const service = new InMemoryAuthService({ users: SEED });
    const listener = vi.fn();
    service.onAuthStateChanged(listener)();
    await service.signIn({ email: 'you@example.com', password: 'correct1horse' });
    expect(listener).toHaveBeenCalledTimes(1); // the initial call only
  });

  it('checks the current password on re-authentication', async () => {
    const service = new InMemoryAuthService({ users: SEED, signedInAs: 'you@example.com' });
    await expect(service.reauthenticate('correct1horse')).resolves.toBeUndefined();
    await expect(service.reauthenticate('wrong')).rejects.toMatchObject({
      code: AuthErrorCode.INVALID_CREDENTIALS,
    });
  });

  it('verifies a device only against an issued code', async () => {
    const service = new InMemoryAuthService({ users: SEED, deviceVerificationCode: '424242' });
    await expect(service.confirmDeviceVerification('d1', '424242')).rejects.toMatchObject({
      code: AuthErrorCode.DEVICE_VERIFICATION_FAILED,
    });
    await service.sendDeviceVerification('d1');
    await expect(service.confirmDeviceVerification('d1', '424242')).resolves.toBeUndefined();
    await expect(service.confirmDeviceVerification('d1', '000000')).rejects.toMatchObject({
      code: AuthErrorCode.DEVICE_VERIFICATION_FAILED,
    });
  });
});
