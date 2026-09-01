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
      null, 'ready', 'needs-setup', 'needs-recovery', 'locked', 'unusable',
    ];
    for (const state of states) {
      expect(dataKeyStep(state, 'K7QM-2XPD-9RTF'), String(state)).toBe('show-code');
    }
  });

  it('never routes any state to setup except needs-setup', () => {
    const states: Array<DataKeyState> = ['ready', 'needs-recovery', 'locked', 'unusable'];
    for (const state of states) {
      expect(dataKeyStep(state, null), state).not.toBe('setup');
    }
  });
});

/**
 * The pairing branch is an alternative to typing a recovery code, and nothing
 * more. The two states where choosing it would be destructive are the two it
 * must not reach.
 */
describe('dataKeyStep — trusted-device pairing', () => {
  it('offers pairing instead of the recovery code when the user asks for it', () => {
    expect(dataKeyStep('needs-recovery', null, true)).toBe('pair');
  });

  it('leaves recovery as the default, so pairing is never automatic', () => {
    expect(dataKeyStep('needs-recovery', null, false)).toBe('recover');
    expect(dataKeyStep('needs-recovery', null)).toBe('recover');
  });

  it('never routes an unreadable key to pairing', () => {
    // Adopting a key over one that is stored and cannot be read orphans every
    // record under the original, exactly as re-running setup would.
    expect(dataKeyStep('unusable', null, true)).toBe('blocked');
  });

  it('never routes a first-time device to pairing', () => {
    // There is no escrow and therefore no other device holding a key. Pairing
    // here would wait forever for a peer that does not exist.
    expect(dataKeyStep('needs-setup', null, true)).toBe('setup');
  });

  it('keeps a freshly generated recovery code ahead of pairing', () => {
    expect(dataKeyStep('needs-recovery', 'ABCD-EFGH-IJKL', true)).toBe('show-code');
  });

  it('does not interrupt a ready application', () => {
    expect(dataKeyStep('ready', null, true)).toBe('ready');
  });
});


/**
 * A locked key is on the device and shut. The two states it must never be
 * confused with are the two that cost something: `needs-setup` writes a new key
 * over it, and `needs-recovery` spends the one-copy recovery code on a lock the
 * passphrase opens.
 */
describe('dataKeyStep — a passphrase-protected key', () => {
  it('asks for the passphrase', () => {
    expect(dataKeyStep('locked', null)).toBe('unlock');
  });

  it('never offers setup or recovery for it', () => {
    const step = dataKeyStep('locked', null);
    expect(step).not.toBe('setup');
    expect(step).not.toBe('recover');
  });

  it('does not let the pairing request divert it', () => {
    // Pairing is the alternative to typing a recovery code on a device that
    // has no key. This device has one; adopting another would replace it and
    // drop the protection with it.
    expect(dataKeyStep('locked', null, true)).toBe('unlock');
  });

  it('renders the application once the passphrase has opened it', () => {
    // The lifecycle reports `ready` after an unlock, identically to an
    // unprotected device — downstream of the gate they are the same thing.
    expect(dataKeyStep('ready', null)).toBe('ready');
  });
});
