import type { AuthService, AuthUser } from './types/auth';

/**
 * Where the signed-in identity comes from, extracted out of the component.
 *
 * `AuthProvider` is a React component and this repository has no
 * component-test infrastructure, so a bug in this subscription could only be
 * found by reading it. The orchestration is the part with consequences — an
 * identity delivered late, or withdrawn wrongly, decides whether a person sees
 * their data or a sign-in form — so it lives here, as a plain function over the
 * service interface, and the component does nothing but hold the result in
 * state. Same argument as `dataKeyStep` in `@platform/core`.
 *
 * **The observer is the only source of truth, for the user and for whether
 * initialisation has finished.** This used to also call `getCurrentUser()` and
 * apply whichever answer arrived, which was wrong in both orderings:
 *
 * - Firebase's `getCurrentUser` reads `auth.currentUser` synchronously and
 *   resolves on a microtask. Before the persisted session is restored that read
 *   is `null` — and `null` there means "not restored yet", not "nobody is
 *   signed in". Applying it cleared a user the observer had already delivered.
 * - The lookup also ended `initializing` in a `.finally()`, regardless of
 *   outcome. A cold start could therefore report "finished, signed out" while
 *   the restore was still in flight, and the observer does not re-fire to
 *   correct a state nobody asked it about.
 *
 * The lookup is gone rather than made to lose the race, because there is no
 * ordering in which it adds anything: `auth.currentUser` becomes non-null as
 * part of the same restore that notifies the observer, so it can never carry
 * news the observer has not already delivered. `AuthService.getCurrentUser`
 * remains on the interface for a caller that wants a one-shot read; nothing in
 * this repository needs one.
 */

export interface AuthSessionSink {
  setUser(user: AuthUser | null): void;
  setInitializing(initializing: boolean): void;
}

export function observeAuthSession(service: AuthService, sink: AuthSessionSink): () => void {
  let active = true;
  const unsubscribe = service.onAuthStateChanged((next) => {
    // Guarded because a listener can be invoked between the caller dropping
    // this subscription and `unsubscribe` taking effect.
    if (!active) return;
    sink.setUser(next);
    // Only here. Initialisation is finished exactly when the authoritative
    // source has spoken once, which is the contract `onAuthStateChanged`
    // states — never on a timer and never on a second opinion.
    sink.setInitializing(false);
  });
  return () => {
    active = false;
    unsubscribe();
  };
}
