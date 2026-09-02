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
| `SecureStorage` (with `protection`), `ProtectionTier`, `meetsProtection`, `assertMeetsProtection` | Storage contract and the tier every implementation must report honestly |
| `OsKeystoreStorage`, `SecureStoreBackend` | Android Keystore / iOS Keychain, over an injected `expo-secure-store` module |
| `WebNonExtractableStorage`, `createIndexedDbDatabase` | Browser tier: values sealed under a non-extractable WebCrypto key in IndexedDB |
| `createPlatformSecureStorage` | Picks the strongest store the runtime provides; throws when neither tier is available |
| `KeyCustody`, `KeyCustodyStatus`, `KeyCustodyOwner`, `createKeyCustody` | Custody of one owner's existing data encryption key — `absent` / `present` / `protected` / `unusable`, and never creates one. An owner is required |
| `custodyAddressFor`, `CUSTODY_ADDRESS_PREFIX` | Where an owner's custody record lives. Deterministic from the identity; hashed for storage-charset safety, not secrecy |
| `wrapDataKey`, `unwrapDataKey`, `changeDataKeyPassphrase`, `WrappedDataKey`, `assertWrappedDataKey`, `DATA_KEY_WRAPPER_PURPOSE` | The optional passphrase around the data key. The recovery escrow's construction with a different secret and its own purpose |
| `InMemorySecureStorage`, `BiometricsService`, `UnavailableBiometrics` | Test double and biometric interface plus fallback |
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

PBKDF2 in JavaScript is roughly an order of magnitude slower than the native implementation — about 130 ms for 100,000 rounds on a development machine, and slower on a phone. The iteration count was deliberately not lowered to compensate. `InMemorySecureStorage` reports the `memory` tier and is a test double, not production storage — `createSessionStore` and `createKeyCustody` both refuse it. Production stores now ship: `OsKeystoreStorage` for React Native and `WebNonExtractableStorage` for the browser, selected by `createPlatformSecureStorage` and injected from the composition root.

Two things about the tiers are worth stating plainly. `os-keystore` means the platform's secure storage is in use and **nothing more** — `expo-secure-store` cannot tell anyone whether the key is in hardware, so no implementation claims it is. And `browser-nonextractable` is a genuinely weaker tier: the wrapping key cannot be exported, but any script running in the origin can still use it, so a caller has to opt into that tier explicitly rather than arriving there by accident.

Custody never creates a key. `load()` returns `null` for a genuine absence and throws for anything else, because an entry that exists and cannot be read — an Android keystore key invalidated by a lock-screen change — must not be mistaken for no key at all. Mint a replacement in that situation and every record encrypted under the original is orphaned while still sitting in the database. `protected` is the same argument applied to a passphrase-wrapped key: present, shut, and openable by exactly one thing, which custody does not hold.

Custody belongs to an owner. `createKeyCustody` requires an authenticated identity and derives its own storage address from it, so a record is reachable only from that identity's session and two people sharing a device do not share a key. The owner is required rather than defaulted because a custody object that can be built without one addresses a record shared by everybody, which is the defect this replaced — the type is the enforcement, not a convention. The address is `platform.dek.v2.` followed by the hex SHA-256 of the identity: hashed so that any identifier a provider issues yields a storable key (`expo-secure-store` permits only `[A-Za-z0-9._-]`), and **not** for secrecy — anyone who can enumerate the keystore has already defeated what the address does. It is deterministic from the identity alone, with no device or install component, because an address that drifted would orphan a key whose owner can still reach it. An install predating per-user custody holds an orphaned `platform.dek.v1` record that nothing reads; its owner recovers with their recovery code.

Recovery-code verification is deliberately *not* wired to any storage. Comparing a code on the client means handing the client the hash list to compare against, so the Firestore rules close that path; a trusted server has to own the check.

## Tests

```
pnpm --filter @platform/security test
```

## The data-key passphrase

`dataKeyWrapper.ts` puts a passphrase in front of the key this device already
holds. It closes one specific gap: the keystore hands the DEK to anything
running as this application — `requireAuthentication` is off, because a
biometric prompt blocks the JavaScript thread and a background sync has no user
to prompt — and `os-keystore` says nothing about hardware, so on a
software-backed keystore only software stands between a device at rest and the
key.

```ts
await lifecycle.protect(passphrase);           // wraps the key already in custody
const key = await lifecycle.unlock(passphrase); // once per cold start
await lifecycle.changePassphrase(current, next);
lifecycle.lock();                               // forgets the opened copy
```

What it deliberately is not:

- **Not a recovery path.** The recovery code opens the escrow independently, so
  forgetting the passphrase costs this device and not the data. Setup, recovery
  and pairing adoption all still write the unprotected envelope, because each is
  a moment at which a key *arrives* and none of them holds a passphrase.
- **Not a second layer around records.** Only the 32-byte DEK is wrapped, so
  changing a passphrase re-wraps a key rather than re-encrypting a portfolio,
  and no record envelope, AAD or format changes at all.
- **Not new cryptography.** Same `CryptoService`, same AES-GCM envelope, same
  KDF cost, same `assertSupportedPayload` bounds as the recovery escrow. The
  purpose `data-key-wrapper.v1` is what stops one being replayed as the other.
- **Not offered as removable.** There is no "remove passphrase": its failure
  mode is silent — the user believes the key is protected when it is not — and
  nothing in the product needs it.

The passphrase is never persisted, logged, transmitted, or held anywhere beyond
the call that uses it; the opened *key* is held for the session, because the KDF
costs about twenty-five seconds on a phone and the repository asks for the key
on every operation. `scripts/check-architecture.mjs` enforces the first half.

`recover` and `adoptPairedKey` both refuse a `protected` device, so neither can
drop the protection as a side effect, and `exportForPairing` goes through
`load()`, so a locked device cannot hand out a key it has not itself opened.

## Trusted-device pairing

`pairing.ts` is the protocol — ephemeral P-256 ECDH, a commitment to the
initiator's public key, a six-digit code derived from both keys, and the data
encryption key wrapped under an HKDF transport key. `pairingSession.ts` is the
orchestration on top of it, split into a pure decision (`pairingProgress`) and a
driver (`createPairingSession`) that performs the relay I/O the decision asks
for.

```ts
const session = createPairingSession({
  role: 'initiator',            // or 'responder' on the device without a key
  relay,                        // FirebasePairingRelay in production
  lifecycle,                    // the DataKeyLifecycle for the signed-in user
  cipher, randomBytes, userId, appName,
});
session.subscribe((view) => render(view.phase, view.code));
await session.start();          // the responder calls join(sessionId) instead
await session.confirm();        // only after a person compared the digits
```

Three properties the API is shaped to keep:

- `PairingSessionView` carries a phase, a session id, six digits and a failure
  reason. No key material of any kind is on it, so a screen cannot leak one.
- Confirmation is local. Nothing about it is written to the relay, and there is
  no `verified` field to write it to.
- Nothing here creates a key. `exportForPairing` refuses unless one is already
  in custody; `adoptPairedKey` refuses when custody is `present`, `protected`
  *or* `unusable`. Every failure leaves both devices exactly as they were.

`InMemoryPairingRelay` restates the Security Rules' append-only constraints, so
a driver that passes against it is a driver that works against Firestore.
