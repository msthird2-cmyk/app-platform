import { describe, expect, it } from 'vitest';
import { validateCredentials, validateEmail, validatePassword } from '../src/credentials';

describe('validateEmail', () => {
  it('normalizes a valid address', () => {
    expect(validateEmail('  Person@Example.COM ')).toEqual({ ok: true, value: 'person@example.com' });
  });

  it('reports an empty address separately from an invalid one', () => {
    expect(validateEmail('')).toEqual({ ok: false, error: 'EMAIL_REQUIRED' });
    expect(validateEmail('person@')).toEqual({ ok: false, error: 'EMAIL_INVALID' });
  });
});

describe('validatePassword', () => {
  it('enforces the policy', () => {
    expect(validatePassword('')).toEqual({ ok: false, error: 'PASSWORD_REQUIRED' });
    expect(validatePassword('short1')).toEqual({ ok: false, error: 'PASSWORD_TOO_SHORT' });
    expect(validatePassword('alllettershere')).toEqual({ ok: false, error: 'PASSWORD_NEEDS_NUMBER' });
    expect(validatePassword('1234567890')).toEqual({ ok: false, error: 'PASSWORD_NEEDS_LETTER' });
    expect(validatePassword('correct1horse')).toEqual({ ok: true, value: 'correct1horse' });
  });

  it('never echoes the password in the failure', () => {
    const result = validatePassword('secret');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

describe('validateCredentials', () => {
  it('reports the email problem before the password problem', () => {
    expect(validateCredentials('bad', 'short')).toEqual({ ok: false, error: 'EMAIL_INVALID' });
  });

  it('returns the normalized pair', () => {
    expect(validateCredentials('A@B.co', 'correct1horse')).toEqual({
      ok: true,
      value: { email: 'a@b.co', password: 'correct1horse' },
    });
  });
});
