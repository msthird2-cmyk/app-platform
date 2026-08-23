/**
 * Safe-by-default logging. Sensitive keys are redacted before anything is
 * emitted, so a whole request or response object can never leak a password,
 * token, recovery code or financial record.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY = new RegExp(
  [
    'password',
    'passcode',
    'pin',
    'secret',
    'token',
    'accesstoken',
    'refreshtoken',
    'credential',
    'authorization',
    'recoverycode',
    'recoverycodes',
    'encryptionkey',
    'key',
    'iv',
    'salt',
    'ciphertext',
    'payload',
    'balance',
    'amount',
    'accountnumber',
    'pan',
    'email',
    'phone',
    'dob',
  ].join('|'),
  'i',
);

export const REDACTED = '[redacted]';

export interface LogSink {
  write(level: LogLevel, message: string, context?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  scope?: string;
  sink?: LogSink;
}

const consoleSink: LogSink = {
  write(level, message, context) {
    const line = context ? `${message} ${JSON.stringify(context)}` : message;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  },
};

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? consoleSink;
  const scope = options.scope;

  const emit = (at: LogLevel, message: string, context?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[at] < LEVEL_ORDER[level]) return;
    const prefixed = scope ? `[${scope}] ${message}` : message;
    sink.write(at, prefixed, context ? (redact(context) as Record<string, unknown>) : undefined);
  };

  return {
    debug: (message, context) => emit('debug', message, context),
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
    child: (childScope) =>
      createLogger({ ...options, scope: scope ? `${scope}:${childScope}` : childScope }),
  };
}

/** Production-safe default: warnings and errors only, always redacted. */
export const logger = createLogger({ level: 'warn' });
