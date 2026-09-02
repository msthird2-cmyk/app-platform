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
| `InMemoryAuthService` | A working AuthService with no backend, for previews and tests |
| `LoginScreen`, `SignupScreen`, `PasswordResetScreen`, `DeviceVerification` | Screens |
| `AuthError`, `AuthErrorCode` | Typed failures |

## Configuration

`messageForCode` maps error codes to the application's own copy. `PasswordPolicy` is overridable.

## Dependencies

`@platform/ui`, `@platform/theme`, `@platform/utils`, `@platform/security`.

## Limitations

No authentication is performed here — the injected `AuthService` does the work. Credential validation never echoes the password in a failure.

**Cold start races the persistence restore — live.** `AuthProvider`
(`src/AuthProvider.tsx:34-43`) calls `getCurrentUser()` and clears
`initializing` in its `.finally()` (`:42`) regardless of the result. Firebase's
implementation reads `auth.currentUser` synchronously
(`packages/firebase/src/services/FirebaseAuthService.ts:51-54`), and that is
`null` until the persisted session has been restored. Two consequences: on a
cold start with a valid session the signed-out view can render before
`onAuthStateChanged` delivers the real user, and in the losing interleaving the
`.then()` at `:38` can overwrite an already-restored user with `null`. There is
no custody impact — a null user builds no lifecycle and therefore no custody —
but a signed-in person can be shown as signed out.

## Tests

```
pnpm --filter @platform/auth test
```
