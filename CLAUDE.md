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
  security/     encryption, secure storage, recovery codes, device registration,
                app lock, biometrics, session and token handling
  ui/           generic React Native components
  data/         repository, sync, import/export, validation, conflict handling
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
