/**
 * Services throw typed, coded errors and never contain user-facing copy.
 * Applications map codes to messages.
 */
export abstract class CodedError extends Error {
  abstract readonly domain: string;

  constructor(
    public readonly code: string,
    public override readonly cause?: unknown,
  ) {
    super(code);
    this.name = new.target.name;
  }

  toJSON(): { domain: string; code: string; name: string } {
    return { domain: this.domain, code: this.code, name: this.name };
  }
}

export class ValidationError extends CodedError {
  readonly domain = 'validation';
}

/**
 * The structural contract of a coded error. Checked by shape rather than by
 * `instanceof`, so an error raised across a package boundary — by a Firebase
 * adapter, say — is still recognised as its domain's error.
 */
export interface CodedErrorLike {
  domain: string;
  code: string;
}

export function isCodedError(value: unknown): value is CodedErrorLike {
  if (value instanceof CodedError) return true;
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CodedErrorLike>;
  return typeof candidate.domain === 'string' && typeof candidate.code === 'string';
}

/** Narrow an unknown thrown value to a code, without leaking its payload. */
export function errorCode(value: unknown, fallback = 'UNKNOWN_ERROR'): string {
  return isCodedError(value) ? value.code : fallback;
}
