import { describe, expect, it } from 'vitest';
import { createLogger, redact, REDACTED, type LogLevel } from '../src/logger';

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
  it('removes sensitive keys at any depth', () => {
    const result = redact({
      user: { email: 'someone@example.com', displayName: 'Someone' },
      auth: { accessToken: 'abc', nested: { refreshToken: 'def' } },
    }) as Record<string, Record<string, unknown>>;

    expect(result.user!.email).toBe(REDACTED);
    expect(result.user!.displayName).toBe('Someone');
    expect(result.auth!.accessToken).toBe(REDACTED);
    expect((result.auth!.nested as Record<string, unknown>).refreshToken).toBe(REDACTED);
  });

  it('redacts financial values', () => {
    const result = redact({ record: { amount: 125000, balance: 4200, label: 'Salary' } }) as {
      record: Record<string, unknown>;
    };
    expect(result.record.amount).toBe(REDACTED);
    expect(result.record.balance).toBe(REDACTED);
    expect(result.record.label).toBe('Salary');
  });

  it('reduces an Error to its name and message', () => {
    expect(redact(new Error('boom'))).toEqual({ name: 'Error', message: 'boom' });
  });

  it('stops recursing on deeply nested structures', () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 12; i += 1) deep = { child: deep };
    expect(() => redact(deep)).not.toThrow();
  });
});

describe('createLogger', () => {
  it('honours the level threshold', () => {
    const { lines, sink } = capture();
    const log = createLogger({ level: 'warn', sink });
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

  it('nests child scopes', () => {
    const { lines, sink } = capture();
    createLogger({ level: 'debug', sink, scope: 'data' }).child('sync').info('done');
    expect(lines[0]!.message).toBe('[data:sync] done');
  });
});
