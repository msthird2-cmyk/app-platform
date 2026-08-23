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

## Firebase Spark architecture

The current product intentionally uses Firebase Spark and therefore uses the
Firebase client SDK directly rather than requiring a paid server/backend.

The normal path is:

```text
Component
  ↓
Service Interface
  ↓
Firebase Client Service
  ↓
Firebase Client SDK
  ↓
Firebase Authentication / Firestore / Storage
```

This is secure only when the client is treated as untrusted. Firebase client code
is not a security boundary. A malicious user can modify the application and call
Firebase directly. Therefore Firebase Security Rules are the authoritative
authorization layer.

The repository may contain Firebase client configuration such as project ID,
app ID, and API keys in the client bundle. These values are identifiers/configuration,
not server credentials. Firebase Admin SDK, service-account JSON, private keys, and
other server secrets must never be included in the client dependency graph.

If a future requirement needs trusted server authority, introduce a separate
`backend/` outside the client dependency graph. Apps must never import backend code.
The existing service interfaces should remain stable so a future API implementation
can replace a direct Firebase client implementation without rewriting shared UI.
Do not introduce a backend merely for architectural fashion; Spark is the current
supported deployment model.

## Firebase Security Rules are the security boundary

Every private Firestore collection and Storage path must be explicitly protected.
Rules are deny-by-default and independently enforce:

1. Authentication — the caller must be signed in when the resource is private.
2. Ownership — access is scoped to `request.auth.uid` or another trusted ownership
   mechanism, never a client-provided identity.
3. Operation — read, create, update, and delete permissions are considered separately.
4. Data validation — writable fields and document structure are constrained where
   practical.
5. Immutable security fields — ownership, creator identity, and security status cannot
   be changed by an ordinary client.
6. Administrative privileges — clients cannot assign themselves admin/verified roles.

Never use broad rules such as:

```text
allow read, write: if true;
allow read, write: if request.auth != null;
```

for private financial data.

A new Firestore collection or Storage path is incomplete until its Security Rules and
negative authorization tests are added.

## User data isolation

Financial records are private user-owned data unless explicitly documented otherwise.
A structure such as the following makes ownership straightforward:

```text
users/{uid}/assets/...
users/{uid}/liabilities/...
users/{uid}/settings/...
users/{uid}/backups/...
```

The important security property is not the exact path; it is that Security Rules derive
ownership from the authenticated identity and never trust a client-provided `uid`.

A user must not be able to read, write, delete, query, or infer another user's private
financial data or backup objects.

## Authentication and device verification

Firebase Authentication is the identity system. Passwords are never stored in Firestore.
Use Firebase-supported authentication, password reset, email verification and
reauthentication mechanisms rather than building a parallel password system.

Custom device verification requires special care on Spark. Never write an expected
verification code into a Firestore document that the same client can read and compare.
That makes the verification secret available to the attacker.

Any custom challenge must be short-lived, single-use, protected from unauthorized reads,
and resistant to replay/brute force using the available Firebase mechanisms. Prefer
Firebase Authentication mechanisms where they satisfy the requirement. If trusted
server-side verification becomes necessary, that is a reason to introduce a backend,
not to weaken the client security model.

## Recovery codes

Recovery codes are authentication/recovery secrets. They are generated using a
cryptographically secure random generator and never with `Math.random()`.

The plaintext code is shown only when required and is never logged, sent to analytics,
placed in a URL, or persisted as plaintext. Stored verification material is a
cryptographic hash, and verification is single-use.

A recovery code is not itself a Firebase password, access token, refresh token, or
permanent session token. If a recovery code is also used to derive an encryption key,
use a reviewed password-based KDF such as Argon2id, scrypt, or PBKDF2 with an appropriate
salt and parameters; do not use a raw hash as a KDF.

## Application-level encryption

Firebase Authentication/Security Rules answer **who may access data**. Application-level
encryption answers **what Firebase can read**. For highly sensitive financial records,
we can use both:

```text
Plaintext
   ↓
Authenticated encryption
   ↓
Ciphertext
   ↓
Firebase
```

Use a reviewed AEAD construction such as AES-GCM. Do not invent cryptography or use
unauthenticated encryption for sensitive records. Tampered ciphertext must fail decryption.

Encryption keys are never hard-coded, logged, sent to analytics, put in URLs, or stored
as plaintext in Firebase. The backend, if one is added later, is not assumed to possess
user encryption keys.

Encrypted records and backups must include a format/version identifier so cryptographic
or schema migrations can be performed safely. Do not expose sensitive plaintext in
metadata.

## Secure local storage and app lock

Secrets held on a device use platform-appropriate secure storage behind interfaces in
`packages/security`.

Android/native should use secure/keystore-backed storage where possible. Browser
`localStorage` must not be treated as equivalent to Android Keystore and must never hold
passwords, recovery codes, encryption keys, or long-lived authentication secrets in
plaintext.

App lock and biometrics are additional local protections. They do not replace Firebase
Authentication or Security Rules. Sensitive in-memory/UI state should be cleared when
sessions end or the application is locked where practical.

## Financial data and privacy

Treat bank accounts, balances, investments, mutual funds, EPF, property, lending, loans,
liabilities, net worth, income, expenses, and associated personal data as highly sensitive.

Never log them, put them into analytics events, expose them through error messages, or
send them to third-party services unless explicitly required and documented.

The shared logger should redact sensitive fields by shape and default to safe production
logging.

## Backup and restore

When application-level encryption is enabled, backups are encrypted on the device before
upload. Firebase Storage contains ciphertext rather than plaintext financial records.
Backup metadata contains only non-sensitive operational information such as version,
count, timestamps, and opaque identifiers.

Use random/opaque backup identifiers rather than filenames that expose account names,
stocks, portfolios, or other sensitive information.

Every backup operation is authenticated and authorized by Firebase Storage/Firestore
Security Rules. Restore verifies ownership, format/version, integrity and decryption
before changing local data.

## Account deletion

Account deletion is destructive. Require explicit confirmation and recent reauthentication
where appropriate.

The intended sequence is:

```text
1. Confirm deletion
2. Re-authenticate if required
3. Delete encrypted user data
4. Delete associated backups/storage
5. Delete secondary account records
6. Delete Firebase Authentication account
7. Clear local encrypted data/cache/session/state
8. Navigate to signed-out state
```

The exact Firebase API sequence may vary, but implementation must not intentionally orphan
user data or leave sensitive local material after successful deletion. Partial failures
must be surfaced and handled safely.

## Server-controlled fields and roles

Use Firebase server timestamps where appropriate. Ordinary clients must not be able to
change `ownerId`, `createdBy`, creation identity, verification status, or other security
metadata.

If administrative roles are introduced, use Firebase Authentication custom claims or
another trusted mechanism. Never trust a client-controlled `isAdmin` Firestore field.

## Firebase App Check

Firebase App Check should be enabled where supported and appropriate. It reduces abuse
from unauthorized app clients but is an additional layer only. App Check never replaces
Authentication, Security Rules, or application-level encryption.

Security Rules must remain safe even if an attacker bypasses App Check.

## Abuse prevention

Client-side rate limiting is not a security boundary. Keep queries and downloads scoped,
paginated and bounded. Avoid unbounded writes and Storage operations.

Security-sensitive workflows must consider brute-force attempts, replay, expiration,
single-use challenges, and denial-of-service/resource abuse within the limits of the
current Firebase plan.

## Account deletion and encrypted data ordering

Deleting the authentication account first can make user-owned encrypted data impossible
to authenticate and remove through the normal application flow. Therefore the normal
flow deletes user data first and authentication last, followed by local cleanup.

## Errors

Services throw typed, coded errors and never contain user-facing copy. Applications map
codes to localized messages. Error messages and telemetry must not include passwords,
recovery codes, keys, tokens, financial records, personal data, or ciphertext.

## Data and synchronization

Every synchronizable record carries `updatedAt`, `revision` and `deletedAt`.
Conflict resolution is last-write-wins with `revision` breaking `updatedAt` ties, and at
an otherwise exact tie, deletion beats a concurrent edit. A tombstone must never be
resurrected by a slower device's stale write.

Deletes are soft for the same reason — a tombstone has to reach every device before the
record can actually go.

Exports are versioned. A bundle from a newer schema is rejected outright rather than
partially read.

## UI

React Native everywhere, rendered on the web through `react-native-web`, so one component
tree serves Android and the browser. No DOM elements and no CSS: all styling comes from
`packages/theme` through `StyleSheet.create`, which keeps a single source of truth for
colour and spacing across both targets.

Platform-specific behaviour stays at the leaf — `feature.web.ts` / `feature.native.ts`,
or `Platform.select` — rather than being scattered through shared logic. Native-only
capabilities such as biometrics sit behind interfaces in `packages/security` with a web
fallback.

## Testing and Firebase Emulator

Shared packages are tested, with priority on authentication, account deletion, data
deletion, backup, restore, encryption, recovery codes, session management,
synchronization, validation and error handling.

Firebase Security Rules are tested with the Firebase Emulator Suite wherever practical.
Tests cover both allowed and denied operations, including cross-user access attempts,
ownership changes, unauthorized deletes, backup access, and invalid document writes.

Never run automated security tests against production Firebase data.

Cryptography tests include correct decryption, wrong-key failure, tampered-ciphertext
failure, invalid payload rejection, and encryption-format/version handling.

Tests target pure logic. Importing `react-native` pulls in Flow-typed source a plain test
runner cannot parse, so logic worth testing is kept out of modules that import it.

## What is checked automatically

Documentation drifts; lint does not. `eslint.config.mjs` encodes the dependency table,
the DOM-element ban and the deep-import ban; `scripts/check-architecture.mjs` covers
what ESLint cannot express — the CSS ban, the type-only Firebase boundary,
`packages/` not importing `apps/`, and every shared package having a public API and a
README.

Security Rules should also be checked in CI using the Firebase Emulator Suite when the
repository has emulator-based rule tests configured.

`pnpm turbo build test lint` runs the existing build, test and lint architecture checks.
