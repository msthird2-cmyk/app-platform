import { describe, expect, it } from 'vitest';
import { dataKeyStep } from '../src/dataKeyStep';
import type { DataKeyState } from '@platform/security';

/**
 * The gate's decision, which is the part that can lose data.
 *
 * The consequential case is `unusable`: a key is stored and cannot be read, and
 * anything that routes it to first-time setup writes a new key over a real one
 * and orphans every record encrypted under the original.
 */
describe('dataKeyStep', () => {
  it('renders the application only when the key is ready', () => {
    expect(dataKeyStep('ready', null)).toBe('ready');
  });

  it('offers setup only when there is genuinely no key', () => {
    expect(dataKeyStep('needs-setup', null)).toBe('setup');
  });

  it('offers recovery when an escrow exists but the key does not', () => {
    expect(dataKeyStep('needs-recovery', null)).toBe('recover');
  });

  it('blocks, and never offers setup, when the stored key is unreadable', () => {
    expect(dataKeyStep('unusable', null)).toBe('blocked');
  });

  it('waits rather than assuming anything before the status is known', () => {
    expect(dataKeyStep(null, null)).toBe('loading');
  });

  it('shows a freshly generated code ahead of every other state', () => {
    // The key is already stored by this point and the code is the only copy;
    // navigating away from it before the user has written it down would lose
    // their recovery path.
    const states: Array<DataKeyState | null> = [
      null, 'ready', 'needs-setup', 'needs-recovery', 'unusable',
    ];
    for (const state of states) {
      expect(dataKeyStep(state, 'K7QM-2XPD-9RTF'), String(state)).toBe('show-code');
    }
  });

  it('never routes any state to setup except needs-setup', () => {
    const states: Array<DataKeyState> = ['ready', 'needs-recovery', 'unusable'];
    for (const state of states) {
      expect(dataKeyStep(state, null), state).not.toBe('setup');
    }
  });
});
