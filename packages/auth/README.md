# @platform/auth

Authentication surface: credential validation, the auth context, and the login, signup, password-reset and device-verification screens.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/auth": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/auth';
```

Deep paths such as `@platform/auth/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```tsx
import { AuthProvider, LoginScreen } from '@platform/auth';

<AuthProvider service={firebaseAuthService}>
  <LoginScreen messageForCode={messageForCode} onForgotPassword={…} onCreateAccount={…} />
</AuthProvider>;
```

## Public API

| Export | What it does |
| --- | --- |
| `AuthService`, `AuthUser`, `Credentials` | The authentication contract |
| `AuthProvider`, `useAuth` | Auth state and actions |
| `validateEmail`, `validatePassword`, `validateCredentials`, `PasswordPolicy` | Pure credential checks returning codes |
| `LoginScreen`, `SignupScreen`, `PasswordResetScreen`, `DeviceVerification` | Screens |
| `AuthError`, `AuthErrorCode` | Typed failures |

## Configuration

`messageForCode` maps error codes to the application's own copy. `PasswordPolicy` is overridable.

## Dependencies

`@platform/ui`, `@platform/theme`, `@platform/utils`, `@platform/security`.

## Limitations

No authentication is performed here — the injected `AuthService` does the work. Credential validation never echoes the password in a failure.

## Tests

```
pnpm --filter @platform/auth test
```
