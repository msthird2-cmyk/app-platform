# app-platform

A monorepo for three financial applications — **Net Worth**, **Investment** and
**Expense** — on one shared platform. Common functionality is built once in
`packages/`; each application contains only its own business logic and
configuration.

The operative rule set is [`CLAUDE.md`](./CLAUDE.md). The reasoning behind the
structure is in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Layout

```
apps/
  networth/     net worth calculation, asset categories, liabilities, dashboard
  investment/   portfolio performance, holdings, investment analytics
  expense/      categorization, budgets, expense analytics
packages/
  utils/        dates, formatting, currency, validation, safe logging
  theme/        design tokens, ThemeProvider, ThemeSelector
  security/     encryption, secure storage, recovery codes, app lock, sessions
  ui/           generic React Native components
  data/         repository, sync, import/export, validation, conflict handling
  auth/         login, signup, password reset, device verification
  account/      profile, settings, delete account, delete/export user data
  backup/       manual and automatic backup, restore, status, progress
  firebase/     Firebase implementations of the service interfaces
  core/         AppCore composition root and shared providers
```

Each package documents itself in its own `README.md`.

## Getting started

```bash
pnpm install
pnpm turbo build test lint
```

Run one application:

```bash
pnpm --filter @app/networth start     # Expo
pnpm --filter @app/networth web       # react-native-web
```

Work on one package:

```bash
pnpm --filter @platform/data test
pnpm --filter @platform/data build
```

## Stack

pnpm workspaces + Turborepo · TypeScript `strict` · React Native via Expo, with
`react-native-web` for the web target · Firebase behind service interfaces.

## How the pieces fit

```
Component → ServiceInterface → FirebaseXService → Firebase
```

Interfaces live with their domain package; implementations live in
`packages/firebase`; everything is injected at the composition root:

```tsx
<AppCore
  appName="Net Worth"
  collections={['assets', 'liabilities']}
  authService={firebaseAuthService}
  accountService={firebaseAccountService}
  backupService={firebaseBackupService}
  repository={firebaseRepository}
  cryptoService={cryptoService}
  secureStorage={secureStorage}
  signedOut={<LoginScreen … />}
>
  <Dashboard />
</AppCore>
```

No shared component constructs a concrete service for itself.

## Enforcement

The architecture is checked, not just documented.

| Rule | Enforced by |
| --- | --- |
| Dependency direction between packages | Per-package `no-restricted-imports` overrides generated from the table in `eslint.config.mjs` |
| Firebase imported only in `packages/firebase` | ESLint `no-restricted-imports` + `scripts/check-architecture.mjs` |
| `packages/firebase` imports types only | `scripts/check-architecture.mjs` |
| No web DOM elements in the UI | ESLint `no-restricted-syntax` |
| No CSS, Tailwind or styled-components | `scripts/check-architecture.mjs` |
| No deep imports into a package's internals | ESLint `no-restricted-imports` |
| Nothing in `packages/` imports from `apps/` | `scripts/check-architecture.mjs` |
| Every shared package has a public API and a README | `scripts/check-architecture.mjs` |

If a change appears to require editing the boundary configuration, stop and
explain the architectural conflict — do not widen the rule to make code compile.

## Testing

```bash
pnpm turbo test                  # every package
pnpm --filter @platform/security test
```

Priority areas — authentication, account deletion, data deletion, backup,
restore, encryption, recovery codes, session management, synchronization,
validation and error handling — all have tests. Deletion ordering in particular
has a regression test that asserts the authentication account is deleted last.

Tests cover pure logic. Importing `react-native` pulls in Flow-typed source that
a plain test runner cannot parse, so logic that needs testing is kept in modules
free of it (`packages/theme/src/scheme.ts` is the pattern). Component tests need
a `react-native` → `react-native-web` alias.
