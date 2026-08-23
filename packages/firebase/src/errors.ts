/**
 * `packages/firebase` may import interfaces and types only, so it cannot use a
 * domain package's error class. It raises this structurally-compatible error
 * instead: the domain and code are checked against the domain's own code union
 * at compile time, and `errorCode()` in `@platform/utils` reads it by shape.
 */
export class ServiceError<Code extends string = string> extends Error {
  constructor(
    public readonly domain: string,
    public readonly code: Code,
    public override readonly cause?: unknown,
  ) {
    super(code);
    this.name = 'ServiceError';
  }

  toJSON(): { domain: string; code: string; name: string } {
    return { domain: this.domain, code: this.code, name: this.name };
  }
}

export function authError(code: string, cause?: unknown): ServiceError {
  return new ServiceError('auth', code, cause);
}

export function dataError(code: string, cause?: unknown): ServiceError {
  return new ServiceError('data', code, cause);
}

export function accountError(code: string, cause?: unknown): ServiceError {
  return new ServiceError('account', code, cause);
}

export function backupError(code: string, cause?: unknown): ServiceError {
  return new ServiceError('backup', code, cause);
}

export function isServiceError(value: unknown, domain?: string): value is ServiceError {
  return value instanceof ServiceError && (domain === undefined || value.domain === domain);
}
