# Architecture

`CLAUDE.md` states the operative rules. This document explains the architecture, threat model, Firebase Spark limitations, and the controls required before real user data is introduced.

## Platform goal

This is a reusable financial-app platform. Authentication, account management, deletion, backup, encryption, theming, session handling and synchronization are built once in `packages/`. Apps contain only their own domain logic.

The platform must make the secure path the easiest path: shared components should not need app-specific security forks, and a new app should inherit the same security controls by composing the shared services.

## Shared vs application-specific

The dividing line is domain, not convenience.

Shared: login, signup, password reset, email verification, account deletion, delete-data, backup/restore, theme, dialogs, encryption, recovery codes, secure storage, session handling and generic validation.

App-specific: net-worth calculation, asset categories, portfolio performance, expense categorization and budget rules.

When uncertain, build app-specific first. On second use, extract the generic part, remove duplication, add tests and update the README. Do not create per-app security forks.

## Dependency direction

```text
utils  ← theme, security
       ← ui
       ← data
       ← auth
       ← account
       ← backup
firebase ← interfaces/types only
core    → any shared package
apps/*  → any shared package
```

`packages/` never imports `apps/`. `packages/firebase` contains client implementations only and never imports UI components/hooks. `core` composes services but contains no app business rules.

Dependency boundaries are enforced by lint and architecture checks. If implementation appears to require weakening those checks, stop and fix the design rather than the enforcement.

## Threat model

Treat every client as attacker-controlled. A user can inspect and modify the APK/web bundle, call Firebase APIs directly, alter client-side validation, change timestamps/revisions, replay requests and attempt to access another user's paths.

Therefore:

```text
UI validation      = UX only
TypeScript         = developer safety only
Service interfaces = architecture only
App Check          = abuse/authenticity layer
Encryption         = confidentiality/integrity layer
Firebase Rules     = authorization boundary
Trusted backend    = server-authoritative decisions when Rules cannot express them
```

No client-side control may be the sole protection for financial data.

## Firebase Spark architecture

The initial product is intentionally client-first:

```text
Component
  ↓
Service Interface
  ↓
Firebase Client Service
  ↓
Firebase Client SDK
  ↓
Firebase Auth / Firestore / Storage
```

Firebase client configuration is public by design. API keys and project IDs are identifiers, not server credentials. Never ship Admin SDK credentials, service-account JSON, private keys or backend secrets.

Spark is acceptable for the initial product, but it does not remove the need for server-side security boundaries. If a requirement needs a secret or decision that must not be available to the client, do not fake it with Firestore documents or client code.

### Spark capability boundary

Rules can enforce ownership, allowed fields, document structure, immutable fields and many state transitions. They cannot provide arbitrary trusted secret issuance, general-purpose rate limiting, guaranteed post-account recursive deletion, or other server-only workflows.

If the product later requires these controls, the architecture supports a separate trusted `backend/` using Firebase Admin SDK. It must remain outside the client dependency graph and behind the existing domain service interfaces. Moving to Blaze/backend is a deliberate security decision, not an excuse to weaken the Spark design.

## Security Rules are mandatory

Rules must be stored in Git and deny by default. Console-only rules are not considered part of the architecture.

Required repository infrastructure:

```text
firebase.json
firestore.rules
firestore.indexes.json
storage.rules
Firebase Emulator Suite configuration/tests
```

Every private resource must have:

1. authentication requirement
2. ownership check from `request.auth.uid`
3. operation-specific authorization
4. field/document validation
5. immutable security fields
6. negative tests proving unauthorized access fails

Never use `allow read, write: if true` or broad authenticated-user access for private financial data.

### Firestore ownership model

Preferred structure:

```text
users/{uid}/{collection}/{docId}
```

Rules must independently verify:

- authenticated caller owns `uid`
- collection is an explicit application allowlist
- document ID matches the record ID
- profile writes use an explicit client-writable field allowlist
- ownership, role, verification and security fields cannot be client-written
- server timestamps are used for authoritative synchronization metadata
- revisions follow the allowed state transition
- tombstones cannot be resurrected by stale client writes
- device-verification/recovery-verification documents cannot be read or modified by clients
- recovery *escrow* documents are readable and writable by their owner, and by
  nobody else. They are ciphertext rather than a credential: a wrong recovery
  code fails an authentication tag, not an authorization check, so the owner
  holding their own wrapped key learns nothing they could not already compute.
  The shape is a fixed allowlist, so no field that could verify a guessed code
  can be added to it.
- backup metadata cannot contain financial record payloads

### Storage ownership model

Preferred structure:

```text
users/{uid}/backups/{opaqueId}.json
```

Storage Rules independently enforce authentication, ownership, operation type, size/content-type limits and a strict filename allowlist. Encryption does not replace authorization: encrypted data can still be deleted or corrupted if Storage Rules are weak.

## App Check

Enable Firebase App Check where supported. For native builds use an appropriate platform attestation provider; for web use the supported App Check provider for the deployment. Debug providers must be development-only.

App Check is not authorization and is never the only control. Rules must remain secure if App Check is bypassed.

## Authentication

Use Firebase Authentication for identity. Required flows include signup, login, logout, password reset, email verification and recent reauthentication for destructive/sensitive actions.

Signup must send email verification and the product should provide resend. Sensitive financial writes may require `request.auth.token.email_verified` in Rules once the product policy is enabled.

Client password validation is UX. If a password policy is required, configure Firebase Authentication's server-side password policy as well.

Enable Firebase Auth protections against email enumeration where available and keep sensitive auth errors generic.

## Device verification

A custom device verification flow must never be:

```text
client writes expected code
→ client reads expected code
→ client compares code
→ client writes verified
```

That is client-authoritative and provides no security boundary.

On Spark, prefer Firebase Authentication capabilities. If a custom challenge requires trusted issuance/comparison or reliable rate limiting, defer it or introduce a trusted backend. A Firestore document containing the expected secret must never be client-readable.

Trusted-device pairing is the case that looks similar and is not. There the server relays public keys and wrapped key material; it holds no secret a client could read, and no client writes a verdict. The decision is made by a person comparing a short code on two screens, and the key transfer is protected by the ECDH transport key regardless of what the relay does. A hostile relay can stall a pairing or substitute its own public key — which is exactly what the code comparison catches — but it cannot learn the key. That is why pairing survives the scrutiny that rules out the flow above.

## Recovery codes

Recovery codes are account-recovery secrets and must be generated with CSPRNG.

Store no plaintext code. If verification material is persisted, use a per-code random salt and a deliberately slow password-grade KDF such as PBKDF2/Argon2id/scrypt with reviewed parameters. Never use unsalted single-round SHA-256 as the credential verifier.

Verification must be single-use, constant-time where applicable, rate-limited by a trusted mechanism when network exposed, and subject to an expiry/rotation policy.

If a recovery code is used to derive an encryption key, keep that KDF purpose separate from credential verification and use explicit context separation.

## Application-level encryption

For sensitive application data:

```text
Plaintext
  ↓
Authenticated encryption (AES-GCM/approved AEAD)
  ↓
Ciphertext
  ↓
Firebase
```

Use fresh random salt/nonce material and reviewed KDF parameters. Wrong keys and tampering must fail closed.

Encrypted envelopes must be versioned. Before expensive key derivation, validate the envelope version, algorithm and KDF iteration count against an explicit accepted range. Never accept attacker-controlled extreme iteration counts.

Use AES-GCM additional authenticated data (AAD) to bind security context where appropriate, including application identity and envelope/schema version; bind the authenticated user identity when the keying model permits it. A backup from one application/context must not silently become valid in another merely because the passphrase matches.

Existing encrypted formats must have a migration strategy before changing the envelope or KDF contract. The React Native implementation was added without changing it: `PortableCryptoService` and `WebCryptoService` write the same version-1 envelope byte for byte, which is asserted directly — each decrypts what the other wrote, and both open a payload recorded from the implementation that predates the split. A backup taken on the web therefore restores on a phone, which is the only reason a second implementation was acceptable at all.

The KDF cost policy is stated once and applied at both ends: when a service is configured and again when a payload or stored hash is read. Two authorities disagreeing is how a service comes to produce data it will later refuse, and that failure surfaces on the restore rather than at the mistake.

## Encryption key architecture

An approved design, not a description of code. Nothing here is implemented yet.
`CLAUDE.md` states it as rules; this explains why each rule is what it is, so
that an implementer who disagrees is arguing with a reason rather than a
preference.

The goal is that financial records stop being readable by anyone holding the
database — including whoever operates the Firebase project. That means
encrypting on the device, before the write, with a key the server never sees.

**Why the key is random.** The obvious design derives the key from the user's
password: nothing to store, nothing to transfer, and remembering the password is
the whole of recovery. It fails at both ends. A password change re-derives the
key, so every record must be re-encrypted or the old ones become unreadable; and
a key that is a function of a guessable secret is only as strong as that secret,
forever, with no way to raise the bar later. So the DEK is random and everything
else *wraps* it. Changing a passphrase rewrites one wrapped copy. Adding a
recovery path adds a wrapped copy. Adding a device adds a wrapped copy. The
records never move. This is why disk encryption separates the volume key from
the user's password, and it is worth the machinery of having a key to manage.

**Why pairing is the normal path.** Two devices need the same key and the server
must not learn it. ECDH gives both a shared transport key without either sending
a secret. What ECDH alone does not give is any assurance about who is on the
other end — a relay that substitutes its own public keys sits in the middle of
both halves. That is what the human-visible code is for: it is derived from both
public keys, so a substituted key changes it, and a person looking at two screens
catches what no client-side check could. This is the one place where a human is a
load-bearing part of the protocol, and it is deliberate; the alternative is a
trusted server, which Spark does not provide.

Recovery is the exception rather than the default because it is the weakest link
— a single secret that reconstructs everything. Making it routine would mean
users handling it often, which is how such a secret leaks.

**Why the recovery code is escrow rather than a factor.** As an authentication
factor, a code is compared against something stored, and the comparison must
happen somewhere trusted, because a client that can read the expected value can
fake the answer. That is a server capability, and on Spark there is none. As key
escrow, nothing is compared: the code is key material, it unwraps a wrapped DEK,
and a wrong code produces an authentication-tag failure rather than a mismatch
someone must adjudicate. The check *is* the decryption. No server is involved and
it works on Spark today. The approved architecture uses the escrow form; if
server infrastructure arrives later the authentication form can be added
alongside it, and neither makes the other unnecessary.

**What Gate 3 actually built.** The escrow form above, and nothing else. A DEK
that already exists is wrapped under a key derived from the recovery code with
the repository's own KDF policy — PBKDF2-SHA256 at the shipped iteration count,
unchanged — and sealed with AES-256-GCM. The wrapped copy and the parameters
needed to open it live at `users/{uid}/recoveryEscrow/{escrowId}`; the code and
the key itself never leave the device.

Recovery reads that document, derives the wrapping key from the code the user
types, opens the envelope, checks the result really is a 256-bit key, and hands
it to Gate 2 custody. Every failure along that path ends with custody untouched.
The one that matters most is a missing escrow: it raises an error rather than
falling through to key creation, because a recovery flow that quietly produced a
new key would orphan every existing record while looking like it worked.

The KDF purpose is separated explicitly, as this document already required of
any encryption key derived from a recovery code. `EncryptionContext` gained an
optional `purpose`, bound into the authenticated data as `pur`, which the escrow
path sets to `recovery-escrow.v1`. Omitting it serialises to exactly the string
it did before the field existed, so every payload written earlier still opens; a
purpose-bound envelope and an ordinary one are different domains and neither can
be opened as the other.

Two things are deliberately absent from the stored document. There is no
verifier — no digest of the key, no checksum, no hint — because any of them
would let whoever holds the document test candidate codes without paying for a
derivation, and the derivation cost is what defends a 60-bit secret offline. And
there is no recovery-code hash, which is the *other* mechanism: that lives at
`users/{uid}/recoveryCodes`, is still closed to clients, and still waits for a
trusted server. Escrow needs no server, so it ships now; the authentication form
can be added beside it later, exactly as stated above.

**Why the passphrase is optional and is not the DEK.** It exists because some
users want a recovery path they can hold in their head rather than on paper. It
wraps the DEK exactly as the recovery code does — one more wrapped copy. It is
optional because requiring it would make every record read wait on a human, and
it is not the DEK because deriving the key from it reintroduces every problem
above.

**Why it is shared.** Encryption is the most expensive thing to get wrong and
the worst thing to have three versions of. Every application here stores records
with the same shape, the same sync engine and the same ownership model, so they
have the same requirement; the only per-application question is which fields are
sensitive, and that is a declaration rather than an implementation. Key material
belongs to `packages/security` and the envelope to `packages/data`, which the
dependency table already permits — no new direction and no new package.

**What it costs.** Three costs, accepted deliberately. *Server-side query is
gone* for encrypted fields: an opaque payload cannot be filtered or ordered by
Firestore. The repository contract offers no domain-field query today, so nothing
is lost yet, but the door is closed — a field left in plaintext so a query keeps
working defeats the design. *Losing everything means losing everything*: a user
with no trusted device, no recovery code and no passphrase has no path back, and
there is deliberately no operator override, because an override is a master key
and a master key means the data was never end-to-end encrypted. That has to be
stated plainly in the product, not buried. *There is no plaintext fallback*: when
the key is unavailable the system reports that it cannot decrypt and does not
write plaintext instead, because silent fallback is what makes the whole thing
theatre — the attacker's easiest move is then to make the key look unavailable.

## Secure local storage and app lock

`SecureStorage` is a security guarantee, not a naming convention. Native secret storage must use an approved platform secure/keystore-backed implementation. Do not silently use AsyncStorage or equivalent plaintext key-value storage for tokens, keys or recovery material.

The guarantee is expressed as a tier — `os-keystore`, `browser-nonextractable`, `memory` — rather than as a `hardwareBacked` boolean, because the boolean promised something no implementation can check. `expo-secure-store` offers `isAvailableAsync` and `canUseBiometricAuthentication` and nothing that reports whether the underlying keystore key is hardware-backed. A store setting such a flag would be asserting a fact it has no way to establish, which is the same defect that removed client-side device verification from this codebase. A tier is a claim an implementation can stand behind.

Key custody is deliberately narrower than the storage interface, and deliberately cannot create a key. The reason is one specific failure: on Android, a keystore key invalidated by a lock-screen change leaves the stored ciphertext intact and unreadable. Code that treats "cannot read" as "nothing stored" will generate a replacement key and silently orphan every record encrypted under the original — the user's data still exists and can never be opened again. So the three states are `absent`, `present` and `unusable`, `load()` returns `null` for absence alone, and generation lives somewhere else entirely.

Web storage is a different threat model. Never store passwords, recovery codes, encryption keys or long-lived authentication secrets in plain `localStorage`. Prefer in-memory handling or a specifically reviewed browser mechanism and document the residual risk.

App-lock state must persist across restart using secure storage. Failed-attempt counters must not reset after each lockout. Use an escalating/documented lockout policy. App lock remains an additional local control, not authorization.

Sign-out must clear session-local sensitive state, dispose cached per-user repositories/services and remove only platform-owned keys. Never call an unscoped global storage `clear()`.

## Backup and restore security

Backups are encrypted on the device before upload. Firebase Storage must receive ciphertext for protected financial data.

Backup IDs are opaque, random/collision-resistant and validated before path interpolation. Do not derive IDs from caller-controlled timestamps alone and never silently overwrite an existing ID.

Backup passphrases require a minimum-strength policy at every encryption entry point. A one-character passphrase is invalid for financial backups.

Restore is treated as hostile input even after decryption. It must:

1. validate envelope version/algorithm/KDF bounds
2. verify authentication/integrity
3. verify user/app/schema binding
4. reject unknown collection names
5. reject `__proto__`, `constructor` and `prototype` keys
6. validate records against per-collection schemas
7. use conflict-aware restore or a clearly confirmed replace-all mode
8. avoid inconsistent partial writes through batching/transactional mechanisms where supported

A generic shared API must not expose raw plaintext financial export by accident. Encrypted export is the default. If plaintext export is ever intentional, it must be explicitly named and documented as sensitive.

## Data synchronization and integrity

Every syncable record carries stable `id`, `updatedAt`, `revision` and `deletedAt` metadata.

The client is not authoritative for synchronization time or revision. Use Firebase server timestamps where supported and enforce valid transitions in Rules. Record ID must match the document ID. A client must not set a year-3000 timestamp or huge revision to permanently win conflicts.

Sync is incremental, not full-collection polling. Persist per-collection watermarks and use `updatedAfter`. Bound concurrency and define tombstone retention/cleanup so Spark read/write quotas do not become an availability failure.

When paging, tombstones should be filtered by the query where possible so the limit applies to live records rather than filtering after the limit.

Soft delete should update only the necessary tombstone fields or use a transaction rather than reading and rewriting the entire document.

## Account deletion and erasure

Deletion is a security/privacy workflow, not just a UI action.

Required order:

```text
1. explicit confirmation
2. recent reauthentication
3. create/advance deletion journal when resumability is required
4. delete user-owned Firestore data
5. delete all owned Storage backups/objects
6. delete secondary records
7. delete Firebase Auth account
8. clear local encrypted data/cache/session/derived keys
9. signed-out state
```

Reauthentication must occur before destructive work, not at the final Auth deletion step.

Firestore does not cascade subcollections. Maintain one authoritative inventory of user-owned collections. Do not keep divergent hardcoded deletion lists in multiple services.

On Spark, client-only deletion cannot guarantee recursive erasure after the user loses access or never returns. If guaranteed erasure is a product/security requirement, use a trusted server capability. Until then, the limitation must be documented and deletion status must not falsely claim complete erasure when it is not known.

Storage deletion must account for nested prefixes and summary/object consistency.

## Logging and privacy

Financial data is highly sensitive: balances, investments, EPF, property, lending, liabilities, net worth, income, expenses and associated personal data.

Production logging should be allowlist-based: intentionally safe fields may be logged; unknown keys are redacted by default. Do not rely on a denylist of `amount`/`balance` because financial models evolve (`value`, `outstanding`, `netWorth`, `units`, `pricePerUnit`, `currentPrice`, `spent`, `limit`, `description`, `displayName`, `name`, etc.).

Prefer fixed event codes over arbitrary message strings. Release builds should not ship uncontrolled `console.*` logging. Logger defaults must be production-safe.

## Error handling

Services throw typed coded errors without user-facing copy. Error and telemetry payloads must not contain passwords, recovery codes, encryption keys, access/refresh tokens, financial records, personal data or ciphertext.

## Cost/quota safety on Spark

Spark quotas are both cost and availability constraints. Avoid full-collection sync, unbounded `Promise.all`, unlimited downloads, client retry loops and oversized backups.

Use pagination, incremental sync, bounded concurrency and tombstone retention. Document any feature whose secure implementation requires Blaze/backend rather than silently weakening it.

## CI and testing

The repository's security posture is incomplete until infrastructure is tested automatically.

CI must run:

```text
pnpm turbo build test lint
architecture checks
Firebase Emulator Suite rules/integration tests
pnpm audit with a documented reviewed allowlist if an advisory cannot yet be fixed
```

Rules tests must include:

- unauthenticated access denied
- user B cannot read/write/update/delete user A data for every private collection
- user B cannot access user A Storage backups
- unknown collection/path rejected
- ownership/security fields cannot be changed
- invalid document ID rejected
- invalid timestamp/revision/tombstone transitions rejected
- device-verification client reads/writes rejected

Crypto/security tests must include:

- salted/iterated recovery-code verification
- constant-time verification where applicable
- unknown encryption version/algorithm rejected
- KDF iteration bounds rejected outside the accepted range
- AAD/context tampering rejected
- weak backup passphrase rejected
- wrong-key/tampered ciphertext rejected
- app-lock escalation survives restart
- sign-out clears session-local state

Deletion tests must prove reauthentication occurs before destructive calls, every declared collection is handled, interruption is resumable where promised, and local state is cleared.

Restore tests must prove unknown collections, unsafe object keys, invalid record shapes and stale-backup overwrites are rejected or explicitly handled.

## Firebase Emulator and version control

Firebase infrastructure must be versioned:

```text
firebase.json
firestore.rules
firestore.indexes.json
storage.rules
rules/integration test configuration
```

Rules must not exist only in the Firebase console. Console changes must be reproduced in Git before release.

## Release gates

Before connecting the first real Firebase project or creating real user data:

1. Firestore rules exist and negative tests pass.
2. Storage rules exist if Storage is used and negative tests pass.
3. Emulator configuration is committed.
4. App Check strategy is documented and configured for the supported clients.
5. Email verification and reauthentication policy is implemented.
6. Secure native storage is real, not an in-memory/pass-through placeholder.
7. Recovery-code storage/verification is salted, iterated and single-use.
8. Encryption envelope validation and AAD policy is implemented.
9. Backup passphrase and backup-ID policies are enforced.
10. Restore allowlists and schema validation are implemented.
11. Account deletion has an explicit Spark limitation or trusted server strategy.
12. CI executes the security tests.
13. No security finding is marked accepted without a written rationale.

## Migration discipline

Before first real user data, security changes are code/config changes. After real data exists, changes to recovery-code hashing, encryption envelope/KDF, sync metadata or Security Rules may require migrations.

Therefore version encryption formats, keep migration readers when needed, document backfills for server timestamps/revisions, create required Firestore indexes before queries ship, and plan secure-storage migration before changing token storage.

## What is intentionally not promised on Spark

The platform does **not** pretend Spark provides arbitrary server-side rate limiting, custom secret issuance, guaranteed recursive erasure after account loss, or trusted client-resistant device verification. Those are explicit architecture decisions. If the product requires them, the correct next step is a trusted backend/Blaze decision — not a weaker implementation.

## Feature workflow

For every feature:

1. Decide reusable vs app-specific.
2. Search existing shared packages/interfaces.
3. Threat-model Firebase access and data flow.
4. Implement behind a service interface.
5. Add/modify Rules for every Firebase resource.
6. Add negative Emulator tests before calling the feature secure.
7. Add unit/integration tests.
8. Update the relevant package README and this document when architecture changes.
9. Run build/test/lint/architecture/security checks.
10. Audit logs, secrets, ownership, deletion, restore and failure paths.
11. Only then wire the feature into an application.

The reusable platform is successful when a new financial app can compose the same authentication, account, backup, encryption, theme, session and security controls without copying implementation or weakening the security model.
