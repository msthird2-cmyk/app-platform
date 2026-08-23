import { describe, expect, it } from 'vitest';
import { createLogger, redact, redactText, REDACTED, type LogLevel } from '../src/logger';

function capture() {
  const lines: Array<{ level: LogLevel; message: string; context?: Record<string, unknown> }> = [];
  return {
    lines,
    sink: {
      write(level: LogLevel, message: string, context?: Record<string, unknown>) {
        lines.push(context ? { level, message, context } : { level, message });
      },
    },
  };
}

describe('redact', () => {
  it('redacts any key that is not explicitly loggable', () => {
    const result = redact({
      user: { email: 'someone@example.com', displayName: 'Someone' },
      auth: { accessToken: 'abc' },
    }) as Record<string, unknown>;
    expect(result.user).toBe(REDACTED);
    expect(result.auth).toBe(REDACTED);
  });

  // The previous denylist matched `amount` and `balance` and therefore missed
  // every other field name the applications actually use.
  it.each([
    'value', 'outstanding', 'netWorth', 'invested', 'units', 'pricePerUnit',
    'currentPrice', 'monthlyLimit', 'spent', 'limit', 'description',
    'displayName', 'name', 'amount', 'balance', 'password', 'accessToken',
  ])('redacts the domain field %s', (field) => {
    const result = redact({ [field]: 'sensitive' }) as Record<string, unknown>;
    expect(result[field]).toBe(REDACTED);
  });

  it('keeps the counts and identifiers that make logs useful', () => {
    expect(
      redact({ collection: 'assets', pushed: 3, pulled: 1, unchanged: 0, appName: 'Net Worth' }),
    ).toEqual({ collection: 'assets', pushed: 3, pulled: 1, unchanged: 0, appName: 'Net Worth' });
  });

  it('reduces an Error to its name and code, never its message', () => {
    const error = Object.assign(new Error('failed for user@example.com'), { code: 'BOOM' });
    expect(redact({ reason: error })).toEqual({ reason: { errorName: 'Error', code: 'BOOM' } });
  });

  it('redacts nested objects under an allowlisted key', () => {
    const result = redact({ reason: { secretField: 'x', code: 'BOOM' } }) as Record<string, unknown>;
    expect(result.reason).toEqual({ secretField: REDACTED, code: 'BOOM' });
  });

  it('stops recursing on deeply nested structures', () => {
    let deep: Record<string, unknown> = { code: 'x' };
    for (let i = 0; i < 12; i += 1) deep = { reason: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});

describe('redactText', () => {
  it('masks email addresses and long digit runs in free text', () => {
    expect(redactText('sync failed for a@b.com')).toBe(`sync failed for ${REDACTED}`);
    expect(redactText('account 1234567890 rejected')).toBe(`account ${REDACTED} rejected`);
  });

  it('leaves ordinary text and small numbers alone', () => {
    expect(redactText('pushed 12 records')).toBe('pushed 12 records');
  });
});

describe('createLogger', () => {
  it('is safe by default: warnings and errors only', () => {
    const { lines, sink } = capture();
    const log = createLogger({ sink });
    log.debug('ignored');
    log.info('ignored');
    log.warn('kept');
    log.error('kept');
    expect(lines.map((line) => line.message)).toEqual(['kept', 'kept']);
  });

  it('redacts context before it reaches the sink', () => {
    const { lines, sink } = capture();
    createLogger({ level: 'debug', sink }).info('sign in', { password: 'hunter2', attempt: 1 });
    expect(lines[0]!.context).toEqual({ password: REDACTED, attempt: 1 });
  });

  it('redacts the message as well as the context', () => {
    const { lines, sink } = capture();
    createLogger({ level: 'debug', sink }).warn('lookup failed for person@example.com');
    expect(lines[0]!.message).toBe(`lookup failed for ${REDACTED}`);
  });

  it('nests child scopes', () => {
    const { lines, sink } = capture();
    createLogger({ level: 'debug', sink, scope: 'data' }).child('sync').info('done');
    expect(lines[0]!.message).toBe('[data:sync] done');
  });
});
