import type { DataKeyState } from '@platform/security';

/**
 * What the data-key gate should render, decided as data.
 *
 * Separate from the component because this is the part with consequences. The
 * repository has no component-test infrastructure, and adding a React Native
 * renderer to assert one mapping would be a new dependency bought for less
 * confidence than testing the mapping directly. `DataKeyGate` renders what this
 * returns and decides nothing itself.
 */
export type DataKeyStep =
  | 'loading'
  | 'show-code'
  | 'setup'
  | 'recover'
  | 'unlock'
  | 'pair'
  | 'blocked'
  | 'ready';

export function dataKeyStep(
  state: DataKeyState | null,
  pendingRecoveryCode: string | null,
  /**
   * The user chose the trusted-device path instead of typing a recovery code.
   *
   * Only ever honoured from `needs-recovery`. It is not an override: it cannot
   * reach `unusable`, which stays a dead end, and it cannot reach `needs-setup`,
   * where there is no other device holding a key to pair with.
   */
  pairingRequested = false,
): DataKeyStep {
  // The code outranks every state: the key is already stored by this point and
  // the code on screen is the only copy that will ever exist.
  if (pendingRecoveryCode !== null) return 'show-code';
  if (state === null) return 'loading';
  if (pairingRequested && state === 'needs-recovery') return 'pair';
  switch (state) {
    case 'ready':
      return 'ready';
    case 'needs-setup':
      return 'setup';
    case 'needs-recovery':
      return 'recover';
    case 'locked':
      // Never 'recover'. The key is on this device and the recovery code is not
      // needed to reach it; sending the user to recovery here would spend a
      // one-copy secret on a lock the passphrase opens. And never 'setup',
      // which would write over the key that is sitting right there.
      return 'unlock';
    case 'unusable':
      // Never 'setup'. A key is stored and unreadable; creating another over
      // the top of it orphans every record encrypted under the original.
      return 'blocked';
  }
}
