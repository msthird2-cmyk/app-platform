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
export type DataKeyStep = 'loading' | 'show-code' | 'setup' | 'recover' | 'blocked' | 'ready';

export function dataKeyStep(
  state: DataKeyState | null,
  pendingRecoveryCode: string | null,
): DataKeyStep {
  // The code outranks every state: the key is already stored by this point and
  // the code on screen is the only copy that will ever exist.
  if (pendingRecoveryCode !== null) return 'show-code';
  if (state === null) return 'loading';
  switch (state) {
    case 'ready':
      return 'ready';
    case 'needs-setup':
      return 'setup';
    case 'needs-recovery':
      return 'recover';
    case 'unusable':
      // Never 'setup'. A key is stored and unreadable; creating another over
      // the top of it orphans every record encrypted under the original.
      return 'blocked';
  }
}
