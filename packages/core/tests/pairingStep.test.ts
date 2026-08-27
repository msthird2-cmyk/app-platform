import { describe, expect, it } from 'vitest';
import type { PairingFailureReason, PairingPhase } from '@platform/security';
import { pairingFailureMessage, pairingStartLabel, pairingStep } from '../src/pairingStep';

/**
 * The pairing screen's decisions, which are the ones with consequences.
 *
 * Two of them matter. A screen that offered a confirm button with no digits on
 * it would be asking a person to approve a transfer they cannot check — the
 * comparison *is* the security control. And an error message that named the
 * cause would tell whoever caused it which attempt got closer.
 */
describe('pairingStep', () => {
  it('waits while either device is still to act', () => {
    expect(pairingStep('offering', null)).toBe('waiting');
    expect(pairingStep('awaiting-peer', null)).toBe('waiting');
  });

  it('never offers confirmation without digits to compare', () => {
    expect(pairingStep('compare-code', null)).toBe('waiting');
    expect(pairingStep('compare-code', '123-456')).toBe('compare-code');
  });

  it('maps the terminal phases to their own screens', () => {
    expect(pairingStep('transferring', '123-456')).toBe('transferring');
    expect(pairingStep('complete', '123-456')).toBe('done');
    expect(pairingStep('failed', null)).toBe('error');
    expect(pairingStep('idle', null)).toBe('idle');
  });

  it('covers every phase the session can publish', () => {
    const phases: PairingPhase[] = [
      'idle', 'offering', 'awaiting-peer', 'compare-code', 'transferring', 'complete', 'failed',
    ];
    for (const phase of phases) expect(pairingStep(phase, '123-456')).toBeTypeOf('string');
  });
});

describe('pairingFailureMessage', () => {
  it('says the same thing for every failure that could be an attack', () => {
    const indistinguishable: PairingFailureReason[] = [
      'commitment-mismatch',
      'key-invalid',
      'transfer-failed',
      'session-invalid',
      'state-invalid',
    ];
    const messages = new Set(indistinguishable.map(pairingFailureMessage));
    expect(messages.size).toBe(1);
  });

  it('names the causes a person can actually do something about', () => {
    expect(pairingFailureMessage('expired')).toMatch(/timed out/i);
    expect(pairingFailureMessage('session-missing')).toMatch(/check it/i);
    expect(pairingFailureMessage('custody-present')).toMatch(/already/i);
    expect(pairingFailureMessage('relay-unavailable')).toMatch(/connection/i);
  });

  it('tells a device with an unreadable key why it must not pair', () => {
    // The one case where doing the obvious thing loses data, so the copy says
    // so rather than inviting a retry.
    expect(pairingFailureMessage('custody-unusable')).toMatch(/unreadable|cannot read/i);
  });

  it('never leaks the code or key material into the copy', () => {
    const reasons: Array<PairingFailureReason | null> = [
      null, 'expired', 'consumed', 'cancelled', 'commitment-mismatch', 'custody-unavailable',
    ];
    for (const reason of reasons) {
      const message = pairingFailureMessage(reason);
      expect(message).not.toMatch(/\d{3}-\d{3}/);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe('pairingStartLabel', () => {
  it('names the action from each device point of view', () => {
    expect(pairingStartLabel('initiator')).toBe('Pair a new device');
    expect(pairingStartLabel('responder')).toBe('Join with a pairing code');
  });
});
