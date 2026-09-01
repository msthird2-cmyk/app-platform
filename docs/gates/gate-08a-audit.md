# Gate 8A — Per-user device-key custody isolation: audit

Base commit `b7a6d0b6efaeb6333c2707adb74208e9e9a79341` (Gate 7 merged).
Audit only. Every claim below cites `file:line` at that commit. Where something
could not be found, it says "not found" rather than inferring it.

No fixes are proposed here. Where the code cannot answer a question, it is
routed to [Open questions](#open-questions).

---

## 1. Architecture as-built

### 1.1 The custody slot

`packages/security/src/keyCustody.ts:96`

```ts
const DEFAULT_STORAGE_KEY = 'platform.dek.v1';
```

`keyCustody.ts:165` resolves the slot once, at construction:

```ts
const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
```

Every read and write goes through that one resolved constant —
`:171`, `:186`, `:210`, `:218`, `:224`, `:235`. **No custody operation takes an
identity.** `createKeyCustody(storage, options)` (`:157-159`) has no `userId`
parameter and no access to one.

`storageKey` **is** an option (`keyCustody.ts:93`). The mechanism to namespace
already exists and is exercised — `tools/x1-selftest/selfTest.ts:300`, `:586`,
`:587` pass distinct keys to simulate two devices in one process. It is
recorded here as a fact about the current code, not as a proposal.

### 1.2 Production call sites

All three applications construct custody identically, with no `storageKey`:

| App | Line |
| --- | --- |
| Net Worth | `apps/networth/App.tsx:71` |
| Expense | `apps/expense/App.tsx:69` |
| Investment | `apps/investment/App.tsx:67` |

```ts
custody: createKeyCustody(secureStorage, { minimumProtection }),
```

So all three use `platform.dek.v1` for every user on the device.

### 1.3 Sign-in → identity → custody → DEK → repository

1. `packages/auth/src/AuthProvider.tsx:27-48` subscribes to
   `service.onAuthStateChanged` and separately calls `service.getCurrentUser()`.
2. `packages/core/src/AppCore.tsx:80-83` builds the lifecycle, memoised on the
   user id:
   ```ts
   const lifecycle = useMemo(
     () => (user ? dataKeyLifecycleFor(user.id) : null),
     [user?.id, dataKeyLifecycleFor],
   );
   ```
3. `AppCore.tsx:108` — `if (initializing) return <Loading label="Starting" />`.
4. `AppCore.tsx:109` — `if (!user || !lifecycle) return <>{signedOut}</>`.
5. `AppCore.tsx:111` mounts `DataKeyGate` with that lifecycle.
6. `AppCore.tsx:118` mounts `EncryptedRepositoryProvider` with `user.id`.
7. `apps/networth/App.tsx:64-71` is `dataKeyLifecycleFor`: it puts `userId` into
   `context` (`:69`) and builds custody with **no** `storageKey` (`:71`).

The identity therefore reaches the **encryption context** and never reaches the
**storage namespace**.

### 1.4 Storage mechanism and key-format constraints

- Native: `packages/security/src/services/OsKeystoreStorage.ts:134-150`, over
  `expo-secure-store` — pinned `~14.0.1` in all three apps
  (`apps/networth/package.json:33`).
  The library enforces the key charset itself; from the installed build,
  `expo-secure-store/build/SecureStore.js:148`:
  > `Invalid key provided to SecureStore. Keys must not be empty and contain
  > only alphanumeric characters, ".", "-", and "_".`
- Browser: `packages/security/src/services/WebNonExtractableStorage.ts:25-28`
  over IndexedDB — no documented key charset restriction found.
- **No key-format validation exists anywhere in this repository.** The
  constraint is entirely the external library's, enforced at call time.

Consequence of record: a namespace segment built from raw base64 would violate
the native constraint (`+`, `/`, `=` are outside the permitted set). Hex,
base64url, and a Firebase Auth UID all fall inside it. Stated as a constraint,
not a recommendation.

### 1.5 AAD composition — exact

Two distinct AADs, neither of which is the storage key.

Payload envelope — `packages/security/src/crypto/envelope.ts:32-52`:

```json
{"v":…,"alg":"AES-GCM","kdf":"PBKDF2-SHA256","it":…,"uid":…,"app":…[,"pur":…]}
```

Record envelope — `packages/security/src/recordEnvelope.ts:56-68`:

```json
{"v":…,"alg":"AES-GCM","pur":"…","uid":…,"app":…,"col":…,"rid":…}
```

`uid` is `context.userId` in both.

### 1.6 Where `userId` appears

| Layer | In the storage namespace? | In the AAD? |
| --- | --- | --- |
| Custody slot (`platform.dek.v1`) | **No** | n/a — the slot is not encrypted |
| v1 plain envelope `{v:1,k}` | No | **No** — raw base64 DEK, no AEAD |
| v2 wrapper (Gate 7) | No | **Yes** — `envelope.ts:43` `uid` |
| Recovery escrow | n/a (Firestore, per-user path) | **Yes** |
| Records | n/a | **Yes** — `recordEnvelope.ts:62` |

The single row that matters: **the v1 plain envelope has neither.**

### 1.7 Other lifecycle stages

- **Sign-out** — `AuthProvider.tsx:61-64`: `await service.signOut(); setUser(null)`.
  Custody is not touched. `AppCore.tsx:109` then renders `signedOut`, unmounting
  `DataKeyGate` and `EncryptedRepositoryProvider`.
- **Account switch** — a new `user.id` produces a new lifecycle
  (`AppCore.tsx:80`). The custody slot is unchanged.
- **Account deletion** — `packages/account/src/services/deleteAccountFlow.ts:29-80`,
  ending `await callbacks.clearLocalState()` (`:80`). **`deleteAccountFlow` has
  no caller outside `packages/account`** — searched across `packages/` and
  `apps/`, excluding `dist/`. The only suppliers of `clearLocalState` are test
  files. Account deletion is not wired into any application.
- **Recovery** — `dataKeyLifecycle.ts:328-341`; on success the key reaches
  custody via `custody.store` (unprotected v1), in the same global slot.
- **Pairing** — `dataKeyLifecycle.ts:343-395`; `completePairing` stores through
  the same custody object, same slot.
- **Local backup** — `packages/backup/` never references custody, the wrapper,
  or the lifecycle. Verified by search: no hits for `wrapDataKey`,
  `createKeyCustody`, `dataKeyLifecycle` under `packages/backup/src/`.
- **Cold start** — see §2.

---

## 2. Cold-start ordering

**Question: at the moment custody is first read on cold start, what is `userId`?**

**Answer: custody is never read without a `userId`, and the reason is a UI gate,
not anything in the security layer.**

`AppCore.tsx:80-83` returns `null` for the lifecycle when `user` is falsy, and
`:108-109` return before `DataKeyGate` mounts. No custody object is constructed
without an id. `DataKeyGate` — the only caller of `lifecycle.status()` on mount
(`DataKeyGate.tsx:121-131`) — is therefore unreachable without a user.

**Can custody load run with a null, stale, or previous-user identity?**

- **Null identity — no**, by the gate above. Nothing in
  `createKeyCustody`/`createDataKeyLifecycle` enforces this; the guarantee lives
  entirely in `AppCore.tsx:109`. Asked directly with an empty identity, the
  library serves the key (characterization test S5, second case). Recorded as
  fragile, not as a live defect.
- **Stale identity — no**, for the same reason.
- **Previous-user identity — this is the wrong framing, and it is the defect.**
  The identity is always correct; the **slot** is the previous user's. When Bob
  signs in, `dataKeyLifecycleFor('bob-uid')` builds custody over
  `platform.dek.v1`, which holds Alice's envelope. Bob's identity is right
  everywhere it is used and irrelevant everywhere it is needed.

**A separate ordering defect found while tracing this.**
`AuthProvider.tsx:34-43` calls `getCurrentUser()` and, in `.finally()`, sets
`initializing = false`. `FirebaseAuthService.getCurrentUser()`
(`packages/firebase/src/services/FirebaseAuthService.ts:51-54`) reads
`this.auth.currentUser` synchronously, which Firebase leaves `null` until it has
restored the persisted session. Two consequences:

1. On a cold start with a valid persisted session, `initializing` goes false
   while `user` is still `null`, so `AppCore.tsx:109` renders the login screen
   before `onAuthStateChanged` delivers the real user.
2. `.then((current) => setUser(current))` at `:36-39` can resolve **after**
   `onAuthStateChanged` has already delivered the restored user, overwriting it
   with `null`.

This does not cause a wrong-identity custody read — a null user renders
`signedOut` and builds no custody at all. It is recorded as `G8-F-07` because
8A was asked to trace identity resolution, and because it bears on any design
that keys storage off the resolved identity.

---

## 3. State that survives an identity change

| Holder | Location | Cleared by |
| --- | --- | --- |
| `opened` — the unwrapped DEK for the session | `dataKeyLifecycle.ts:198` | The closure being dropped. A new `user.id` builds a new lifecycle (`AppCore.tsx:80`), so the previous DEK is unreachable. **Verified** by test (S-restart in `dataKeyProtection.test.ts`). |
| `this.written` — keys this store instance wrote | `OsKeystoreStorage.ts:143`, `:146` | `remove()`/`clear()` only. `clear()` (`:159-163`) removes **only what this process instance wrote** — the doc comment at `:152-158` states keys from a previous process are untracked and untouched. |
| `DataKeyGate` UI state — `state`, `protectedKey`, `recoveryCode`, `entered`, `busy`, `failed`, `pairingRole` | `DataKeyGate.tsx:108-114` | Unmount. The effect at `:121-131` is keyed on `[lifecycle]` and overwrites `state`, but does **not** reset `recoveryCode` or `entered`. In current flows every identity change passes through `user === null`, which unmounts the gate at `AppCore.tsx:109`, so this is latent rather than live — see `G8-F-09`. |
| `repository` memo | `EncryptedRepositoryProvider.tsx:34` | Re-memoised; no cross-user cache found. |
| Module-level singletons holding custody or DEK state | — | **None found.** All state is per-instance or per-closure. |

---

## 4. Reproduction results

Run against the real implementation; no production code altered. Source:
`packages/security/tests/gate08-isolation.repro.test.ts`.

| # | Sequence | Observed behaviour |
| --- | --- | --- |
| 1 | Alice init → sign-out → Bob load, no wrapper | Bob: `status() === 'ready'`; `load()` returns **Alice's DEK byte-for-byte**. One slot on the device. Bob never reaches `needs-setup`, so no escrow is written for him (`escrow.as(BOB).load() === null`). |
| 2 | Same, with Alice's Gate 7 wrapper | Bob: `status() === 'locked'`. `unlock(ALICE_PASSPHRASE)` → `DECRYPTION_FAILED` (AAD binds the wrapper to Alice). `initialize()` → `KEY_CUSTODY_INVALID`. `recover()` → `KEY_CUSTODY_INVALID`. Bob has no route forward at all. |
| 3 | Alice → Bob → Alice | All three see the same 32 bytes. One slot throughout. |
| 4 | Alice → Bob → Carol | All three see the same key; `entries.keys() === ['platform.dek.v1']`. |
| 5 | No authenticated user → custody load | Unreachable in production (`AppCore.tsx:108-109`). Asked directly with an empty identity, the library returns `status() === 'ready'` and serves the key. |
| 6 | Alice → Bob → Alice's account deleted | Slot byte-identical before and after; Bob still `ready`. No production path deletes custody. |
| 7 | Alice's wrapper bytes read under Bob's identity | `DECRYPTION_FAILED` — refused by the AAD. |
| 8 | Bob's wrapper bytes read under Alice's identity | `DECRYPTION_FAILED` — refused by the AAD. |
| 9 | Unprotected envelope inspected directly | `{v:1,k:<base64 DEK>}`; `k` equals the raw key. No AEAD, no identity binding. Bob holds the same 32 bytes. |

Sequences 7–9 answer the disclosure question directly: **with the Gate 7 wrapper
on, the AAD prevents cross-user key access; without it, nothing does.**

---

## 5. Findings

### G8-F-01 — The custody slot is a process-wide constant, not per user
**What.** `keyCustody.ts:96` defines one slot for the device; all three apps use
it unmodified (`App.tsx:71`/`:69`/`:67`). Custody takes no identity.
**Evidence.** §1.1, §1.2; repro 1, 3, 4.
**Blast radius.** Every multi-account device, every application. Root cause of
F-02, F-03 and F-04.

### G8-F-02 — An unprotected DEK is disclosed to the next user, verbatim
**What.** The v1 envelope is `{v:1,k:<base64 DEK>}` with no AEAD and no identity
binding (§1.6). `load()` returns those bytes to any caller. A second user
receives the first user's key material.
**Evidence.** Repro 1 and 9.
**Blast radius.** Any device where a user has not enabled the Gate 7 passphrase
— which is the default state. This is a **confirmed key-material disclosure to a
second local account**, not merely a correctness defect. It does not by itself
yield the first user's *records*: the record AAD binds `uid`
(`recordEnvelope.ts:62`), so decrypting Alice's rows still fails under Bob's
identity. The disclosure is of the key, and its consequences beyond this
codebase's own read path are not bounded by anything here.

### G8-F-03 — The second user silently loses their recovery path
**What.** Bob is `ready`, so `DataKeyGate` never routes to setup, so
`initialize()` never runs, so no recovery code is generated and no escrow is
written for Bob. His records are encrypted under a key he has no escrowed copy
of.
**Evidence.** Repro 1, fourth case.
**Blast radius.** Permanent, silent data loss for the second user if the device
is lost. Nothing surfaces the condition.

### G8-F-04 — With Gate 7 protection on, the second user is hard-locked out
**What.** Bob sees `locked`, cannot unlock (correctly — the AAD refuses), and
cannot `initialize()` or `recover()` because both refuse a `protected` slot
(`dataKeyLifecycle.ts:334`, `:373`).
**Evidence.** Repro 2.
**Blast radius.** Second user cannot use the application at all. Data-safe, and
strictly safer than F-02, but a dead end with no in-app exit.

### G8-F-05 — Nothing clears custody, ever
**What.** `custody.clear()` (`keyCustody.ts:234-236`) has **no production
caller**. Sign-out (`AuthProvider.tsx:61-64`) does not touch it.
**Evidence.** §1.7; repro 6.
**Blast radius.** The device key outlives every sign-out and every account
deletion.

### G8-F-06 — The account-deletion flow is not wired to anything
**What.** `deleteAccountFlow` has no caller outside `packages/account`; the only
suppliers of its `clearLocalState` callback are tests.
**Evidence.** §1.7.
**Blast radius.** "What should deletion do to the slot" currently has no
production surface to change. Recorded so 8B does not design against a caller
that does not exist.

### G8-F-07 — Cold-start identity resolution can clear a restored session
**What.** `getCurrentUser()` reads `auth.currentUser` synchronously
(`FirebaseAuthService.ts:51-54`), which is `null` before persistence restores;
`AuthProvider.tsx:42` clears `initializing` regardless, and `:38` can overwrite
a restored user with `null`.
**Evidence.** §2.
**Blast radius.** Login screen flashes on cold start with a valid session; in
the losing interleaving, a signed-in user is shown signed-out. **No custody
impact** — a null user builds no custody.

### G8-F-08 — `clear()` cannot reach keys written by a previous process
**What.** `OsKeystoreStorage.clear()` iterates `this.written`
(`OsKeystoreStorage.ts:159-163`); its own comment (`:152-158`) states keys from a
previous process are untracked and untouched. `expo-secure-store` offers no
enumeration.
**Evidence.** §3.
**Blast radius.** Any cleanup that must reach a slot written before this launch
cannot enumerate it and must know the key by name.

### G8-F-09 — `DataKeyGate` per-user UI state is not reset on lifecycle change
**What.** `recoveryCode` and `entered` (`DataKeyGate.tsx:110-111`) are not reset
by the `[lifecycle]` effect (`:121-131`). `dataKeyStep` gives a pending recovery
code priority over every state, so a retained code would be rendered.
**Evidence.** §3.
**Blast radius.** **Latent, not currently reachable**: every identity change in
today's flows passes through `user === null`, which unmounts the gate
(`AppCore.tsx:109`) and destroys the state. It becomes live the moment any flow
switches identity without unmounting.

---

## 6. Deliverable 2 — the tests

`packages/security/tests/gate08-isolation.repro.test.ts` — 22 tests:
**16 `characterizes:`** and **6 `GATE-8 RED:`**.

**Path deviation, deliberate.** The brief specified
`test/custody/gate08-isolation.repro.test.ts`. A file there would be executed by
**nothing**: `turbo test` runs per-package `test` scripts (`turbo.json` task
`test`), each package's Vitest resolves specs under its own root, and the only
root config is `vitest.rules.config.ts` (the Firestore rules suite). Placing the
file at the specified path would make it dead code, defeating the stated purpose
of failing loudly when custody behaviour changes. Wiring a new root config in
would have meant committing a third file, which the brief forbids. It is
therefore in `packages/security/tests/`, beside the custody it characterizes,
where `pnpm verify` runs it.

**Expected-failure mechanism.** Vitest **2.1.9** (`npx vitest --version`), which
provides `it.fails`. Verified in both directions before adopting it: it passes
while the assertion fails, and **fails with `Error: Expect test to fail` the
moment the assertion starts passing.** So Gate 8C cannot make these invariants
hold without CI demanding the marker come off. No test is skipped and no suite is
excluded from CI.

**RED tests fail for the right reason.** Each was run once as a plain `it` to
confirm it fails on its own assertion rather than an import or typo:

| RED invariant | Actual failure |
| --- | --- |
| Bob's load must never return Alice's DEK | `expected [ Array(32) ] to not deeply equal [ Array(32) ]` |
| A user with no key must be offered setup | `expected 'ready' to be 'needs-setup'` |
| Bob must not be shown another user's protected custody | `expected 'locked' not to be 'locked'` |
| Alice's key unaffected by Bob using the device | `expected 1 to be 2` (slots) |
| Three users must hold three slots | `expected 1 to be 3` |
| An unprotected key must be as isolated as a protected one | `expected [ … ] to not deeply equal [ … ]` |

**Design questions were not asserted.** Sequences 5 and 6 carry characterization
tests only; their correct behaviour is OQ-1 and OQ-2 below.

---

## Open questions

**OQ-1 — What should custody do when asked for a key with no authenticated
identity?** Today the guarantee is a UI gate (`AppCore.tsx:109`), not a security
one; the library complies with an empty identity. Whether the security layer
should refuse an absent identity itself is a design decision. Characterized, not
asserted.

**OQ-2 — What does account deletion owe a per-user slot?** Deletion has no
production caller (F-06), so there is nothing to preserve compatibility with.
Whether deletion should remove that user's slot, and what happens to a slot whose
owner no longer exists, is undecided. Characterized, not asserted.

**OQ-3 — Is the Firebase Auth UID a suitable namespace segment?** The charset
fits (§1.4). Stability across reinstall, email change, and account linking, and
the behaviour of anonymous accounts, are **not determinable from this
repository** — no anonymous sign-in path exists here. `FirebaseAuthService` exposes
**email/password only** (`FirebaseAuthService.ts:58`
`signInWithEmailAndPassword`); a search for `GoogleAuthProvider`,
`signInWithCredential` and `signInAnonymously` across `packages/` and `apps/`
returns nothing. 8B must establish UID stability from Firebase's documented
guarantees, and should note that this repository's auth surface is narrower than
`CLAUDE.md`'s "Google sign-in only" line implies — that line describes a
different application.

**OQ-4 — Can existing global custody be assumed to belong to the first user who
signs in after the upgrade?** Repro 1, 3 and 4 show the slot has no owner
recorded anywhere: `{v:1,k}` carries no `uid`, and the v2 wrapper's owner can
only be learned by successfully decrypting it, which needs the passphrase. So
for an unprotected slot there is **no evidence in the data** of whose key it is.
Whether adoption may therefore be automatic is the central 8B decision.

**OQ-5 — Is `G8-F-07` in scope for Gate 8?** It is an identity-resolution defect
with no custody impact today, but any design keying storage off the resolved
identity inherits it. 8B should say explicitly whether it is fixed here or
tracked separately.

**OQ-6 — Does the browser tier need the same namespace treatment?** The web
store (`WebNonExtractableStorage`) has no charset constraint and a different
threat model — its own doc comment (`:15-18`) records that any script in the
origin can use the wrapping key. Whether isolation there is worth the same
mechanism is undecided.

---

GATE 8A COMPLETE — 9 findings, 16 characterization tests, 6 RED invariant tests, 6 open questions
