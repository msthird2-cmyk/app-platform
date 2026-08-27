import { describe, expect, it } from 'vitest';
import {
  BACKEND_VARIABLE,
  FIREBASE_VARIABLES,
  misconfigurationMessage,
  selectBackend,
} from '../src/config/backend';

/**
 * Where this build's records go, decided as data.
 *
 * The consequential case is the one in the middle: a build that asked for
 * Firebase and cannot have it. Anything that turned that into a preview build
 * would produce an application that looks like it is working while every record
 * goes into a process that is about to exit — the same shape of failure as a
 * silent plaintext fallback, and just as invisible to the person using it.
 */
const COMPLETE = {
  [BACKEND_VARIABLE]: 'firebase',
  [FIREBASE_VARIABLES.apiKey]: 'key',
  [FIREBASE_VARIABLES.authDomain]: 'example.firebaseapp.com',
  [FIREBASE_VARIABLES.projectId]: 'example',
  [FIREBASE_VARIABLES.storageBucket]: 'example.appspot.com',
  [FIREBASE_VARIABLES.messagingSenderId]: '1',
  [FIREBASE_VARIABLES.appId]: '1:1:web:1',
};

describe('selectBackend', () => {
  it('previews when nothing is configured, which is the safe default', () => {
    expect(selectBackend({})).toEqual({ kind: 'preview' });
    expect(selectBackend({ [BACKEND_VARIABLE]: '' })).toEqual({ kind: 'preview' });
    expect(selectBackend({ [BACKEND_VARIABLE]: '  preview ' })).toEqual({ kind: 'preview' });
  });

  it('selects Firebase only when every value is present', () => {
    const selection = selectBackend(COMPLETE);
    expect(selection.kind).toBe('firebase');
    if (selection.kind !== 'firebase') throw new Error('unreachable');
    expect(selection.firebase.projectId).toBe('example');
  });

  it('reports a misconfiguration rather than falling back to preview', () => {
    for (const variable of Object.values(FIREBASE_VARIABLES)) {
      const partial = { ...COMPLETE, [variable]: undefined };
      const selection = selectBackend(partial);
      expect(selection.kind).toBe('misconfigured');
      if (selection.kind !== 'misconfigured') throw new Error('unreachable');
      expect(selection.reason).toBe('missing-configuration');
      expect(selection).toHaveProperty('missing', [variable]);
    }
  });

  it('treats a blank value as missing, not as configured', () => {
    // A CI variable that exists and is empty is a forgotten value, and the one
    // most likely to reach a release.
    const selection = selectBackend({ ...COMPLETE, [FIREBASE_VARIABLES.apiKey]: '   ' });
    expect(selection.kind).toBe('misconfigured');
  });

  it('names every missing value at once, so it takes one round trip to fix', () => {
    const selection = selectBackend({ [BACKEND_VARIABLE]: 'firebase' });
    if (selection.kind !== 'misconfigured' || selection.reason !== 'missing-configuration') {
      throw new Error('unreachable');
    }
    expect(selection.missing).toEqual(Object.values(FIREBASE_VARIABLES));
  });

  it('refuses an unrecognised backend rather than reading it as preview', () => {
    // A typo is not consent to store records somewhere else.
    for (const value of ['Firebase', 'firestore', 'prod', 'true']) {
      const selection = selectBackend({ ...COMPLETE, [BACKEND_VARIABLE]: value });
      expect(selection).toMatchObject({ kind: 'misconfigured', reason: 'unknown-backend' });
    }
  });

  it('never puts a configuration value in the failure message', () => {
    const selection = selectBackend({ ...COMPLETE, [BACKEND_VARIABLE]: 'nonsense' });
    if (selection.kind !== 'misconfigured') throw new Error('unreachable');
    const message = misconfigurationMessage(selection);
    expect(message).toContain(BACKEND_VARIABLE);
    expect(message).not.toContain('nonsense');
    expect(message).not.toContain('1:1:web:1');
  });

  it('names the variables, not the values, when configuration is missing', () => {
    const selection = selectBackend({ [BACKEND_VARIABLE]: 'firebase' });
    if (selection.kind !== 'misconfigured') throw new Error('unreachable');
    expect(misconfigurationMessage(selection)).toContain(FIREBASE_VARIABLES.projectId);
  });
});
