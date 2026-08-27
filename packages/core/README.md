# @platform/core

The composition root. Wires injected services, theme and auth into one provider tree so applications contain no wiring of their own.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/core": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/core';
```

Deep paths such as `@platform/core/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```tsx
import { AppCore } from '@platform/core';

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
</AppCore>;
```

## Public API

| Export | What it does |
| --- | --- |
| `AppCore` | Theme + services + auth providers, with a signed-in / signed-out gate |
| `ServicesProvider`, `useServices` | Dependency injection container |
| `useAccountService`, `useBackupService`, `useRepository`, `useCryptoService`, `useAppConfig` | Typed accessors |
| `AppConfig`, `isFeatureEnabled` | Application-supplied configuration |

## Configuration

Everything is a prop. `core` holds no defaults for app name, project or feature flags.

## Dependencies

Every shared package.

## Limitations

Composition only — no application business rules belong here. If a rule is specific to one app's domain, it goes in `apps/<name>/`.

## Tests

```
pnpm --filter @platform/core test
```

## Trusted-device pairing

Pass `pairingRelay` (and `randomBytes`) to `AppCore` and the pairing flow
becomes available:

```tsx
<AppCore
  /* … */
  dataKeyLifecycleFor={dataKeyLifecycleFor}
  recordCipher={recordCipher}
  pairingRelay={firebasePairingRelay}
  randomBytes={getRandomBytes}
>
```

With it, `DataKeyGate` offers "Use another signed-in device" beside the recovery
code, and `PairNewDeviceButton` renders wherever an application places it on the
trusted-device path. Without it neither appears, because a button that starts
something the application cannot finish is worse than no button.

The gate never offers pairing from `unusable` custody, and never falls back
between pairing and recovery in either direction — both are explicit choices the
user makes.

`PairingFlow` renders; it does not compute. Every protocol decision is in
`@platform/security`, and `pairingStep` / `pairingFailureMessage` are pure
functions this package tests directly, in the absence of component-test
infrastructure.
