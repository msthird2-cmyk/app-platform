import { describe, expect, it } from 'vitest';
import { signOutPlan, type SignOutStep } from '../src/signOutPlan';

/**
 * F-05's ordering, as data.
 *
 * The order is the whole point: the identity exists before `signOut()` and is
 * gone after it, so a clear that runs second has nothing to address.
 */
describe('signOutPlan', () => {
  it('clears the data key strictly before signing out', () => {
    const { steps } = signOutPlan('user-1');
    expect(steps).toEqual<SignOutStep[]>(['clear-data-key', 'sign-out']);
    expect(steps.indexOf('clear-data-key')).toBeLessThan(steps.indexOf('sign-out'));
  });

  it('names the owner whose record is to be cleared', () => {
    expect(signOutPlan('user-1').owner).toBe('user-1');
  });

  it('refuses an empty identity', () => {
    // `custodyAddressFor` also rejects this, but by then the caller has already
    // decided to destroy something. Refusing here means never reaching a clear
    // that does not know what it is clearing.
    expect(() => signOutPlan('')).toThrow('SIGN_OUT_IDENTITY_REQUIRED');
  });

  it('refuses an identity that is not a string', () => {
    expect(() => signOutPlan(undefined as unknown as string)).toThrow('SIGN_OUT_IDENTITY_REQUIRED');
  });

  it('does not trim or normalise the identity', () => {
    // The authentication provider decides what two identifiers mean. A
    // normalisation here could clear a different person's record.
    expect(signOutPlan(' user-1 ').owner).toBe(' user-1 ');
  });
});
