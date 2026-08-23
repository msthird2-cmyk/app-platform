# @platform/firebase

Firebase implementations of the platform service interfaces. The only place in the repository that may import Firebase.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/firebase": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/firebase';
```

Deep paths such as `@platform/firebase/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```ts
import { createFirebaseApp, FirebaseAuthService, FirebaseRepository } from '@platform/firebase';

const app = createFirebaseApp(config);          // config comes from the application
const authService = new FirebaseAuthService(app);
const repository = new FirebaseRepository(app, () => currentUserId, COLLECTIONS);
```

## Public API

| Export | Implements |
| --- | --- |
| `createFirebaseApp`, `FirebaseConfig` | App initialisation from application-supplied config |
| `FirebaseAuthService` | `AuthService` |
| `FirebaseRepository` | `Repository` |
| `FirebaseAccountService` | `AccountService` |
| `FirebaseBackupService` | `BackupService` |
| `AdaptedSecureStorage` | `SecureStorage`, over a platform key-value store |
| `ServiceError`, `isServiceError` | Structural coded error raised by these adapters |

## Configuration

The application passes the whole `FirebaseConfig`. Nothing about a project, bucket or collection is hard-coded here.

## Dependencies

`firebase` only. Every platform package is imported for **types** alone — hence they are dev dependencies.

## Limitations

Because this package may not value-import a domain package, it cannot construct that domain's error class. It raises `ServiceError` instead, which carries the same `domain` and `code` and is recognised by `errorCode()` in `@platform/utils`. Codes are checked against the domain's own union at compile time with `satisfies`.

Documents live under `users/{uid}/{collection}` so one user's data can be secured, exported and deleted as a single subtree.

## Tests

```
pnpm --filter @platform/firebase test
```
