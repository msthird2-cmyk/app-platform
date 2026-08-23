import { type Result, err, ok, isEmail } from '@platform/utils';

export interface PasswordPolicy {
  minLength: number;
  requireNumber: boolean;
  requireLetter: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireNumber: true,
  requireLetter: true,
};

export type CredentialIssue =
  | 'EMAIL_REQUIRED'
  | 'EMAIL_INVALID'
  | 'PASSWORD_REQUIRED'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_NEEDS_NUMBER'
  | 'PASSWORD_NEEDS_LETTER';

export function validateEmail(email: string): Result<string, CredentialIssue> {
  const trimmed = email.trim();
  if (trimmed.length === 0) return err('EMAIL_REQUIRED');
  if (!isEmail(trimmed)) return err('EMAIL_INVALID');
  return ok(trimmed.toLowerCase());
}

export function validatePassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): Result<string, CredentialIssue> {
  if (password.length === 0) return err('PASSWORD_REQUIRED');
  if (password.length < policy.minLength) return err('PASSWORD_TOO_SHORT');
  if (policy.requireNumber && !/\d/.test(password)) return err('PASSWORD_NEEDS_NUMBER');
  if (policy.requireLetter && !/[a-zA-Z]/.test(password)) return err('PASSWORD_NEEDS_LETTER');
  return ok(password);
}

export function validateCredentials(
  email: string,
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): Result<{ email: string; password: string }, CredentialIssue> {
  const emailResult = validateEmail(email);
  if (!emailResult.ok) return emailResult;
  const passwordResult = validatePassword(password, policy);
  if (!passwordResult.ok) return passwordResult;
  return ok({ email: emailResult.value, password: passwordResult.value });
}
