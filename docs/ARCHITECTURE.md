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

That key is derived from the passphrase, which is right for a backup — a bundle
must be openable by someone holding only the passphrase — and is exactly what the
record-encryption DEK must not be. The two are different keys with different
lifetimes; see "Encryption and key management".

Recovery codes are shown once and stored only as salted, iterated hashes — a
60-bit secret behind a single unsalted digest is within reach of offline
attack, and an unsalted digest lets one precomputation attack every user at
once. Verification is constant-time, consumes the matching record, and honours
an expiry. Because a client that compares the hash must first be given the hash
list, the rules close that path: a recovery code used as an *authentication
factor* needs a trusted server, and on Spark that server does not exist.

A recovery code used as *key escrow* is a different mechanism and does not have
that requirement — there is nothing to compare, only a wrapped key that either
unwraps or does not. The approved architecture uses the escrow form, which is why
it is implementable on Spark while the authentication form is not. The two are not
substitutes for each other.

Secret material is only persisted to storage that reports itself
hardware-backed. `SecureStorage.isHardwareBacked` is part of the contract, and
`createSessionStore` refuses any store that returns `false` — AsyncStorage and
`localStorage` hold plaintext, and a session carries access and refresh tokens.

## Encryption and key management

This is an approved design, not a description of code. Nothing in this section is
implemented yet. `CLAUDE.md` states it as rules; this explains why each one is
what it is, so that an implementer who disagrees is arguing with a reason rather
than a preference.

The goal is that financial records stop being readable by anyone holding the
database — including whoever operates the Firebase project. That means encrypting
on the device, before the write, with a key the server never sees.

### Why the key is random

The obvious design is to derive the key from the user's password: no key to store,
no key to transfer, and remembering the password is the whole of recovery. It fails
on both ends. A password change re-derives the key, so every record has to be
re-encrypted or the old ones become unreadable; and a key that is a function of a
guessable secret is only as strong as that secret, forever, with no way to raise
the bar later.

So the DEK is generated randomly, and everything else *wraps* it. Changing a
passphrase rewrites one wrapped copy and touches no records. Adding a recovery
path adds a wrapped copy. Adding a device adds a wrapped copy. The records never
move. This is the same reason disk encryption separates the volume key from the
user's password, and it is worth the extra machinery of having a key to manage.

The corollary is that a wrapped DEK is safe to store where a plaintext DEK is not
— but "safe to store" stops at Firestore for the plaintext form, unconditionally.

### Why pairing is the normal path and recovery is the exception

Two devices need the same key, and the server must not learn it. ECDH gives both
devices a shared transport key without either sending a secret, and the DEK
crosses wrapped under it.

What ECDH alone does not give is any assurance about *who* is on the other end: a
relay that substitutes its own public keys sits in the middle of both halves and
reads everything. That is what the human-visible verification code is for. It is
derived from both public keys, so a substituted key changes it, and a person
looking at two screens catches what no client-side check could. This is the one
place in the system where a human is a load-bearing part of the protocol, and it
is deliberate — the alternative is a trusted server, which Spark does not provide.

This also settles a question that otherwise looks unresolved. Device verification
was removed from this codebase because the client read the challenge and wrote its
own verdict. Pairing looks superficially similar and is structurally different:
the server holds nothing worth reading and decides nothing. See "What a client
cannot decide".

Recovery is the exception rather than the default because it is the weakest link
in the design — a single secret that reconstructs everything. Making it the
routine path would mean users handling it often, which is exactly how such a
secret leaks.

### Why the recovery code is escrow rather than a factor

A recovery code can play two entirely different roles, and conflating them is the
mistake this section exists to prevent.

As an **authentication factor**, the code is compared against something stored. The
comparison has to happen somewhere trusted, because a client that can read the
expected value can also fake the answer. That is a server capability, and on Spark
there is none — the rules close `recoveryCodes` to clients for exactly this reason.

As **key escrow**, nothing is compared. The code is key material: it unwraps a
wrapped DEK, and a wrong code produces an authentication-tag failure, not a
mismatch someone has to adjudicate. The check is the decryption. No server is
involved, nothing trusted is required, and it works on Spark today.

The approved architecture uses the escrow form. If server infrastructure arrives
later, the authentication form can be added alongside it; it does not replace it,
and neither one makes the other unnecessary.

### Why an optional passphrase, and why it is not the DEK

The passphrase exists because some users will want a recovery path they can hold
in their head rather than on paper. It wraps the DEK exactly as the recovery code
does — one more wrapped copy, no more.

It is optional because requiring it would mean every record read waits on a human,
and it is not the DEK because deriving the key from it would reintroduce every
problem "why the key is random" describes. A user who sets one, changes it, or
removes it is only rewriting a wrapper.

### Why it is shared

Encryption is the single most expensive thing to get wrong and the single worst
thing to have three versions of. Every application in this monorepo stores records
with the same shape, the same sync engine and the same ownership model, so they
have the same encryption requirement; the only per-application question is which
fields are sensitive, and that is a declaration, not an implementation.

Key material and key lifecycle belong to `packages/security`, the envelope and its
persistence to `packages/data` — which the dependency table already permits, since
`data` may import `security`. No new direction and no new package is required to
build this.

### What it costs

Three costs, all accepted deliberately.

**Server-side query is gone** for encrypted fields. An opaque payload cannot be
filtered or ordered by Firestore. The repository contract does not currently offer
domain-field queries, so nothing is lost today, but the door is closed: a field
left in plaintext so that a query keeps working defeats the whole design. A
privacy-preserving index is a separate piece of work if it is ever needed.

**Losing everything means losing everything.** A user with no trusted device, no
recovery code and no passphrase has no path back, and there is deliberately no
operator override — an override is a master key, and a master key means the data
was never end-to-end encrypted. This is a property of the design, not a gap in it,
and it has to be stated plainly in the product, not buried.

**There is no plaintext fallback.** When the key is unavailable the system fails
closed: it reports that it cannot decrypt, and does not write plaintext instead.
Silent fallback is the failure mode that makes the whole thing theatre, because
the attacker's easiest move is then to make the key look unavailable.

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

This metadata is also the whole of what the server is meant to see. Once record
encryption lands, `id`, `updatedAt`, `revision`, `deletedAt` and the owning `uid`
stay in the clear because synchronization and conflict resolution cannot work
without them; every domain field moves inside the encrypted payload. `QueryOptions`
already filters only on `updatedAfter`, `includeDeleted` and `limit` — no domain
field — so the repository contract does not have to lose a capability to get
there. That is not an accident of the current shape: filtering and ordering on
encrypted fields is outside this architecture, and a field left in plaintext to
enable a query is a leak, not an optimization.

The record shape does have to change. `SyncableRecord<T>` is `RecordMetadata & T`
— domain fields sit as siblings of the metadata — and encryption makes it metadata
plus one opaque payload.

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

Trusted-device pairing is the case that looks similar and is not. There the
server relays public keys and wrapped key material; it holds no secret the client
could read, and the client writes no verdict. The decision is made by a human
comparing a short code on two screens, and the DEK transfer is protected by the
ECDH transport key regardless of what the relay does. A hostile relay can stall a
pairing or substitute its own public key — which is what the code comparison
catches — but it cannot learn the DEK. That is why pairing survives the same
scrutiny that removed device verification.

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
