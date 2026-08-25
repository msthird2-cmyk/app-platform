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
import { getRandomBytes } from 'expo-crypto';
import {
  createCryptoService,
  assertStrongPassphrase,
  generateRecoveryCodes,
  hashRecoveryCodes,
} from '@platform/security';

// The composition root picks the implementation and supplies the platform's
// entropy. WebCrypto is used wherever it exists; React Native falls through to
// the portable implementation, which writes the identical envelope.
const crypto = createCryptoService({ randomBytes: getRandomBytes });

assertStrongPassphrase(passphrase);              // throws before anything is read
const payload = await crypto.encrypt(JSON.stringify(records), passphrase, {
  userId,                                        // bound in as authenticated data,
  appName,                                       // so the bundle cannot be replayed
});

const codes = generateRecoveryCodes(getRandomBytes, 8);  // shown to the user once
const records = await hashRecoveryCodes(codes, crypto, { now: Date.now() });
```

## Public API

| Export | What it does |
| --- | --- |
| `CryptoService`, `EncryptedPayload`, `EncryptionContext` | AES-256-GCM with a PBKDF2-derived key, owner and application bound in as authenticated data |
| `createCryptoService` | Picks `WebCryptoService` where WebCrypto exists, `PortableCryptoService` otherwise |
| `WebCryptoService` | The WebCrypto implementation. Preferred: the derived key stays a non-extractable `CryptoKey` |
| `PortableCryptoService`, `RandomBytes` | The React Native implementation. No runtime globals; entropy is injected |
| `MIN_KDF_ITERATIONS`, `MAX_KDF_ITERATIONS`, `DEFAULT_KDF_ITERATIONS`, `assertAllowedIterationCount` | The single KDF cost policy, applied when configuring a service and again when reading a payload |
| `SecretHash`, `hashSecret`, `verifySecret` | Salted, iterated hashing for values that must resist offline attack |
| `assessPassphrase`, `assertStrongPassphrase`, `PassphrasePolicy` | Passphrase strength, enforced before encryption |
| `SecureStorage` (with `isHardwareBacked`), `InMemorySecureStorage`, `BiometricsService`, `UnavailableBiometrics` | Storage and biometric interfaces plus fallbacks |
| `generateRecoveryCodes`, `hashRecoveryCodes`, `verifyRecoveryCode`, `remainingRecoveryCodes` | Single-use, expiring recovery codes stored as salted hashes. Generation takes the platform's entropy source, like `PortableCryptoService` |
| `RandomBytes`, `drawRandomBytes` | The one entropy contract. Injected from the composition root and validated on every draw |
| `AppLockState`, `registerFailedAttempt`, `isLockedOut`, `shouldAutoLock`, `assertUnlockable` | PIN lock with lockout and idle auto-lock |
| `SessionTokens`, `needsRefresh`, `msUntilRefresh`, `assertActive`, `createSessionStore` | Session lifetime and persistence |
| `getOrCreateDeviceId`, `assertRegistered`, `DeviceRegistry` | Per-install device identity |
| `SecurityError`, `SecurityErrorCode` | Typed failures |

## Configuration

Iteration count (defaults to 210,000, and must fall between `MIN_KDF_ITERATIONS` and `MAX_KDF_ITERATIONS`), and the entropy source for `PortableCryptoService`. Applications inject a keystore-backed `SecureStorage` and `BiometricsService` in production.

## Choosing an implementation

`createCryptoService` prefers `WebCryptoService`, because WebCrypto's `deriveKey` returns a non-extractable `CryptoKey` — the derived key is never a JavaScript value. React Native provides no WebCrypto, so there it returns `PortableCryptoService`, where the key is a `Uint8Array` for the duration of one operation and is zeroed afterwards. That is a real reduction in protection, accepted because the alternatives were a native module needing a custom Android build or no working crypto on React Native at all.

Both write the same envelope. `tests/crossImplementation.test.ts` proves each reads what the other wrote, byte for byte, including a payload recorded from the implementation that predates the portable one — so a backup taken on the web restores on a phone and the reverse.

## Entropy

Everything that needs randomness takes a `RandomBytes` from the composition root: `PortableCryptoService` for its salts and nonces, and `generateRecoveryCode` for its symbols. There is one contract, not two, and no default — a generator that silently falls back to a weaker source is worse than one that refuses to run. `drawRandomBytes` validates every draw, because the realistic wiring mistake is not a weak generator but an absent one, and a stub returning zeroes destroys every salt, nonce and recovery code without failing anywhere visible.

`scripts/check-architecture.mjs` walks the imports out from `PortableCryptoService` **and from `recoveryCodes`** and fails the build if anything on either path uses `crypto.subtle`, `crypto.getRandomValues`, `btoa`, `atob`, `TextEncoder` or `TextDecoder`. React Native 0.76 provides none of them, and reaching for one would fail on a user's device rather than in CI.

## Dependencies

`@platform/utils`, `@noble/ciphers` and `@noble/hashes` — audited, dependency-free, pure-JavaScript AES-GCM and PBKDF2-SHA256 that run on Hermes with no native build. They are used only by `PortableCryptoService`; `WebCryptoService` still calls WebCrypto.

## Limitations

`WebCryptoService` needs a WebCrypto implementation; on React Native use `createCryptoService`, which falls through to `PortableCryptoService`. Neither holds a key in hardware — a keystore-backed implementation behind the same interface is still the stronger option where one exists.

PBKDF2 in JavaScript is roughly an order of magnitude slower than the native implementation — about 130 ms for 100,000 rounds on a development machine, and slower on a phone. The iteration count was deliberately not lowered to compensate. `InMemorySecureStorage` and `UnavailableBiometrics` are fallbacks for tests and the web, not production storage — `isHardwareBacked` is `false`, and `createSessionStore` refuses to persist tokens to any store that reports `false`. **No hardware-backed implementation ships in this repository**: an application must inject one before sessions can be persisted at all.

Recovery-code verification is deliberately *not* wired to any storage. Comparing a code on the client means handing the client the hash list to compare against, so the Firestore rules close that path; a trusted server has to own the check.

## Tests

```
pnpm --filter @platform/security test
```
