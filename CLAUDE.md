# CLAUDE.md

Monorepo for multiple financial applications (Net Worth, Investment, Expense) on a shared platform. Build common functionality **once** in `packages/`; each application contains only its own business logic and configuration.

Architectural rationale: `docs/ARCHITECTURE.md`. This file is the operative rule set.

## Hard rules

1. Search `packages/` before creating reusable functionality. Never duplicate an existing shared component.
2. No Firebase imports outside `packages/firebase` — not `firebase/*`, not `@firebase/*`.
3. No Firebase Admin SDK, service-account credentials, private keys, server secrets, or backend-only credentials anywhere in client code.
4. No web DOM elements (`div`, `span`, `button`, `input`, `select`) anywhere in the UI.
5. No CSS files, Tailwind, or styled-components. Styling comes from `packages/theme`.
6. No business logic in UI components.
7. No secrets or hard-coded encryption keys in source. No sensitive data in logs.
8. Shared code depends on interfaces; apps inject concrete implementations.
9. Destructive operations require explicit confirmation and recent/appropriate re-authentication.
10. Never weaken ESLint dependency boundaries or create circular dependencies.
11. Fixing a shared-package bug requires a regression test.
12. Breaking changes must be explicitly identified and all affected apps updated in the same change.
13. Do not claim verification unless `pnpm turbo build test lint` actually passed, plus security-rule tests when rules are changed.
14. Firebase Security Rules, not UI code, are the authorization boundary. Never rely on hidden buttons, client-side role checks, navigation restrictions, or client validation alone for security.
15. Firestore and Storage access must be deny-by-default and explicitly scoped to authenticated ownership.
16. Never trust client-provided ownership, roles, verification state, timestamps, revisions, or other security metadata.
17. Never store passwords, recovery codes, encryption keys, access/refresh tokens, or other authentication secrets in plaintext in Firestore, Storage, logs, analytics, URLs, or browser `localStorage`.
18. Never implement custom cryptography. Use reviewed cryptographic primitives and authenticated encryption such as AES-GCM.
19. Recovery codes and all other secrets must use a CSPRNG. Never use `Math.random()` for secrets.
20. Security-sensitive Firebase workflows require negative tests, preferably against the Firebase Emulator Suite. Never run automated security tests against production data.
21. Do not introduce Cloud Functions, Firebase Admin SDK, or another backend while Spark is the target unless explicitly approved. If a feature cannot be made secure on Spark, stop and document the limitation rather than weakening security.
22. Never edit `eslint.config.mjs` or `scripts/check-architecture.mjs` merely to make a feature compile. If architecture enforcement blocks the design, stop and explain the conflict.
23. Every new Firestore collection and Storage path requires Security Rules plus negative authorization tests before it is considered complete.
24. Client-side validation is UX only. Any security-sensitive invariant must also be enforced by Firebase Rules or a trusted backend when Rules cannot express it.
25. Never add a plaintext export path beside an encrypted export without an explicit, documented security boundary. Prefer encrypted exports by default.
26. Never restore untrusted collection names or arbitrary document shapes. Restore must use application allowlists and per-collection validation.
27. Never use client-controlled timestamps/revisions as authoritative synchronization metadata. Use Firebase server timestamps and Rules where possible.
28. Never claim account deletion is complete unless the implementation has an explicit strategy for all owned data, including subcollections and backups.

## Stack

- pnpm workspaces + Turborepo
- TypeScript, `strict: true`
- React Native via Expo; `react-native-web` for web
- Firebase client SDK behind service interfaces
- Firebase Spark is the current plan

Do not introduce another framework, styling system, state-management library, or backend without explaining why the existing stack is insufficient.

## Layout

```text
apps/
  networth/     net worth calculation, asset categories, liabilities, dashboard
  investment/   portfolio performance, holdings, investment analytics
  expense/      categorization, budgets, expense analytics
packages/
  utils/        pure helpers, validation, safe logging
  theme/        tokens, ThemeProvider, ThemeSelector
  security/     encryption, secure storage, recovery codes, app lock, biometrics, session
  ui/           generic React Native components
  data/         repository, sync, import/export, validation, conflict handling
  auth/         login, signup, password reset, email verification, session, device verification
  account/      profile, settings, delete account, delete/export data
  backup/       manual/automatic backup, restore, status, progress
  firebase/     Firebase client implementations of service interfaces
  core/         AppCore composition root and shared providers
docs/ARCHITECTURE.md
```

## Dependency direction

| Package | May import |
|---|---|
| `utils` | nothing internal |
| `theme` | `utils` |
| `security` | `utils` |
| `ui` | `theme`, `utils` |
| `data` | `utils`, `security` |
| `auth` | `ui`, `theme`, `utils`, `security` |
| `account` | `ui`, `theme`, `utils`, `data` |
| `backup` | `ui`, `theme`, `utils`, `data`, `security` |
| `firebase` | interfaces/types only from shared packages |
| `core` | any shared package |
| `apps/*` | any shared package |

Nothing in `packages/` imports from `apps/`. `packages/firebase` never imports a component or hook. `core` composes services but contains no app-specific business rules.

## Reusable component architecture

Shared functionality must be configurable rather than forked per application. Examples include login, signup, password reset, email verification, account deletion, delete-data, backup/restore, theme selection, dialogs, secure storage, encryption, recovery codes, session handling and generic validation.

Use composition/configuration:

```tsx
<DeleteAccount
  title="Delete Account"
  description="This action cannot be undone."
  requireConfirmation
  onDelete={handleDelete}
/>
```

Not `NetWorthDeleteAccount`, `InvestmentDeleteAccount`, etc.

When unsure, build app-specific first. On second use, extract the generic part into the correct package, remove duplication, add tests and update the package README.

## Firebase Spark architecture

Normal client path:

```text
Component → ServiceInterface → FirebaseXService → Firebase Client SDK → Firebase
```

Firebase client configuration is public by design. The client is attacker-controlled. Security Rules must independently authorize every Firestore and Storage operation.

Interfaces live in the domain package; concrete Firebase implementations live in `packages/firebase`; apps wire them through `AppCore`.

If trusted server authority becomes necessary, keep it outside the client graph, for example under `backend/`, and use Firebase Admin SDK there only. Apps and client packages must never import backend code. Preserve service interfaces so a future API implementation can replace direct Firebase access.

### Spark capability boundary

Spark is acceptable for the initial client-first product, but it is **not** a reason to weaken security. The following cannot be made fully server-authoritative with client code alone:

- trusted issuance/comparison of custom device-verification secrets
- authoritative rate limiting and brute-force counters
- guaranteed recursive account-data deletion/resumption after a user disappears
- other decisions that require a secret unavailable to the client

When such a requirement appears, either use Firebase capabilities that provide equivalent trusted enforcement, defer the feature, or explicitly approve a future backend/Blaze migration. Never simulate server authority by putting a secret or verdict in a client-readable Firestore document.

## Firebase Security Rules

Rules are deny-by-default and independently enforce:

- authentication
- ownership from `request.auth.uid`
- operation-specific permissions
- allowed fields/document shape
- immutable ownership and security fields
- server-controlled timestamps/revisions where applicable
- prevention of self-assigned admin/verified/security roles

Never use `allow read, write: if true` for private data. Never use `allow read, write: if request.auth != null` as an ownership rule.

### Required Firestore model

Preferred private data structure:

```text
users/{uid}/{collection}/{docId}
```

Rules must ensure, as applicable:

- `request.auth.uid == uid`
- collection is in the application's declared allowlist
- `request.resource.data.id == docId`
- security/ownership fields cannot be changed by the client
- client-writable profile fields use an explicit allowlist
- `updatedAt` is server-controlled where used for synchronization
- revisions cannot be skipped or maliciously inflated
- a non-null tombstone cannot be resurrected by an ordinary stale write
- device-verification documents and recovery verification material are not client-readable/writable
- backup metadata contains no financial records

Every collection requires positive and negative tests, especially user A versus user B for read/write/update/delete.

### Required Storage model

Preferred structure:

```text
users/{uid}/backups/{opaqueId}.json
```

Storage Rules must independently enforce:

- authenticated ownership
- read/write/delete only within the caller's own prefix
- strict opaque filename pattern such as `^[A-Za-z0-9_-]{1,64}\\.json$`
- maximum upload size
- expected content type
- no traversal-shaped identifiers

Encryption does not replace Storage authorization. Ciphertext can still be deleted, replaced or corrupted by an unauthorized actor if Rules are weak.

## Authentication and recovery

Use Firebase Authentication for identity. Required flows include signup, login, logout, password reset, email verification and recent re-authentication for destructive/sensitive actions.

Email verification must be sent on signup and resendable. Sensitive financial writes should require `request.auth.token.email_verified` once that policy is adopted in Rules. Enable Firebase Auth protections against email enumeration where available.

Client password policy is UX only. If a policy is required, configure the Firebase Authentication password policy as the backend enforcement layer as well.

### Recovery codes

- Generate with CSPRNG.
- Never log or persist plaintext.
- Never expose expected recovery material to the client for comparison.
- If stored for verification, use a per-secret random salt and a password-grade KDF such as PBKDF2/Argon2id/scrypt with reviewed parameters.
- Use constant-time verification where applicable.
- Make codes single-use and define expiry/rotation policy.
- Keep recovery-code verification separate from generic integrity hashing.

Do not store recovery-code hashes as unsalted single-round SHA-256. A 60-bit secret still benefits from a deliberately slow, salted verifier.

### Device verification

Do not implement device verification as:

```text
client writes expected code → client reads expected code → client compares → client writes verified
```

That is not a security boundary. On Spark, either use Firebase Authentication capabilities, keep the feature disabled/deferred, or use a mechanism whose secret and verification decision are not available to the client. Custom server-issued verification should be moved to a trusted backend when required.

## Encryption

Application-level encryption is an additional confidentiality layer:

```text
Plaintext → AES-GCM/approved AEAD → ciphertext → Firebase
```

Use fresh random salt/nonce material and reviewed KDF parameters. Tampered ciphertext must fail closed.

Encrypted envelopes must be versioned and must validate all parameters before expensive key derivation. Do not trust attacker-controlled KDF iteration counts or algorithm/version strings.

Bind security context to authenticated encryption using AAD where appropriate, including at least the application identity and schema/envelope version; bind the user identity when the design permits it. A backup from one app/user/context must not silently become valid in another context merely because the passphrase matches.

Keep an explicit accepted range for KDF iterations. Reject values outside the range before deriving a key.

Never hard-code keys, log keys, place keys in URLs, or store them as plaintext in Firebase.

## Secure local storage and app lock

`SecureStorage` is a security contract, not merely a key-value interface. Native Android/iOS implementations must use platform secure/keystore-backed storage (for example an approved Expo secure-storage mechanism). Do not silently inject AsyncStorage or browser `localStorage` for tokens/keys and call it secure.

On web, never persist passwords, recovery codes, encryption keys or long-lived authentication secrets in plain `localStorage`. Prefer in-memory handling or a specifically reviewed browser mechanism with documented threat limitations.

App-lock state must be persisted in secure storage and must not reset its failure counter after lockout. Lockout should escalate according to a documented policy and survive process/app restart. App lock is additional protection, not authorization.

Sign-out must tear down the session: clear sensitive local storage owned by the platform, drop cached repositories/services and clear derived key material where practical. Never call an unscoped global storage `clear()` that can delete unrelated application data.

## Backup and restore

Backups are encrypted before upload. Backup identifiers must be CSPRNG-generated or otherwise collision-resistant and must pass a strict allowlist before being interpolated into paths.

Never derive backup identity from a caller-controlled timestamp alone. Never silently overwrite an existing backup ID.

Passphrases require a documented minimum-strength policy, enforced at every encryption entry point, not only in UI. A one-character passphrase is never acceptable for a complete financial backup.

Restore must:

1. validate envelope/version/algorithm/KDF bounds
2. authenticate/decrypt and verify integrity
3. verify app/user/schema binding
4. reject unknown collection names
5. reject prototype-pollution keys such as `__proto__`, `constructor`, `prototype`
6. validate records against per-collection schemas, not only sync metadata
7. use conflict-aware semantics or an explicit, separately confirmed replace-all mode
8. avoid partial inconsistent writes through batching/transactional mechanisms where supported

Never expose a raw plaintext `exportUserData()` path as a generic shared API. Exports containing financial records must be explicitly classified as plaintext or encrypted, with encrypted being the default.

## Data synchronization

Every syncable record uses `updatedAt`, `revision`, `deletedAt` and stable `id` metadata.

Client clocks and client revisions are not authoritative. Where supported, use Firebase `serverTimestamp()` and Rules to enforce invariants. A document ID must match the record ID. Updates must not arbitrarily jump revisions, rewrite tombstones, or use a year-3000 client timestamp to win conflict resolution.

Sync must be incremental. Persist per-collection high-water marks/watermarks and use `updatedAfter` rather than rereading entire collections on every run. Bound read/write concurrency and define tombstone retention/cleanup.

When paging, apply tombstone filtering in the server query where possible so a `limit` means the requested number of live records rather than a number of documents before client-side filtering.

Soft delete must be atomic or field-level where possible. Do not read a full document and rewrite it merely to set tombstone fields if that can overwrite concurrent changes.

## Account deletion

Deletion must re-authenticate before destructive operations by default for Firebase Authentication accounts. Do not delete all user data and discover at the final auth-delete step that the user needs recent login.

Deletion order:

```text
1. explicit confirmation
2. recent re-authentication
3. create/advance deletion journal if needed
4. delete user-owned data
5. delete all declared backups/storage objects
6. delete secondary records
7. delete auth account
8. clear local session/cache/encrypted material
9. signed-out state
```

Firestore does not cascade subcollections. Maintain one authoritative inventory of user-owned collections and do not keep divergent hardcoded lists in multiple services.

On Spark, reliable recursive deletion/resumption across all possible subcollections cannot be guaranteed after the user disappears. Document this limitation honestly. If guaranteed server-side erasure is a product requirement, use a trusted backend/appropriate Firebase server capability rather than pretending client-side deletion is atomic.

Backup deletion must handle nested Storage prefixes and must not leave summaries pointing at missing objects without reconciliation.

## Logging and errors

Production logging must be safe by default. Prefer an allowlist of intentionally safe fields rather than a denylist of known financial field names. Unknown keys should be redacted by default. Do not assume fields such as `value`, `outstanding`, `netWorth`, `units`, `pricePerUnit`, `currentPrice`, `spent`, `limit`, `description`, `displayName` or `name` are safe merely because they are not named `amount` or `balance`.

Do not log arbitrary message strings that may contain secrets. Prefer fixed event codes and structured, sanitized context.

Default scoped logger level should be production-safe (`warn` or stricter) and release builds should not ship uncontrolled `console.*` logging.

Services throw typed coded errors and never contain user-facing copy. Error/telemetry payloads must not contain financial records, personal data, credentials, keys, tokens, ciphertext or recovery material.

## Configuration and secrets

Firebase client configuration values such as project ID, app ID and API keys are public configuration. They are not server secrets.

Never put service-account JSON, private keys, Admin SDK credentials, backend secrets or real credentials in source, client environment variables, Remote Config, Firestore, Storage or bundles.

## UI/platform

Use React Native primitives (`View`, `Text`, `Pressable`, `TextInput`, `ScrollView`, `FlatList`, etc.). Web renders through `react-native-web`. No DOM elements or CSS.

Style with `StyleSheet.create` and tokens from `packages/theme`. Platform-specific code belongs in `.web.ts`/`.native.ts` leaf modules or `Platform.select`, not shared business logic.

## CI and testing gates

CI must run at minimum:

```text
pnpm turbo build test lint
architecture checks
Firebase Emulator Suite rules/integration tests
pnpm audit (with a documented, reviewed allowlist if necessary)
```

Security-rule tests must include:

- unauthenticated access denied
- user B cannot read/write/update/delete user A data for every private collection
- user B cannot access user A backups
- unknown collection/path rejected
- ownership/security fields cannot be changed
- invalid ID/doc path rejected
- invalid server timestamp/revision/tombstone transitions rejected
- device-verification client access rejected

Crypto/security tests must include:

- salted/iterated recovery-code verification
- constant-time secret comparison where applicable
- unknown envelope version/algorithm rejected
- KDF iteration bounds enforced
- AAD/context tampering rejected
- weak backup passphrase rejected
- wrong-key/tampered ciphertext rejected
- app-lock escalation survives restart
- sign-out clears session-local state

Deletion tests must prove re-authentication occurs before destructive calls, every declared collection is handled, interrupted deletion is resumable where promised, and local state is cleared.

Restore tests must prove unknown collections, unsafe object keys, invalid record shapes and stale-backup overwrites are rejected or explicitly handled.

## Firebase Emulator and repository files

Keep Firebase infrastructure in version control:

```text
firebase.json
firestore.rules
firestore.indexes.json
storage.rules
emulator test configuration
```

Rules are not allowed to exist only in the Firebase console. Any console change must be reproduced in version control before release.

## Cost and quota safety on Spark

Spark quotas are a security/availability constraint. Do not design features around full-collection reads, unbounded fan-out, unlimited Storage operations or client-controlled retry loops.

Incremental sync, bounded concurrency, pagination and tombstone retention are required before real usage grows.

Do not add paid-only capabilities implicitly. If a security requirement cannot be satisfied on Spark, flag it as a plan/backend decision rather than weakening the security model.

## Workflow for every feature

1. Decide reusable vs app-specific.
2. Search `packages/` and existing interfaces first.
3. Check Firebase/Spark security implications before implementation.
4. Implement in the correct package.
5. Add tests, especially negative security tests for data access.
6. Add/update Security Rules and emulator tests for every new Firebase resource.
7. Update the package README and architecture docs when the boundary changes.
8. Run `pnpm turbo build test lint` and security/emulator tests.
9. Review logs, secrets, ownership, deletion, restore and failure paths.
10. Only then wire the feature into an app.

Never wire an application to Firebase before the rules, App Check strategy, emulator tests, authentication requirements and data ownership model are reviewed.
