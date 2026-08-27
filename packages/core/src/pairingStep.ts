import type { PairingFailureReason, PairingPhase, PairingRole } from '@platform/security';

/**
 * What the pairing screen should render, decided as data.
 *
 * The same separation as `dataKeyStep`, for the same reason: the repository has
 * no component-test infrastructure, so the decisions worth asserting live in a
 * function that can be called directly, and `PairingFlow` renders what it
 * returns without deciding anything itself.
 */
export type PairingUiStep =
  | 'idle'
  | 'waiting'
  | 'compare-code'
  | 'transferring'
  | 'done'
  | 'error';

export function pairingStep(phase: PairingPhase, code: string | null): PairingUiStep {
  switch (phase) {
    case 'idle':
      return 'idle';
    case 'offering':
    case 'awaiting-peer':
      return 'waiting';
    case 'compare-code':
      // The digits are the entire security control. Without them there is
      // nothing for a person to compare, so there is no confirm button either.
      return code === null ? 'waiting' : 'compare-code';
    case 'transferring':
      return 'transferring';
    case 'complete':
      return 'done';
    case 'failed':
      return 'error';
  }
}

/**
 * One message per class of failure, and deliberately not one per cause.
 *
 * A wrong code, a substituted public key and a tampered envelope are the same
 * sentence on screen. Telling a person which of those happened tells whoever
 * caused it which attempt got closer, and none of the three leaves them with a
 * different action to take.
 */
export function pairingFailureMessage(reason: PairingFailureReason | null): string {
  switch (reason) {
    case 'custody-present':
      return 'This device already has your encryption key, so there is nothing to pair.';
    case 'custody-unusable':
      return 'This device has a stored key it cannot read, so it cannot pair. '
        + 'Pairing over it would leave your existing records unreadable.';
    case 'custody-unavailable':
      return 'This device does not hold your encryption key, so it cannot share it.';
    case 'expired':
      return 'The pairing timed out. Start a new one on your other device.';
    case 'consumed':
      return 'That pairing has already been used. Start a new one on your other device.';
    case 'session-missing':
      return 'No pairing was found with that code. Check it and try again.';
    case 'relay-unavailable':
      return 'Could not reach your other device. Check the connection and try again.';
    case 'cancelled':
      return 'Pairing cancelled.';
    default:
      // commitment-mismatch, key-invalid, transfer-failed, session-invalid,
      // state-invalid — every one of them means the transfer did not happen
      // and the safe response is the same.
      return 'Pairing could not be completed safely, so nothing was transferred. '
        + 'Start again, and check that the codes on the two devices match.';
  }
}

/** The one action each role's screen offers before a session exists. */
export function pairingStartLabel(role: PairingRole): string {
  return role === 'initiator' ? 'Pair a new device' : 'Join with a pairing code';
}
