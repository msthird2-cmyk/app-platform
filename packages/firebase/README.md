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

// App Check is not optional: an application states how it attests, or states
// why it does not. The API key is public, so without attestation anyone can
// call the backend directly and every client-side control becomes advisory.
const app = createFirebaseApp(config, {
  appCheck: { provider: 'recaptcha-enterprise', siteKey },
});
const authService = new FirebaseAuthService(app);
const repository = new FirebaseRepository(app, () => currentUserId, COLLECTIONS);
```

## Public API

| Export | Implements |
| --- | --- |
| `createFirebaseApp`, `FirebaseConfig`, `AppCheckOptions` | App initialisation from application-supplied config; App Check is a required argument |
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

Documents live under `users/{uid}/{collection}` so one user's data can be secured, exported and deleted as a single subtree. That layout is enforced by `firestore.rules` and `storage.rules` at the repository root, tested by `pnpm test:rules` against the Firebase emulators.

`updatedAt` and `deletedAt` are written with `serverTimestamp()` and required by the rules to equal `request.time`, so a device cannot claim a timestamp it did not earn. `FirebaseRepository.put` reads the record back and returns it for that reason — the caller must store what the server stored.

Device verification fails closed with `DEVICE_VERIFICATION_UNAVAILABLE`: issuing a code and deciding the outcome both require a trusted server, which the Spark plan does not provide.

## Tests

```
pnpm --filter @platform/firebase test
```
