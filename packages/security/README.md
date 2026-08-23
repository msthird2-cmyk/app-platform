# @platform/security

Encryption, secure storage, recovery codes, device registration, app lock, biometrics and session/token handling.

## Installation

Workspace package — depend on it from an application or a package that is allowed to:

```json
{ "dependencies": { "@platform/security": "workspace:*" } }
```

Import from the package root only:

```ts
import { /* … */ } from '@platform/security';
```

Deep paths such as `@platform/security/src/...` are rejected by ESLint, so internal files can change without it being a breaking change.

## Usage

```ts
import {
  WebCryptoService,
  assertStrongPassphrase,
  generateRecoveryCodes,
  hashRecoveryCodes,
} from '@platform/security';

const crypto = new WebCryptoService();

assertStrongPassphrase(passphrase);              // throws before anything is read
const payload = await crypto.encrypt(JSON.stringify(records), passphrase, {
  userId,                                        // bound in as authenticated data,
  appName,                                       // so the bundle cannot be replayed
});

const codes = generateRecoveryCodes(8);          // shown to the user once
const records = await hashRecoveryCodes(codes, crypto, { now: Date.now() });
```

## Public API

| Export | What it does |
| --- | --- |
| `CryptoService`, `EncryptedPayload`, `EncryptionContext`, `WebCryptoService` | AES-256-GCM with a PBKDF2-derived key, owner and application bound in as authenticated data |
| `SecretHash`, `hashSecret`, `verifySecret` | Salted, iterated hashing for values that must resist offline attack |
| `assessPassphrase`, `assertStrongPassphrase`, `PassphrasePolicy` | Passphrase strength, enforced before encryption |
| `SecureStorage` (with `isHardwareBacked`), `InMemorySecureStorage`, `BiometricsService`, `UnavailableBiometrics` | Storage and biometric interfaces plus fallbacks |
| `generateRecoveryCodes`, `hashRecoveryCodes`, `verifyRecoveryCode`, `remainingRecoveryCodes` | Single-use, expiring recovery codes stored as salted hashes |
| `AppLockState`, `registerFailedAttempt`, `isLockedOut`, `shouldAutoLock`, `assertUnlockable` | PIN lock with lockout and idle auto-lock |
| `SessionTokens`, `needsRefresh`, `msUntilRefresh`, `assertActive`, `createSessionStore` | Session lifetime and persistence |
| `getOrCreateDeviceId`, `assertRegistered`, `DeviceRegistry` | Per-install device identity |
| `SecurityError`, `SecurityErrorCode` | Typed failures |

## Configuration

Iteration count on `WebCryptoService` (defaults to 210,000). Applications inject a keystore-backed `SecureStorage` and `BiometricsService` in production.

## Dependencies

`@platform/utils`.

## Limitations

`WebCryptoService` needs a WebCrypto implementation; native builds should inject a keystore-backed service behind the same interface. `InMemorySecureStorage` and `UnavailableBiometrics` are fallbacks for tests and the web, not production storage — `isHardwareBacked` is `false`, and `createSessionStore` refuses to persist tokens to any store that reports `false`. **No hardware-backed implementation ships in this repository**: an application must inject one before sessions can be persisted at all.

Recovery-code verification is deliberately *not* wired to any storage. Comparing a code on the client means handing the client the hash list to compare against, so the Firestore rules close that path; a trusted server has to own the check.

## Tests

```
pnpm --filter @platform/security test
```
