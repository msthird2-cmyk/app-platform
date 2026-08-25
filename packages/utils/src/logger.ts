/**
 * Logging that is safe because it does not trust the caller.
 *
 * Context is filtered by an **allowlist**: a key that is not explicitly known
 * to be non-sensitive is redacted, so adding a field to a domain type can never
 * silently start logging it. Free text in the message is scanned for the
 * patterns that most often carry identifiers.
 *
 * This replaces an earlier denylist that matched key names such as `password`
 * and `amount` and therefore missed `value`, `outstanding`, `netWorth` and most
 * other field names the applications actually use.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Keys whose values are known to carry no personal, financial or secret data:
 * counts, durations, enum-like states and the platform's own identifiers.
 * Everything else is redacted. Keep this list short and justify additions.
 */
const LOGGABLE_KEYS: ReadonlySet<string> = new Set([
  'appName',
  'attempt',
  'attempts',
  'code',
  'collection',
  'collections',
  'count',
  'domain',
  'durationMs',
  'errorName',
  'level',
  'ok',
  'outcome',
  'phase',
  'platform',
  'pulled',
  'pushed',
  'reason',
  'recordCount',
  'restored',
  'schemaVersion',
  'scope',
  'step',
  'stepCount',
  'steps',
  'unchanged',
  'version',
]);

export const REDACTED = '[redacted]';

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
/** Six or more consecutive digits: account numbers, amounts, identifiers. */
const LONG_DIGIT_RUN = /\d{6,}/g;

/** Masks the patterns most likely to carry an identifier out of free text. */
export function redactText(value: string): string {
  return value.replace(EMAIL_PATTERN, REDACTED).replace(LONG_DIGIT_RUN, REDACTED);
}

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

function redactValue(value: unknown, depth: number): unknown {
  if (depth > 4) return REDACTED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (value instanceof Error) return { errorName: value.name, code: readCode(value) };
  if (typeof value === 'object') return redactObject(value as Record<string, unknown>, depth + 1);
  return REDACTED;
}

function readCode(error: Error): string {
  const candidate = (error as unknown as { code?: unknown }).code;
  return typeof candidate === 'string' ? candidate : 'UNKNOWN_ERROR';
}

function redactObject(input: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = LOGGABLE_KEYS.has(key) ? redactValue(value, depth) : REDACTED;
  }
  return out;
}

/**
 * Redacts a value for logging. Object keys outside {@link LOGGABLE_KEYS} are
 * replaced wholesale; an `Error` is reduced to its name and code, never its
 * message, which routinely quotes the input that failed.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, 0);
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  // Safe by default: warnings and errors only unless an application opts in.
  const level = options.level ?? 'warn';
  const sink = options.sink ?? consoleSink;
  const scope = options.scope;

  const emit = (at: LogLevel, message: string, context?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[at] < LEVEL_ORDER[level]) return;
    const safeMessage = redactText(message);
    const prefixed = scope ? `[${scope}] ${safeMessage}` : safeMessage;
    sink.write(at, prefixed, context ? redactObject(context, 0) : undefined);
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
export const logger = createLogger();
