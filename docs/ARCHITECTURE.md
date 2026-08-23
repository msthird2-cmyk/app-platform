# Architecture

`CLAUDE.md` states the rules. This document explains why they are what they are.

## The problem

Three financial applications share far more than they differ. Authentication,
account management, deletion, backup, encryption, theming and synchronization
are the same product decisions in all three; only net worth calculation,
portfolio analytics and expense categorization differ. Built as three codebases,
the shared 80% would drift into three subtly different versions and every
security fix would have to be made three times.

So: one repository, one shared platform, three thin applications.

## Shared or application-specific

The dividing line is **domain**, not convenience.

Anything another financial application could reasonably reuse belongs in
`packages/`: login, signup, delete account, backup, restore, theme, buttons,
dialogs, encryption, recovery codes, session management, generic validation.

Anything that exists because of one application's business domain belongs in
`apps/<name>/`: net worth calculation, asset categories, portfolio performance,
expense categorization, budget rules.

When it is not obvious, build it in the application. When a second application
needs it, extract the generic part, move it, delete the duplication, add tests
and update the README. Premature generalization produces a shared component with
three sets of conditional behaviour, which is worse than two copies.

The corollary is one configurable component rather than per-app forks:

```tsx
<DeleteAccount title="Delete Account" requireConfirmation onDelete={handleDelete} />
```

not `NetWorthDeleteAccount` / `InvestmentDeleteAccount` / `ExpenseDeleteAccount`.

## Dependency direction

Imports flow one way. The table in `CLAUDE.md` is authoritative and is encoded
once in `eslint.config.mjs`, which generates a per-package `no-restricted-imports`
override from it — so a violation fails lint rather than review, and the table
and its enforcement cannot drift apart.

```
utils  ←  theme, security
       ←  ui (also theme)
       ←  data (also security)
       ←  auth (ui, theme, security)
       ←  account (ui, theme, data)
       ←  backup (ui, theme, data, security)
core   →  anything
apps/* →  anything
```

Two consequences worth naming:

- **`account` does not depend on `auth`.** Deleting an account may require
  re-authentication, which looks like an `auth` dependency. Instead the flow
  takes a `reauthenticate` callback, so the account package stays independent of
  how authentication happens.
- **Nothing in `packages/` may import from `apps/`.** A shared package that
  reaches into an application is no longer shared.

Circular dependencies are prohibited. When one appears, the fix is to identify
the shared abstraction and move it to a lower-level package — never to disable
the check.

## The Firebase boundary

Firebase is an implementation detail, and the repository is written so it could
be replaced without touching a component:

```
Component → ServiceInterface → FirebaseXService → Firebase
```

Interfaces live with their domain (`packages/account/src/types`); the
implementations live in `packages/firebase`; the composition root injects them.
`packages/firebase` may import **interfaces and types only** from other packages
— never a component, never a hook, never a value.

That last rule has one sharp consequence: an adapter cannot construct a domain's
error class, because a class is a value. Rather than weaken the rule, adapters
raise `ServiceError`, which carries the same `domain` and `code` and is
recognised structurally by `errorCode()` in `@platform/utils`. Codes are checked
against the domain's own union at compile time:

```ts
throw authError('INVALID_CREDENTIALS' satisfies AuthErrorCode, cause);
```

This is why `isCodedError` checks shape rather than `instanceof`.

## Errors

Services throw typed, coded errors and never contain user-facing copy:

```ts
throw new AccountError('ACCOUNT_DELETION_FAILED');
```

Applications own the copy, in one `messageForCode` map per app. A service that
returns a sentence cannot be localised, reused by another application, or tested
without asserting on prose.

## Account deletion ordering

Deleting the authentication account first orphans encrypted data that can no
longer be authenticated for removal — the data survives, unreachable, and the
user has no way to ask for it to be removed. So the account is always deleted
last:

```
1. Confirm deletion
2. Re-authenticate if required
3. Delete encrypted user data
4. Delete associated backups and storage
5. Delete secondary account records
6. Delete the authentication account
7. Clear local session and state
8. Navigate to the signed-out state
```

`deleteAccountFlow` implements exactly this, returns the steps it completed, and
is covered by a regression test asserting that `deleteAccount` is the final
service call and that a failure part-way through leaves the account intact.

## Security posture

Passwords, recovery codes, encryption keys, tokens, financial records and
personal data are never logged or persisted in plaintext. The shared logger
redacts by shape, so logging a whole object cannot leak one of them by accident,
and it defaults to `warn` in production.

Backups and exports are encrypted on the device with a passphrase that never
leaves it. The Firestore document for a backup carries counts and timestamps
only; the payload in storage is ciphertext.

Recovery codes are shown once and stored only as hashes. Verification consumes
the matching hash, so a code cannot be reused.

## Data and synchronization

Every synchronizable record carries `updatedAt`, `revision` and `deletedAt`.
Conflict resolution is last-write-wins with `revision` breaking `updatedAt` ties,
and one deliberate asymmetry: at an otherwise exact tie, a deletion beats a
concurrent edit. A tombstone must never be resurrected by a slower device's
stale write.

Deletes are soft for the same reason — a tombstone has to reach every device
before the record can actually go.

Exports are versioned. A bundle from a newer schema is rejected outright rather
than partially read.

## UI

React Native everywhere, rendered on the web through `react-native-web`, so one
component tree serves Android and the browser. No DOM elements and no CSS: all
styling comes from `packages/theme` through `StyleSheet.create`, which keeps a
single source of truth for colour and spacing across both targets.

Platform-specific behaviour stays at the leaf — `feature.web.ts` /
`feature.native.ts`, or `Platform.select` — rather than being scattered through
shared logic. Native-only capabilities such as biometrics sit behind interfaces
in `packages/security` with a web fallback.

## Testing

Shared packages are tested, with priority on authentication, account deletion,
data deletion, backup, restore, encryption, recovery codes, session management,
synchronization, validation and error handling.

Tests target pure logic. Importing `react-native` pulls in Flow-typed source a
plain test runner cannot parse, so logic worth testing is kept out of modules
that import it — `packages/theme/src/scheme.ts` exists precisely so
`resolveScheme` can be tested without a native runtime.

## What is checked automatically

Documentation drifts; lint does not. `eslint.config.mjs` encodes the dependency
table, the DOM-element ban and the deep-import ban;
`scripts/check-architecture.mjs` covers what ESLint cannot express — the CSS ban,
the type-only Firebase boundary, `packages/` not importing `apps/`, and every
shared package having a public API and a README.

`pnpm turbo build test lint` runs all of it.
