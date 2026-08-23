import { type Result, ok, err } from './result';

export type Validator<T> = (value: T) => string | null;

export function required(field: string): Validator<string | null | undefined> {
  return (value) => (value === null || value === undefined || value.trim().length === 0 ? `${field}_REQUIRED` : null);
}

export function minLength(field: string, length: number): Validator<string> {
  return (value) => (value.length < length ? `${field}_TOO_SHORT` : null);
}

export function maxLength(field: string, length: number): Validator<string> {
  return (value) => (value.length > length ? `${field}_TOO_LONG` : null);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

export function email(field = 'EMAIL'): Validator<string> {
  return (value) => (isEmail(value) ? null : `${field}_INVALID`);
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function inRange(field: string, min: number, max: number): Validator<number> {
  return (value) => (value < min || value > max ? `${field}_OUT_OF_RANGE` : null);
}

/** Runs validators in order and returns the first failure as an error code. */
export function validate<T>(value: T, validators: readonly Validator<T>[]): Result<T, string> {
  for (const validator of validators) {
    const failure = validator(value);
    if (failure) return err(failure);
  }
  return ok(value);
}

export function validateAll(
  checks: ReadonlyArray<readonly [string, string | null]>,
): Result<true, Record<string, string>> {
  const errors: Record<string, string> = {};
  for (const [field, failure] of checks) {
    if (failure) errors[field] = failure;
  }
  return Object.keys(errors).length > 0 ? err(errors) : ok(true);
}
