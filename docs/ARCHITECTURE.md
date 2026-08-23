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

The boundary is not only a code convention. `firestore.rules` and
`storage.rules` at the repository root deny by default, anchor every grant to
`request.auth.uid`, constrain document shape and immutability, and close
`deviceVerifications` and `recoveryCodes` to clients entirely. They are tested
against the Firebase emulators by `pnpm test:rules`, starting with the
cross-user negative cases. App Check is a required argument to
`createFirebaseApp`: the API key ships in every client bundle by design, so
without attestation an attacker skips the client and calls the backend
directly, and every client-side control becomes advisory.
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

Two things the ordering alone did not give us. Re-authentication defaults to
**on**: Firebase refuses `deleteUser` without a recent login, so leaving it
optional meant the common path destroyed every record and then failed at the
last step. And Firestore does not cascade — deleting `users/{uid}` leaves its
subcollections intact and, once the auth account is gone, unreachable forever.
The inventory of what a user owns is therefore defined once, and a journal
document is written before anything is destroyed so an interrupted deletion is
detectable and resumable.

This is as far as a client-only design goes. Guaranteed cleanup needs a trusted
server; on Spark there is none, so a user who abandons a half-finished deletion
and never signs in again leaves residue. That limit is a property of the plan,
not an oversight.

## Security posture

Passwords, recovery codes, encryption keys, tokens, financial records and
personal data are never logged or persisted in plaintext. The shared logger
redacts by shape, so logging a whole object cannot leak one of them by accident,
and it defaults to `warn` in production.

Backups and exports are encrypted on the device with a passphrase that never
leaves it, and the passphrase is checked against a strength policy first —
PBKDF2 raises the cost per guess but cannot rescue a guessable secret. The
owner and application are bound into the ciphertext as AES-GCM additional
authenticated data, so a bundle cannot be replayed against a different account
or a different app; the envelope's version, algorithm and iteration count are
validated before any key is derived, so a hostile payload cannot steer the
cost. The Firestore document for a backup carries counts and timestamps only;
the payload in storage is ciphertext.

Recovery codes are shown once and stored only as salted, iterated hashes — a
60-bit secret behind a single unsalted digest is within reach of offline
attack, and an unsalted digest lets one precomputation attack every user at
once. Verification is constant-time, consumes the matching record, and honours
an expiry. Because a client that compares the hash must first be given the hash
list, the rules close that path: the check needs a trusted server.

Secret material is only persisted to storage that reports itself
hardware-backed. `SecureStorage.isHardwareBacked` is part of the contract, and
`createSessionStore` refuses any store that returns `false` — AsyncStorage and
`localStorage` hold plaintext, and a session carries access and refresh tokens.

## Data and synchronization

Every synchronizable record carries `updatedAt`, `revision` and `deletedAt`.
`updatedAt` and `deletedAt` are written by the remote adapter with
`serverTimestamp()` and required by the rules to equal `request.time`, so a
device with a skewed or hostile clock cannot claim a timestamp it did not earn.

Conflict resolution therefore compares `updatedAt` **first**, with `revision`
breaking ties — the unforgeable field decides, and the device-authored one only
settles a draw. Comparing the revision first would let one device claim an
arbitrarily high number and win every subsequent conflict. One deliberate
asymmetry remains: at an exact tie, a deletion beats a concurrent edit, because
a tombstone must never be resurrected by a slower device's stale write.

Because the server rewrites the timestamp, `Repository.put` returns the record
as stored and the sync engine writes that back locally. Without it the two
copies differ by a timestamp forever and every sync re-pushes the same record.

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

## What a client cannot decide

Some controls cannot be implemented on the client at all, and the honest
response is to remove them rather than to ship something that looks like a
check. Device verification is the example in this codebase: the original
implementation had the client read the expected code out of Firestore, compare
it locally, and write `status: 'verified'` itself. A client that can read the
secret it is being challenged with, and can write the verdict, is not a second
factor. It now fails closed, and the rules close the collection.

The same reasoning applies to rate limiting, to server-issued secrets, and to
any guarantee that work completes after the app is closed. On Spark these are
absent, and are documented as absent.

## What is checked automatically

Documentation drifts; lint does not. `eslint.config.mjs` encodes the dependency
table, the DOM-element ban and the deep-import ban;
`scripts/check-architecture.mjs` covers what ESLint cannot express — the CSS ban,
the type-only Firebase boundary, `packages/` not importing `apps/`, and every
shared package having a public API and a README.

`pnpm turbo build test lint` runs all of it. `pnpm test:rules` runs the Security
Rule suite against the Firestore and Storage emulators; `pnpm verify` runs both.
A green `build test lint` says nothing about backend authorization on its own —
that is what the rules suite is for.
