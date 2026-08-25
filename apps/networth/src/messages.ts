/**
 * Services throw codes; the application owns the copy. One map per app.
 */
const MESSAGES: Record<string, string> = {
  EMAIL_REQUIRED: 'Enter your email address.',
  EMAIL_INVALID: 'That email address does not look right.',
  PASSWORD_REQUIRED: 'Enter your password.',
  PASSWORD_TOO_SHORT: 'Use at least 10 characters.',
  PASSWORD_NEEDS_NUMBER: 'Include at least one number.',
  PASSWORD_NEEDS_LETTER: 'Include at least one letter.',
  INVALID_CREDENTIALS: 'That email and password do not match.',
  EMAIL_ALREADY_IN_USE: 'An account already exists for this email.',
  WEAK_PASSWORD: 'Choose a stronger password.',
  USER_NOT_FOUND: 'We could not find that account.',
  REAUTHENTICATION_REQUIRED: 'Sign in again to continue.',
  DEVICE_VERIFICATION_FAILED: 'That code did not work. Try another.',
  NETWORK_ERROR: 'You appear to be offline.',
  ACCOUNT_DELETION_FAILED: 'We could not delete your account. Nothing was lost.',
  DATA_DELETION_FAILED: 'We could not delete your data. Nothing was lost.',
  BACKUP_FAILED: 'The backup did not finish.',
  RESTORE_FAILED: 'The restore did not finish. Your data is unchanged.',
  PASSPHRASE_REQUIRED: 'Enter your backup passphrase.',
  PASSPHRASE_TOO_WEAK:
    'Choose a longer backup passphrase — at least 12 characters, mixing letters and numbers.',
  EMAIL_NOT_VERIFIED: 'Confirm your email address before adding records.',
  EMAIL_VERIFICATION_FAILED: 'We could not send the confirmation email. Try again.',
  DEVICE_VERIFICATION_UNAVAILABLE: 'Device verification is not available in this version.',
  SECURE_STORAGE_UNAVAILABLE: 'This device cannot store your session securely.',
  BACKUP_CORRUPT: 'That backup does not belong to this app or account.',
  UNKNOWN_ERROR: 'Something went wrong. Try again.',
};

export function messageForCode(code: string): string {
  return MESSAGES[code] ?? MESSAGES.UNKNOWN_ERROR!;
}
