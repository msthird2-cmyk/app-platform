/**
 * What signing out has to do, and in what order.
 *
 * A plan rather than a procedure, for the reason `dataKeyStep` is a function
 * rather than a component: the order here is the security property, and an
 * order is testable while a sequence of awaits inside a click handler is not.
 *
 * The order is not a preference. `AuthProvider.signOut` clears the user from
 * context, so after it runs there is no identity left to name — and custody is
 * addressed per identity (`custodyAddressFor`). A clear that ran second would
 * not know what to clear. This is F-05: without it, signing out leaves the data
 * encryption key on a device the person believes they have left.
 */

export type SignOutStep = 'clear-data-key' | 'sign-out';

export interface SignOutPlan {
  /** The identity whose custody record is to be removed. */
  readonly owner: string;
  /** In order. The caller runs them in this order and does not reorder them. */
  readonly steps: readonly SignOutStep[];
}

export function signOutPlan(owner: string): SignOutPlan {
  // Refused here rather than left to `custodyAddressFor`, which also rejects an
  // empty owner: by the time the clear runs, the caller has already committed
  // to destroying something. A plan that cannot name its subject is not a plan.
  if (typeof owner !== 'string' || owner.length === 0) {
    throw new Error('SIGN_OUT_IDENTITY_REQUIRED');
  }
  // Not trimmed, not lowercased. Deciding that two identifiers are the same is
  // the authentication provider's job, and a normalisation here could clear a
  // different person's record — the same argument `custodyAddressFor` makes.
  return Object.freeze({ owner, steps: Object.freeze(['clear-data-key', 'sign-out'] as const) });
}
