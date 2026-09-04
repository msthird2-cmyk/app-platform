import { describe, expect, it } from 'vitest';
import { observeAuthSession, type AuthSessionSink } from '../src/authSession';
import type { AuthService, AuthUser } from '../src/types/auth';

/**
 * F-07: what the provider believes on a cold start.
 *
 * Both failures below come from the same cause — a `getCurrentUser()` lookup
 * racing the observer — but they are different orderings with different
 * symptoms, so they are asserted separately.
 */

const RESTORED: AuthUser = {
  id: 'user-1',
  email: 'you@example.com',
  displayName: 'You',
  emailVerified: true,
  createdAt: 0,
};

/** Records every value the provider would have put into state, in order. */
function recorder(): AuthSessionSink & { users: (AuthUser | null)[]; initializing: boolean[] } {
  const users: (AuthUser | null)[] = [];
  const initializing: boolean[] = [];
  return {
    users,
    initializing,
    setUser: (user) => void users.push(user),
    setInitializing: (value) => void initializing.push(value),
  };
}

/**
 * The half of `AuthService` this subscription touches. Every other method
 * rejects: reaching for one would be a defect this test should surface, not
 * quietly satisfy.
 */
function service(options: {
  /** Delivered to the observer, and when. `null` means the observer is silent. */
  observer?: { user: AuthUser | null; when: 'sync' | 'later' };
  /** What the synchronous `auth.currentUser` read resolves to. */
  lookup: AuthUser | null | 'reject';
}): AuthService & { emit: (user: AuthUser | null) => void } {
  let listener: ((user: AuthUser | null) => void) | null = null;
  const unreachable = () => Promise.reject(new Error('not part of this subscription'));
  return {
    getCurrentUser: () =>
      options.lookup === 'reject'
        ? Promise.reject(new Error('lookup failed'))
        : Promise.resolve(options.lookup),
    onAuthStateChanged: (next) => {
      listener = next;
      // Both shipped implementations invoke the listener on subscribe:
      // `InMemoryAuthService.ts:123` does it directly, and Firebase's SDK
      // always delivers the initial state. Firebase delivers it only once
      // persistence has been restored, which is what 'later' models.
      if (options.observer?.when === 'sync') next(options.observer.user);
      return () => {
        listener = null;
      };
    },
    emit: (user) => listener?.(user),
    signIn: unreachable as AuthService['signIn'],
    signUp: unreachable as AuthService['signUp'],
    signOut: unreachable,
    sendPasswordReset: unreachable,
    reauthenticate: unreachable,
    resendEmailVerification: unreachable,
    sendDeviceVerification: unreachable,
    confirmDeviceVerification: unreachable,
  };
}

/** Lets every already-queued promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('observeAuthSession — the observer is authoritative', () => {
  it('does not let a resolved lookup overwrite a user the observer delivered', async () => {
    // The cold start Firebase actually produces: the observer restores the
    // session, and the synchronous `auth.currentUser` read that was started
    // first resolves afterwards carrying the pre-restore `null`.
    const sink = recorder();
    observeAuthSession(service({ observer: { user: RESTORED, when: 'sync' }, lookup: null }), sink);
    await settle();

    expect(sink.users.at(-1)).toEqual(RESTORED);
  });

  it('does not report initialisation finished while the observer is still silent', async () => {
    // The other ordering: the lookup wins. Firebase's observer has not yet
    // restored persistence, so the read returns `null` — which is not evidence
    // that nobody is signed in.
    const sink = recorder();
    const auth = service({ observer: { user: RESTORED, when: 'later' }, lookup: null });
    observeAuthSession(auth, sink);
    await settle();

    // Before the observer speaks there is no answer, so the gate must still be
    // initialising rather than rendering a signed-out view.
    expect(sink.initializing).not.toContain(false);
    expect(sink.users).not.toContain(null);

    auth.emit(RESTORED);
    expect(sink.initializing.at(-1)).toBe(false);
    expect(sink.users.at(-1)).toEqual(RESTORED);
  });

  it('does not report initialisation finished when the lookup rejects', async () => {
    const sink = recorder();
    observeAuthSession(service({ observer: { user: RESTORED, when: 'later' }, lookup: 'reject' }), sink);
    await settle();

    expect(sink.initializing).not.toContain(false);
  });

  it('reports a signed-out user once the observer says so', async () => {
    const sink = recorder();
    observeAuthSession(service({ observer: { user: null, when: 'sync' }, lookup: null }), sink);
    await settle();

    expect(sink.users.at(-1)).toBeNull();
    expect(sink.initializing.at(-1)).toBe(false);
  });

  it('stops writing to the sink after unsubscribe', async () => {
    const sink = recorder();
    const auth = service({ observer: { user: null, when: 'later' }, lookup: RESTORED });
    const stop = observeAuthSession(auth, sink);
    stop();
    await settle();
    auth.emit(RESTORED);

    expect(sink.users).toHaveLength(0);
    expect(sink.initializing).toHaveLength(0);
  });
});
