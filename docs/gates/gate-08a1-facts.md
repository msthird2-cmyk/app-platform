# Gate 8A.1 — Prerequisite facts for Gate 8B

Base: branch `gate-08a-audit` at `8011234`. `docs/gates/gate-08a-audit.md` is
treated as established and is not re-derived.

Facts only. No design, no recommendation, no risk classification. Where a
question is not answerable from this repository it says so and names the
artifact that would answer it.

---

## Q1 — Can a second local account learn the first user's uid?

Surfaces checked, each with what was found.

### Custody envelopes

Neither stored form carries an identity.

- v1 — `{v:1,k:<base64 DEK>}` (`packages/security/src/keyCustody.ts`, envelope
  written at `:210`). Two fields, no `uid`.
- v2 — `{v:2,w:{version,wrappedKey:{version,algorithm,iterations,salt,iv,
  ciphertext}}}` (`:218`). The `uid` is in the **AAD**, which is recomputed at
  decrypt from the caller's context and is never serialised. Asserted already by
  `packages/security/tests/dataKeyWrapper.test.ts:42-45`, which pins the exact
  key sets of both objects.

### Record envelopes

`{v,alg,iv,ct}` — `packages/security/src/recordEnvelope.ts`. `uid` appears only
inside `recordAdditionalData` (`:56-68`), which is computed at call time and not
stored. `packages/data/tests/encryptingRepository.test.ts` pins the stored shape
to `id, revision, updatedAt, deletedAt` plus the encrypted field.

### Firestore paths and rules

Every rule is scoped under `users/{uid}` — `firestore.rules:130`, `:156`,
`:176`, `:185`, `:191`, `:250`, `:394`, `:412`, `:419` — closed by a default
deny at `:425-427` (`allow read, write: if false`).

Both path builders anchor to the token, not to a caller-supplied value:

- `packages/firebase/src/composition.ts:73` — the repository is constructed with
  `() => auth.currentUser?.uid ?? null`.
- `packages/firebase/src/services/FirebaseRecoveryEscrowStore.ts:41-42` and
  `packages/firebase/src/services/FirebasePairingRelay.ts:74-75` — both read
  `this.auth.currentUser?.uid`.

So while Bob is signed in, no code path in the application constructs a path
containing Alice's uid, and the rules would refuse one if it did.

### Local caches, sync state, queues, offline stores

- **No Firestore local persistence is configured.** `composition.ts:65` uses
  `getAuth(app)` and the repository is built directly; there is no
  `initializeFirestore`, `persistentLocalCache`, or
  `enableIndexedDbPersistence` call anywhere in `packages/` or `apps/`.
- **The session store is never wired.** `createSessionStore`
  (`packages/security/src/session.ts:52`) persists `SessionState`, which *does*
  contain `userId` (`:12-15`), under `platform.session` (`:39`). Its only
  references outside its own module are the barrel re-export at
  `packages/security/src/index.ts:131` and tests. **No production caller.** The
  key is therefore never written.
- **The device-id store is never wired.** `getOrCreateDeviceId`
  (`packages/security/src/deviceRegistration.ts:30`) — same: barrel re-export at
  `index.ts:136` and tests only. It stores a random id, not a uid, regardless.
- No `AsyncStorage`, `localStorage`, `sessionStorage` or IndexedDB write of a
  uid exists: a sweep of every `storage.set` / `setItem` / `save(` / `persist`
  call reachable from non-test code returns **no** result carrying `userId` or
  `.uid`.

### Logs, errors, debug surfaces

- Three production log call sites carry a payload, none with an identity:
  `packages/auth/src/AuthProvider.tsx:40` (message only),
  `packages/account/src/services/deleteAccountFlow.ts:87` (`{steps: count}`),
  `packages/data/src/importExport.ts:44` (`{appName, collections: count}`),
  `packages/data/src/sync/syncEngine.ts:71` (counts only).
- `SecurityError` (`packages/security/src/errors.ts:3-5`) extends `CodedError`
  and adds only `domain`; it carries a code and an optional `cause`, no context
  object.
- The architecture guard already forbids a secret reaching a log
  (`scripts/check-architecture.mjs`, `SECRET_LOG`), and Gate 7 added a
  passphrase-specific sink guard; neither covers `uid`, because no site emits one.

### Backup / export files

`buildExportBundle` (`packages/data/src/importExport.ts:27-33`) produces
`{schemaVersion, appName, exportedAt, collections}`. No uid. The encryption
context supplies `uid` to the AAD only, and the AAD is not written to the file.

**Answer: uid is not discoverable — no surface was found through which a second
local account can obtain the first user's uid by normal use of the application,
without filesystem or keystore access.**

Scope of that negative, stated so 8B does not over-read it: it is the result of
checking the surfaces listed above, not a proof that none exists. Two things
bound it usefully. First, the same rules that withhold Alice's uid also withhold
Alice's ciphertext (`firestore.rules:130`, default deny at `:425`), so within
this application Bob lacks **both** inputs, not just one. Second, the negative is
about the application's own surfaces only; it says nothing about a device backup,
an OS-level keystore dump, or ciphertext obtained from anywhere other than this
app — the brief excluded those, and this answer does not cover them.

---

## Q2 — Escrow coverage for v1-era users

### Every code path that creates a v1 slot

`custody.store()` is the only writer of a v1 envelope, and it has exactly three
production call sites.

| # | Call site | Escrow for the storing user | Why |
| --- | --- | --- | --- |
| 1 | `dataKeyLifecycle.ts:316` — `initialize()` | **Guaranteed** | `escrowStore.save(...)` runs first at `:315`; `custody.store(dataKey)` at `:316`. A save that throws propagates before the slot is written, so the ordering cannot produce a slot without an escrow. |
| 2 | `recoveryEscrow.ts:202` — `recoverDataKey()` | **Guaranteed, pre-existing** | The escrow was just opened to obtain the key (`:198`); a missing escrow raises `RECOVERY_ESCROW_MISSING` (`:196`) before anything is stored. |
| 3 | `pairing.ts:440` — `completePairing()` | **Conditional** | It writes custody and **no escrow**. Nothing in the pairing path creates one. |

### The condition on path 3, stated precisely

Pairing writes an escrow for nobody. A user U who obtains a v1 slot through
`completePairing` has an escrow **iff U previously ran `initialize()` under U's
own identity** (on this or another device). Pairing is intra-account — both path
builders anchor to `auth.currentUser.uid` (`FirebasePairingRelay.ts:74-75`) — so
in the intended flow U's escrow exists, having been written on the device that
originally set the key up.

### The class of users outside that condition

There is a fourth way to hold a v1 slot that is **not** a code path at all, and
it is the Gate 8 defect: a user reads a slot that some other user's
`initialize()` created. No `custody.store` runs for them, so none of the three
guarantees applies.

Precisely: **any user U who signs in on a device whose slot was created under a
different identity V, where U has never run `initialize()` on any device, holds a
v1 slot and has no escrow.** Established by reproduction sequence 1 in
`packages/security/tests/gate08-isolation.repro.test.ts` — Bob is `ready` and
`escrow.as(BOB).load()` is `null`.

This state also **propagates through pairing**. `exportForPairing` requires only
that custody be `present` or `protected` (`dataKeyLifecycle.ts:351`), which
U satisfies while reading V's slot. U can therefore pair a second device and
place V's key on it under U's identity, still with no escrow for U anywhere.

### Why the application cannot see the condition

`status()` consults the escrow **only when custody is absent**
(`dataKeyLifecycle.ts:209-227`): `present` returns `ready` at `:211` without any
escrow lookup. So a user with no escrow and someone else's slot is reported
identically to a fully provisioned one.

The condition is nonetheless observable at runtime, and this is a fact rather
than a suggestion about what to do with it: escrow existence is a server-side
per-user document (`FirebaseRecoveryEscrowStore.path()`, anchored to
`auth.currentUser.uid` at `:41-42`), already loaded by the same lifecycle
(`escrowStore.load()` at `:220`). `status() === 'ready'` together with
`escrowStore.load() === null` distinguishes the affected users exactly.

### Can an escrow exist but be unrecoverable without local state?

No. `recoverDataKey` (`recoveryEscrow.ts:193-205`) takes the escrow document,
the recovery code, a `CryptoService`, and `context = {userId, appName}` — all
available on a fresh install. It reads nothing from custody or any local store
before writing the recovered key. A user with an escrow and their recovery code
can recover on a device that has never seen their data.

The one thing not derivable from anything stored is the recovery code itself: it
is returned once from `initialize()` (`dataKeyLifecycle.ts:318`) and is written
to no store. That is by design, not a local-state dependency.

**Answer: escrow creation is guaranteed for `initialize()` and for recovery, and
absent from pairing, which relies on the user having initialised earlier. A
distinct class of users — anyone reading a slot created under another identity
who has never run `initialize()` — holds a v1 slot with no escrow, is reported as
`ready`, and can propagate that state to further devices through pairing.**

---

## Q3 — Anonymous authentication

- **No call site.** `signInAnonymously`, `isAnonymous`, `AnonymousProvider`,
  `linkWithCredential` and `linkWithPopup` return **no** matches across
  `packages/`, `apps/` and `tools/`, excluding `dist/`.
- **The interface offers no anonymous path.** `AuthService`
  (`packages/auth/src/types/auth.ts:20-21`) exposes `signIn(credentials)` and
  `signUp(credentials, displayName?)` only; `Credentials` is email plus
  password.
- **The implementation offers no anonymous path.**
  `FirebaseAuthService.signIn` uses `signInWithEmailAndPassword`
  (`packages/firebase/src/services/FirebaseAuthService.ts:58`). Email/password is
  the only mechanism present.
- **No configuration reference.** `firebase.json`, `firestore.rules` and
  `.github/` contain no mention of anonymous auth.

Because the application contains no anonymous sign-in call, no anonymous session
can be created by these apps regardless of what the Firebase project permits.
The follow-on questions — whether an anonymous session could create custody, and
what happens on link-to-permanent — are therefore unreachable in this codebase
and have no behaviour to establish.

**Answer: anonymous authentication is absent — not enabled and not reachable in
any of the three production apps.** Whether it is enabled in the Firebase console
for project `app-platform-27763` is not determinable from this repository; it
would not change the answer, since no code path calls it.

---

## Q4 — Does a v2 unwrap prove ownership?

### What the AAD binds

`additionalData` (`packages/security/src/crypto/envelope.ts:32-52`) produces:

```json
{"v":…,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","it":…,"uid":…,"app":…[,"pur":…]}
```

For a data-key wrapper, `pur` is `data-key-wrapper.v1`
(`packages/security/src/dataKeyWrapper.ts:39`) and `context` is `{userId,
appName}` (`apps/networth/App.tsx:69`). **There is no device, install, session or
hardware component.**

### Nothing device-scoped on the decrypt side either

Both implementations build the decrypt AAD entirely from the stored envelope
plus the caller's context, never from device configuration:

- `WebCryptoService.ts:125-127` — `additionalData(context, payload.iterations,
  payload.version)`.
- `PortableCryptoService.ts:150` — the same.

The salt and IV are carried in the envelope (`:118-122`), and the key is derived
with `payload.iterations` (`WebCryptoService.ts:118`). So a device whose service
is configured with a different iteration count still decrypts an existing
wrapper correctly. Reinstalling, or moving to a second device, changes nothing
the AAD depends on.

### What a result actually tells you

- **Success proves the wrapper was created for that `uid` and `appName`.** The
  tag covers `uid`, so it cannot verify under a different identity. Demonstrated
  by `packages/security/tests/dataKeyWrapper.test.ts:103-112` — the same wrapper
  and the same passphrase are refused under another `userId` and under another
  `appName`.
- **Success requires the passphrase.** `unwrapDataKey`
  (`dataKeyWrapper.ts:142-164`) has no path that opens a wrapper without one.
  Ownership cannot be tested silently; it can only be tested by asking the user
  to type something.
- **Failure is ambiguous.** Wrong identity, wrong passphrase, tampered
  ciphertext, tampered IV, tampered salt and a changed iteration count all
  surface as the single code `DECRYPTION_FAILED`
  (`dataKeyWrapper.test.ts:74-101`, `:103-112`). This is deliberate — the module
  comment at `:136-140` states that a distinguishable failure would be an
  oracle — and it means a failed unwrap **cannot** be read as "this slot belongs
  to someone else".

**Answer: unwrap proves ownership only under conditions — a success proves the
wrapper was created for the current `uid` and `appName`, and holds across
reinstall and across devices because nothing in the AAD is device- or
session-scoped; but it requires the user to supply the passphrase, and a failure
does not disprove ownership, because wrong-passphrase and wrong-identity are
indistinguishable by design.**

---

## Not determinable from this repository

1. **Whether anonymous authentication is enabled in the Firebase console** for
   `app-platform-27763` (Q3). Would be answered by: the Authentication →
   Sign-in method page for that project, or `firebase auth:export`. Does not
   change the Q3 answer — no code path calls it.
2. **Firebase Auth UID stability** across reinstall, email change and account
   linking (carried over as OQ-3 from 8A, and untouched here). Would be answered
   by: Firebase Authentication's documented guarantees for `User.uid`. Nothing in
   this repository asserts, tests or depends on it in a way that reveals it.

Both are stated as unanswered rather than inferred.

---

GATE 8A.1 COMPLETE — 4 answered, 2 not determinable from repo
