import { describe, expect, it } from 'vitest';
import { assertStrongPassphrase, assessPassphrase } from '../src/passphrase';
import { SecurityErrorCode } from '../src/errors';

describe('assessPassphrase', () => {
  it('accepts a reasonable passphrase', () => {
    expect(assessPassphrase('correct1horse-battery')).toEqual({ ok: true, issues: [] });
  });

  it('rejects a single character, which the old check allowed', () => {
    expect(assessPassphrase('x').ok).toBe(false);
    expect(assessPassphrase('x').issues).toContain('PASSPHRASE_TOO_SHORT');
  });

  it('rejects a long but single-class passphrase', () => {
    expect(assessPassphrase('abcdefghijklmno').issues).toContain('PASSPHRASE_TOO_SIMPLE');
  });

  it('rejects a repeated character run', () => {
    expect(assessPassphrase('aaaaaaaaaaaa1A').issues).toContain('PASSPHRASE_TOO_REPETITIVE');
  });

  it('rejects a common passphrase however it is punctuated', () => {
    expect(assessPassphrase('qwerty-uiop!').issues).toContain('PASSPHRASE_TOO_COMMON');
  });

  it('never echoes the passphrase in the assessment', () => {
    expect(JSON.stringify(assessPassphrase('hunter2'))).not.toContain('hunter2');
  });
});

describe('assertStrongPassphrase', () => {
  it('throws a typed error for a weak passphrase', () => {
    expect(() => assertStrongPassphrase('short')).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.PASSPHRASE_TOO_WEAK }),
    );
  });

  it('passes a strong one through', () => {
    expect(() => assertStrongPassphrase('correct1horse-battery')).not.toThrow();
  });
});
