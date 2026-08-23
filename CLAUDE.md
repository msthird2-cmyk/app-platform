# CLAUDE.md

Monorepo for multiple financial applications (Net Worth, Investment, Expense) on a shared
platform. Build common functionality **once** in `packages/`; each application contains
only its own business logic and configuration.

Architectural rationale: `docs/ARCHITECTURE.md`. This file is the operative rule set.

## Hard rules

1. Search `packages/` before creating reusable functionality. Never duplicate an existing
   shared component.
2. No Firebase imports outside `packages/firebase` — not `firebase/*`, not `@firebase/*`.
3. No web DOM elements (`div`, `span`, `button`, `input`, `select`) anywhere in the UI.
4. No CSS files, Tailwind, or styled-components. Styling comes from `packages/theme`.
5. No business logic in UI components.
6. No secrets or hard-coded encryption keys in source. No sensitive data in logs.
   Encryption keys follow "Encryption and key management" below: never plaintext in
   Firestore, never plaintext in ordinary persistent storage.
7. Shared code depends on interfaces; apps inject concrete implementations.
8. Destructive operations require explicit confirmation.
9. Never weaken ESLint dependency boundaries or create circular dependencies.
10. Fixing a shared-package bug requires a regression test.
11. Breaking changes must be explicitly identified and all affected apps updated in the
    same change.
12. Do not claim verification unless `pnpm turbo build test lint` actually passed.

## Stack

- pnpm workspaces + Turborepo
- TypeScript, `strict: true`
- React Native via Expo; `react-native-web` for the web target
- Firebase, behind service interfaces so it can be replaced

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
  security/     encryption, key management, secure storage, recovery codes,
                device registration and pairing, app lock, biometrics, session
                and token handling
  ui/           generic React Native components
  data/         repository, sync, record encryption envelope, import/export,
                validation, conflict handling
  auth/         login, signup, password reset, device verification, session
  account/      profile, settings, delete account, delete/export user data
  backup/       manual and automatic backup, restore, status, progress
  firebase/     Firebase implementations of the service interfaces
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

## Firebase boundary and dependency injection

Firebase is an implementation detail. Always:

```
Component → ServiceInterface → FirebaseXService → Firebase
```

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

New backend capability: define the interface in the domain package, implement it in
`packages/firebase`, inject it through `core`. Avoid hidden globals and singletons.

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

## Security

Never log or persist in plaintext: passwords, recovery codes, encryption keys, access or
refresh tokens, financial records, personal user data, encrypted payloads. Avoid logging
whole request/response objects that may contain them. Use the shared logger in
`packages/utils`; production logging is safe by default.

**Account deletion ordering.** Deleting the authentication account first orphans
encrypted data that can no longer be authenticated for removal. The flow is:

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

Implementation may differ by backend, but it must never orphan user data.

## Encryption and key management

This is the approved architecture. **None of it is implemented yet** — there is no
record encryption, no secure-storage implementation, no recovery flow and no
key-management interface in the repository today. The design is recorded here so
that when it is built it cannot drift, and so that no intermediate step ships a
weaker version of it. Rationale and the trade-offs behind each rule are in
`docs/ARCHITECTURE.md`.

Domain records will be encrypted on the device before they are persisted to
Firestore. A randomly generated **Data Encryption Key (DEK)** encrypts them. The
DEK is never stored in plaintext in Firestore.

### Key hierarchy

```
Random DEK
   |
   +--> encrypts domain records
   |
   +--> wrapped for trusted-device transfer          (ECDH transport key)
   |
   +--> wrapped for recovery-code recovery
   |
   +--> optionally wrapped for encryption-passphrase recovery
```

Every path wraps the *same* DEK. None of them is the DEK and none of them derives
it: the DEK is random, never a deterministic function of anything the user types.
A user changing a passphrase rewraps the DEK; it does not re-encrypt the records.

### Multi-device onboarding — trusted-device pairing

The normal way a second device obtains the DEK:

1. An already trusted, unlocked device approves the new device.
2. Both sides establish a shared transport key over ECDH.
3. A human-visible verification code is displayed on both devices and must match.
4. The trusted device transfers the DEK wrapped under the ECDH-derived transport key.

The server relays public keys, pairing state and wrapped transfer material only. It
never receives the plaintext DEK, and it never adjudicates the pairing — the humans
holding the two devices do, by comparing the code.

The NetWorth AI trusted-device ECDH pairing implementation is the **reference
design**. Do not invent a second, unrelated pairing mechanism.

### Zero-trusted-device recovery

A user who has lost every trusted device recovers with their recovery code. The
recovery code unwraps the DEK **locally**: it is a cryptographic key-escrow and
recovery mechanism, not merely an authentication factor.

The unwrap either succeeds or fails cryptographically. Nothing compares a secret
against a stored value, so nothing needs a trusted server, and Firebase Spark must
not be used to perform client-side secret comparison. A server-side recovery-code
*authentication* mechanism is a separate capability that may exist once Blaze or
other server infrastructure is available — it does not replace this one.

### Optional encryption passphrase

A user may additionally set an encryption passphrase that wraps the DEK, giving a
second local recovery path. It is optional, it is **not** required for normal
record access, and it must never be used as the DEK itself.

### Where this lives

Record encryption is a **shared platform capability**. It sits behind the shared
security and data abstractions so that NetWorth Tracker, BolKhaata, Dukandar, Hotel
Listing and every future application use the same encryption and key management
without duplicating it. Key material and key lifecycle belong to
`packages/security`; the record envelope and its persistence belong to
`packages/data`. Applications declare which of their fields are sensitive. Do not
implement encryption for one application.

### Firestore-visible metadata

Firestore-visible record metadata stays limited to what ownership, synchronization
and conflict resolution require — today `id`, `updatedAt`, `revision`, `deletedAt`
and the owning `uid`. Domain and business fields belong inside the encrypted
payload.

The consequence is deliberate: encrypted domain fields are opaque to Firestore, so
**server-side querying, filtering and ordering on those fields are not part of this
architecture**. Do not reintroduce them by leaving a field in plaintext. If they
are needed later, they require a separate privacy-preserving indexing design.

### Local storage of the DEK

The device's local copy of the DEK requires secure storage. It must not be
persisted in AsyncStorage, `localStorage`, plaintext files, Firestore, or any other
ordinary persistent storage. This extends the rule already enforced for sessions:
`SecureStorage.isHardwareBacked` is part of the contract, and a store that reports
`false` is not eligible to hold key material.

### Spark is a constraint, not an excuse

Firebase Spark's limitations must not be worked around by weakening this
architecture. In particular: no plaintext secrets in Firestore, and no client-side
check presented as though it provided server-side verification. If a control cannot
be implemented securely on Spark, it is documented as absent — see "What a client
cannot decide" in `docs/ARCHITECTURE.md`.

### Invariants

These hold at every stage of implementation, including partial ones:

- No plaintext DEK in Firestore.
- No plaintext DEK in ordinary persistent storage.
- No deterministic DEK derived directly from a user password or passphrase.
- No plaintext financial or domain records in Firestore once record encryption is
  enabled.
- No silent plaintext fallback when the encryption key is unavailable.
- A missing key fails closed.
- Losing all trusted devices is recoverable through the recovery code and/or the
  optional encryption passphrase.
- Losing all trusted devices *and* all recovery credentials results in
  unrecoverable encrypted data. This is intended, not a defect.

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
synchronization, validation, error handling.

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
6. Add or update tests.
7. Update the package README if shared functionality changed.
8. Run `pnpm turbo build test lint` and confirm it passes.

Placement: not reusable → `apps/<app>`. Reusable and an existing package owns the
responsibility → extend that package. Reusable with no owner → create it in the correct
package per the dependency table.
