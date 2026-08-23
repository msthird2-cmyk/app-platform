import { describe, expect, it } from 'vitest';
import { email, inRange, isEmail, minLength, required, validate, validateAll } from '../src/validation';
import { errorCode, isCodedError, CodedError } from '../src/errors';

class TestError extends CodedError {
  readonly domain = 'test';
}

describe('validators', () => {
  it('stops at the first failure', () => {
    const result = validate('', [required('NAME'), minLength('NAME', 3)]);
    expect(result).toEqual({ ok: false, error: 'NAME_REQUIRED' });
  });

  it('passes a valid value through', () => {
    expect(validate('Ada', [required('NAME'), minLength('NAME', 3)])).toEqual({ ok: true, value: 'Ada' });
  });

  it('recognises email shapes', () => {
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(email()('nope')).toBe('EMAIL_INVALID');
  });

  it('collects every field failure', () => {
    const result = validateAll([
      ['name', required('NAME')(''),],
      ['age', inRange('AGE', 18, 120)(5)],
      ['city', null],
    ]);
    expect(result).toEqual({ ok: false, error: { name: 'NAME_REQUIRED', age: 'AGE_OUT_OF_RANGE' } });
  });
});

describe('coded errors', () => {
  it('reads the code from a domain error', () => {
    expect(errorCode(new TestError('BOOM'))).toBe('BOOM');
  });

  it('recognises a structurally compatible error from another package', () => {
    const foreign = Object.assign(new Error('X'), { domain: 'auth', code: 'INVALID_CREDENTIALS' });
    expect(isCodedError(foreign)).toBe(true);
    expect(errorCode(foreign)).toBe('INVALID_CREDENTIALS');
  });

  it('falls back for an unknown throw', () => {
    expect(errorCode('a string')).toBe('UNKNOWN_ERROR');
  });
});
