# CLAUDE.md

Monorepo for multiple financial applications (Net Worth, Investment, Expense) on a shared
platform. Build common functionality **once** in `packages/`; each application contains
only its own business logic and configuration.

Architectural rationale: `docs/ARCHITECTURE.md`. This file is the operative rule set.

## Hard rules

1. Search `packages/` before creating reusable functionality. Never duplicate an existing
   shared component.
2. No Firebase imports outside `packages/firebase` — not `firebase/*`, not `@firebase/*`.
3. No Firebase Admin SDK, service-account credentials, private keys, server secrets, or
   backend-only credentials anywhere in client code.
4. No web DOM elements (`div`, `span`, `button`, `input`, `select`) anywhere in the UI.
5. No CSS files, Tailwind, or styled-components. Styling comes from `packages/theme`.
6. No business logic in UI components.
7. No secrets or hard-coded encryption keys in source. No sensitive data in logs.
8. Shared code depends on interfaces; apps inject concrete implementations.
9. Destructive operations require explicit confirmation and appropriate re-authentication.
10. Never weaken ESLint dependency boundaries or create circular dependencies.
11. Fixing a shared-package bug requires a regression test.
12. Breaking changes must be explicitly identified and all affected apps updated in the
    same change.
13. Do not claim verification unless `pnpm turbo build test lint` actually passed.
14. Firebase Security Rules, not UI code, are the authorization boundary. Never rely on
    hidden buttons, client-side role checks, navigation restrictions, or client validation
    alone for security.
15. Firebase Firestore and Storage access must be deny-by-default and explicitly scoped to
    the authenticated user's ownership. Never use broad authenticated-user access unless
    the data is intentionally shared and documented.
16. Never trust client-provided ownership, roles, verification state, or security metadata.
17. Never store passwords, recovery codes, encryption keys, access/refresh tokens, or other
    authentication secrets in plaintext in Firestore, Storage, logs, analytics, URLs, or
    browser localStorage.
18. Never implement custom cryptography. Use reviewed cryptographic primitives and
    authenticated encryption such as AES-GCM or another approved AEAD construction.
19. Recovery codes must use a cryptographically secure random generator. Never use
    `Math.random()` for secrets.
20. Security-sensitive Firebase workflows must have negative tests, preferably against the
    Firebase Emulator Suite. Never run automated security tests against production data.
21. Never introduce Cloud Functions, Firebase Admin SDK, or another backend unless the
    user explicitly requests a backend. The current production target is Firebase Spark.

## Stack

- pnpm workspaces + Turborepo
- TypeScript, `strict: true`
- React Native via Expo; `react-native-web` for the web target
- Firebase, behind service interfaces so it can be replaced
- Firebase Spark is the current plan; do not require paid-only backend services

Do not introduce another framework, styling system, state-management library, or backend
without explaining why the existing stack is insufficient.

## Layout

```
apps/
  networth/     net worth calculation, asset categories, liabilities, dashboard
  investment/   portfolio performance, holdings, investment analytics
  expense/      categorization, budgets, expense analytics
packages/
  utils/        pure helpers — dates, formatting, currency, validation, safe logging
  theme/        design tokens, ThemeProvider, ThemeSelector (system/light/dark)
  security/     encryption, secure storage, recovery codes, device registration,
                app lock, biometrics, session and token handling
  ui/           generic React Native components
  data/         repository, sync, import/export, validation, conflict handling
  auth/         login, signup, password reset, device verification, session
  account/      profile, settings, delete account, delete/export user data
  backup/       manual and automatic backup, restore, status, progress
  firebase/     Firebase client implementations of the service interfaces
  core/         AppCore composition root and shared providers
docs/ARCHITECTURE.md
```

Each package documents its own contents in its `README.md`. Do not maintain a second
copy of that inventory here.

## Dependency direction

Imports flow one way only. This table is authoritative:

| Package    | May import                                  |
| ---------- | ------------------------------------------- |
| `utils`    | nothing internal                            |
| `theme`    | `utils`                                     |
| `security` | `utils`                                     |
| `ui`       | `theme`, `utils`                            |
| `data`     | `utils`, `security`                         |
| `auth`     | `ui`, `theme`, `utils`, `security`          |
| `account`  | `ui`, `theme`, `utils`, `data`              |
| `backup`   | `ui`, `theme`, `utils`, `data`, `security`  |
| `firebase` | interfaces and types only, from any package |
| `core`     | any shared package                          |
| `apps/*`   | any shared package                          |

Nothing in `packages/` may import from `apps/`. `packages/firebase` imports interfaces
and types only — never a component, never a hook. `core` may compose anything but must
not contain application-specific business rules.

Circular dependencies are prohibited. If one appears, identify the shared abstraction and
move it to a lower-level package — do not disable the check.

Boundaries are enforced by `eslint.config.mjs`, which holds the table above once and
generates a per-package `no-restricted-imports` override from it, and by
`scripts/check-architecture.mjs` for what ESLint cannot express (the type-only Firebase
boundary, the CSS ban, `packages/` never importing `apps/`). If a change appears to
require editing either, **stop**, explain the architectural conflict, and propose the
fix. Do not modify the config to make code compile.

## Firebase Spark architecture

Firebase is an implementation detail and the current application is intentionally
client-first because the project uses Firebase Spark.

```
Component → ServiceInterface → FirebaseXService → Firebase Client SDK → Firebase
```

Firebase Client SDK code is allowed in `packages/firebase` because it is designed to run
in the client. This is different from server-only Firebase Admin code, which is forbidden
until a backend is explicitly introduced.

The client must be treated as potentially modified by an attacker. Firebase Security
Rules must independently enforce authorization for every Firestore and Storage operation.
The UI must never be considered a security boundary.

Interfaces live with their domain package (`packages/account/src/types`);
implementations live in `packages/firebase`.

```ts
interface AccountService {
  deleteAccount(): Promise<void>;
  deleteUserData(): Promise<void>;
  exportUserData(): Promise<unknown>;
}
```

Shared components never instantiate concrete services. Inject through React context,
providers, or explicit props, wired at the composition root:

```tsx
<AppCore
  appName="Net Worth"
  authService={firebaseAuthService}
  accountService={firebaseAccountService}
  backupService={firebaseBackupService}
/>
```

New capability: define the interface in the domain package, implement it in
`packages/firebase`, inject it through `core`. Avoid hidden globals and singletons.

### Backend migration rule

If a future requirement needs trusted server authority, do not move privileged code into
shared client packages. A future backend must live outside the client dependency graph,
for example under `backend/`, and use Firebase Admin SDK there only. Apps must never import
backend packages. The interface in the domain package should remain stable so the client
can later switch from a direct Firebase implementation to an API implementation without
rewriting shared UI.

## Firebase Security Rules

Security Rules are the authoritative authorization layer for Firebase Spark.

Rules must:

- Deny access by default.
- Require authentication for private data.
- Derive ownership from `request.auth.uid`, never from an untrusted client identity field.
- Scope reads, creates, updates, and deletes to the authenticated user's own data.
- Prevent users from changing immutable ownership fields such as `ownerId`, `createdBy`,
  or other security metadata.
- Validate document shape and allowed fields where practical.
- Prevent clients from assigning themselves admin/verified/security roles.
- Keep Firestore and Storage rules independently secure.

Never use `allow read, write: if true` for private data.
Never use `allow read, write: if request.auth != null` as a substitute for ownership rules.

Every new Firestore collection and Storage path must include a corresponding Security Rule
and a negative authorization test before the feature is considered complete.

## Authentication and recovery

Use Firebase Authentication for identity. Never implement custom password authentication or
store user passwords in Firestore.

Authentication flows include signup, login, logout, password reset, email verification,
and re-authentication where appropriate.

Recovery codes are authentication/recovery secrets:

- Generate them with a cryptographically secure random generator.
- Never use `Math.random()`.
- Never log or persist plaintext recovery codes.
- Show the recovery code only when required and never expose it through analytics/errors.
- If server-side verification is ever introduced, store only a cryptographic hash.
- Do not use a recovery code directly as a password, access token, refresh token, or session
  token.
- If a recovery code is used for key derivation, use a reviewed KDF such as Argon2id, scrypt,
  or PBKDF2 with an appropriate salt and parameters; never use a raw hash as a KDF.
- Verification must be single-use and must not expose the expected secret to the client.

Custom device verification must never be implemented by writing an expected verification
code to a publicly readable Firestore document and reading it back from the client.
Verification codes/challenges must be short-lived, single-use, protected from unauthorized
reads, and rate-limited where the chosen Firebase mechanism supports it. Prefer Firebase
Authentication mechanisms where possible.

## User data isolation

All financial and personal data is user-owned unless explicitly documented otherwise.
Preferred structures scope data beneath the authenticated user, such as:

```
users/{uid}/...
```

A user must never be able to read, write, delete, query, or infer another user's private
financial records or backups.

Client-provided `uid`, `ownerId`, `isAdmin`, verification status, and similar fields are
never trusted for authorization.

## Financial data

Treat all of the following as highly sensitive:

- Bank accounts and balances
- Investments, stocks, mutual funds, EPF
- Property and lending records
- Loans and liabilities
- Net worth
- Income and expenses
- Personal profile data associated with financial records

Never log these values, include them in analytics events, place them in error messages, or
send them to third-party services unless explicitly required and documented.

## Application-level encryption

Where application-level encryption is enabled, sensitive financial data follows:

```
Plaintext → authenticated encryption → ciphertext → Firebase
```

Firebase should receive ciphertext for data explicitly designated as encrypted. Firebase
Authentication and Security Rules still protect ownership and access; encryption is an
additional confidentiality layer, not a replacement for authorization.

Use authenticated encryption such as AES-GCM or another reviewed AEAD construction. Never
invent a cryptographic algorithm or use unauthenticated encryption for sensitive records.
Tampered ciphertext must fail decryption.

Encryption keys are never hard-coded, logged, put in URLs, sent to analytics, or stored as
plaintext in Firestore/Storage. The server/backend is not a trusted holder of user
application encryption keys.

Encrypted payloads must be versioned so future cryptographic migrations can be performed
without silently losing data. Store only the metadata required to decrypt, validate, and
migrate the payload; do not expose sensitive plaintext in metadata.

## Secure local storage and app lock

Sensitive local secrets must use platform-appropriate secure storage behind
`packages/security` interfaces.

Android/native implementations should use platform secure/keystore-backed storage where
possible. Web storage must not be treated as equivalent to Android Keystore; never put
passwords, recovery codes, encryption keys, or long-lived authentication secrets in plain
`localStorage`.

App lock and biometrics are additional local protections. They do not replace Firebase
Authentication or Firebase Security Rules.

When the app is locked or a session ends, clear sensitive in-memory/UI state where practical.

## Backup and restore

Backups are encrypted on the device before upload when application-level encryption is
enabled. Firebase Storage should contain ciphertext rather than plaintext financial records.

Backup metadata must not expose sensitive financial information. Use opaque/random backup
identifiers rather than filenames containing account, stock, portfolio, or other sensitive
information.

Every backup operation must enforce authenticated ownership through Firebase Security Rules.
Restore must validate backup format/version, ownership, integrity, and decryption before
modifying local data.

## Account deletion

Account deletion is destructive and must require explicit confirmation and recent
re-authentication where appropriate.

The intended order is:

```
1. Confirm deletion
2. Re-authenticate if required
3. Delete encrypted user data
4. Delete associated backups and storage
5. Delete secondary account records
6. Delete the authentication account
7. Clear local encrypted data, cache, session, and state
8. Navigate to the signed-out state
```

Implementation may differ by Firebase API, but it must not silently orphan user data or
leave sensitive local material after successful deletion. Partial failures must be handled
explicitly and safely.

## Server-controlled fields

Use Firebase server timestamps where appropriate. Clients must not be able to modify
security-sensitive immutable fields such as ownership, creation identity, or verification
status.

Administrative roles, if introduced, must use a trusted Firebase Authentication mechanism
such as custom claims. Never trust a client-controlled `isAdmin` Firestore field.

## Firebase App Check

Use Firebase App Check where supported and appropriate. App Check is an additional abuse
and authenticity layer, not a replacement for Authentication, Firestore/Storage Rules, or
encryption. Security Rules must remain safe even if App Check is bypassed.

## Abuse prevention and resource limits

Do not rely on client-side rate limiting. Avoid unbounded Firestore queries, writes, Storage
operations, or data downloads. Keep queries scoped, paginated, and limited where appropriate.
Security-sensitive workflows must consider brute-force attempts, replay, expiration, and
single-use requirements.

## Configuration and secrets

Firebase client configuration values such as project ID, app ID, and Firebase API keys are
not treated as secrets. They may be present in the client bundle.

Never place actual secrets in client environment variables, Remote Config, Firestore,
Storage, source code, or application bundles.

## Testing and Firebase Emulator

Security-sensitive functionality requires negative tests. Test that unauthorized users cannot:

- Read another user's data.
- Modify another user's data.
- Delete another user's data.
- Access another user's backups.
- Change ownership or immutable security fields.
- Assign themselves administrative/verified status.
- Reuse expired or already-consumed verification codes.
- Decrypt data with the wrong key.
- Decrypt tampered ciphertext.

Use the Firebase Emulator Suite for Authentication, Firestore, and Storage security-rule
and integration tests where practical. Automated tests must never create or delete real
production financial data.

## Shared vs application-specific

**Shared** (`packages/`) — anything another application could reasonably reuse: login,
signup, account management, delete account, delete data, backup, restore, theme, buttons,
dialogs, encryption, recovery codes, session management, generic validation.

**Application-specific** (`apps/<name>/`) — anything that exists because of one app's
business domain: net worth calculation, asset categories, portfolio performance, expense
categorization, budget rules.

**Promotion rule:** when unsure, build it in the application first. When a second
application needs it, extract the generic part, move it to the right package, remove the
duplication, add tests, update the README. Do not generalize prematurely.

One configurable component, never per-app forks:

```tsx
<DeleteAccount
  title="Delete Account"
  description="This action cannot be undone."
  requireConfirmation={true}
  onDelete={handleDelete}
/>
```

Not `NetWorthDeleteAccount` / `InvestmentDeleteAccount` / `ExpenseDeleteAccount`.

## React Native UI

Use `View`, `Text`, `Pressable`, `TextInput`, `ScrollView`, `FlatList`, `SectionList`,
`Image`, `ActivityIndicator`, `KeyboardAvoidingView`. Web renders through
`react-native-web`. No DOM elements, no web-only components in shared UI.

Style with `StyleSheet.create` and tokens from `packages/theme`:

```tsx
const styles = StyleSheet.create({
  container: { padding: spacing.md },
});
```

Never duplicate color or spacing constants locally.

Platform-specific code stays at the leaf — `feature.web.ts` / `feature.native.ts`
alongside the shared module, or `Platform.select`. Do not scatter platform checks through
shared business logic. Native-only capabilities (biometrics, secure keystore) sit behind
interfaces in `packages/security` with a web fallback.

## Configuration

Applications provide configuration; `packages/` never hard-codes app name, Firebase
project ID, API URLs, storage buckets, branding, application-specific colors, business
rules, or feature flags.

## Security logging rule

Never log or persist in plaintext: passwords, recovery codes, encryption keys, access or
refresh tokens, financial records, personal user data, or encrypted payloads. Avoid logging
whole request/response objects that may contain them. Use the shared logger in
`packages/utils`; production logging is safe by default.

## Errors

Services throw typed, coded errors and never contain user-facing copy:

```ts
throw new AccountDeletionError('ACCOUNT_DELETION_FAILED');
```

Applications map codes to messages.

## Package public APIs

Every shared package exposes a deliberate public API through `src/index.ts`:

```
packages/account/
├── src/{components,services,types}/
├── src/index.ts
├── tests/
├── README.md
└── package.json
```

Consumers import from the package root — `import { DeleteAccount } from '@platform/account'`
— never a deep path like `@platform/account/src/components/DeleteAccount`. Internal files
may then change without it being a breaking change.

Package names: `@platform/{ui,theme,core,auth,account,backup,security,data,utils,firebase}`.

## Testing and documentation

Shared packages must have tests. Priority: authentication, account deletion, data
deletion, backup, restore, encryption, recovery codes, session management,
synchronization, validation, error handling, and Firebase Security Rules.

Every shared package has a `README.md` covering purpose, installation, usage, public API,
configuration, examples, dependencies, and limitations. Update it when shared
functionality changes.

## Dependencies

Before adding one, confirm: the current stack doesn't already provide it; no existing
dependency or shared package covers it; no duplicate library results; it works on React
Native, Android, and web; it doesn't violate dependency boundaries.

## Workflow

1. Understand the full requirement before modifying code.
2. Classify: reusable, or application-specific?
3. Search `packages/` and the app for related functionality.
4. Reuse or extend before writing something new.
5. Implement in the correct location per the dependency rules.
6. For every Firebase feature, implement/update Security Rules and negative tests.
7. Add or update tests, preferably using Firebase Emulator Suite for Firebase security.
8. Update the package README if shared functionality changed.
9. Run `pnpm turbo build test lint` and confirm it passes.

Placement: not reusable → `apps/<app>`. Reusable and an existing package owns the
responsibility → extend that package. Reusable with no owner → create it in the correct
package per the dependency table.
