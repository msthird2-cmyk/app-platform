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
import { WebCryptoService, generateRecoveryCodes, hashRecoveryCodes } from '@platform/security';

const crypto = new WebCryptoService();
const payload = await crypto.encrypt(JSON.stringify(records), passphrase);

const codes = generateRecoveryCodes(8);          // shown to the user once
const hashes = await hashRecoveryCodes(codes, crypto); // only these are stored
```

## Public API

| Export | What it does |
| --- | --- |
| `CryptoService`, `EncryptedPayload`, `WebCryptoService` | AES-GCM with a PBKDF2-derived key |
| `SecureStorage`, `InMemorySecureStorage`, `BiometricsService`, `UnavailableBiometrics` | Storage and biometric interfaces plus fallbacks |
| `generateRecoveryCodes`, `normalizeRecoveryCode`, `hashRecoveryCodes`, `verifyRecoveryCode` | Single-use recovery codes, stored hashed |
| `AppLockState`, `registerFailedAttempt`, `isLockedOut`, `shouldAutoLock`, `assertUnlockable` | PIN lock with lockout and idle auto-lock |
| `SessionTokens`, `needsRefresh`, `msUntilRefresh`, `assertActive`, `createSessionStore` | Session lifetime and persistence |
| `getOrCreateDeviceId`, `assertRegistered`, `DeviceRegistry` | Per-install device identity |
| `SecurityError`, `SecurityErrorCode` | Typed failures |

## Configuration

Iteration count on `WebCryptoService` (defaults to 210,000). Applications inject a keystore-backed `SecureStorage` and `BiometricsService` in production.

## Dependencies

`@platform/utils`.

## Limitations

`WebCryptoService` needs a WebCrypto implementation; native builds should inject a keystore-backed service behind the same interface. `InMemorySecureStorage` and `UnavailableBiometrics` are fallbacks for tests and the web, not production storage.

## Tests

```
pnpm --filter @platform/security test
```
