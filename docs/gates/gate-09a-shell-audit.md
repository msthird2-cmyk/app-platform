# Gate 9A — Application shell: audit

Base `main` at `2d01967`. Audit only; nothing is proposed. Every claim cites
`file:line` at that commit. Where the repository contradicts a supplied fact,
the contradiction is reported rather than resolved.

---

## Contradictions with the established facts

**Fact 4 says `messages.ts` is byte-identical across the three apps — confirmed.**
`md5sum` gives `a9b7cbe3c14728103fec459ae3d58567` for all three.

**Fact 6 says the map holds 26 codes. It holds 25.** Counted mechanically
(`grep -cE "^  [A-Z_]+:"` → 25) and by hand across `messages.ts:5-30`. Reported,
not resolved; nothing else in this audit depends on which number is right.

Facts 1, 2, 3, 5, 7 and 8 are confirmed as stated. Fact 2 is confirmed
with one correction to the wording: each of the seven screens has exactly **two**
non-test references — its own `export function` line and its package barrel
re-export (e.g. `packages/auth/src/index.ts:14`). Neither is a call site, so the
substance of the fact holds: **no screen is invoked anywhere.** `BackupScreen`
has a third reference — a comment in `packages/core/src/BackupControls.tsx:19`
explaining why that component deliberately is *not* `BackupScreen`.

---

## Q1 — What a new application must create

Source files per app, excluding `dist/`, `tests/`, `android/` and `.expo/`.

| File | Net Worth | Expense | Investment | Character |
| --- | --- | --- | --- | --- |
| `App.tsx` | 126 | 113 | 110 | mostly boilerplate — see Q2 |
| `index.tsx` | 182 | 105 | 99 | mostly boilerplate — see Q2 |
| `src/messages.ts` | 35 | 35 | 35 | **100% boilerplate**, byte-identical |
| `src/demo.ts` | 22 | 31 | 31 | demo/preview |
| `src/domain/*.ts` | 88 | 129 | 143 | **app-specific** |
| `src/screens/*.tsx` | 222 | 93 | 69 | **app-specific** |
| `src/collections.ts` | 10 | — | — | app-specific (inline in the other two) |
| `src/composition/services.ts` | 97 | — | — | see Q7 |
| `src/config/backend.ts` | 101 | — | — | see Q7 |
| `src/data/*.ts` | 122 | — | — | app-specific |
| `app.json` | 16 | 16 | 16 | boilerplate but for the slug/name |
| `package.json` | 45 | 42 | 42 | boilerplate but for the name |
| `tsconfig.json` | 11 | 11 | 11 | **100% boilerplate** |

The minimum viable new app is the Expense/Investment shape: `App.tsx` (~110) +
`index.tsx` (~100) + `messages.ts` (35) + `tsconfig.json` (11) + `app.json` +
`package.json` ≈ **310 lines before a single domain rule is written**, of which
the genuinely app-specific content is the app name, the collection list, and one
screen import. Everything else in those files is copied structure.

---

## Q2 — The three-way diff

Changed-line counts, `diff | grep -cE '^[<>]'`:

| Pair | `App.tsx` | `index.tsx` |
| --- | --- | --- |
| Expense vs Investment | **23** of ~112 | **10** of ~102 |
| Net Worth vs Expense | 97 | 129 |
| Net Worth vs Investment | 94 | — |

**Expense vs Investment — the honest measure of duplication.** All 23 changed
`App.tsx` lines are one of four things: the screen import (`:16`), the demo
import (`:18`), the app name (`:20`), the collection tuple (`:22`), the props
interface name (`:24`, `:55`), one extra `now?: Date` prop Expense has
(`:43`,`:51`), and the screen element itself (`:104-108` vs `:102-105`). **Zero
platform-logic lines differ.** In `index.tsx`, 10 changed lines reduce to
`keychainService: 'expense'` vs `'investment'` (`:66`) and a formatting
difference in the final `return <App … />`. Two apps, ~214 lines, **one
meaningful difference: the app's own name and its screen.**

**Net Worth differs structurally, not stylistically.** Its extra 97/129 lines are
the composition and config layer (Q7), the backup transport wiring
(`index.tsx:9`, `:118-122`), `PassphraseControls` and `BackupControls`
(`App.tsx:1-6`), and the `services` object replacing six loose props. Expense and
Investment take `authService`/`accountService`/`escrowStore`/`pairingRelay` as
separate props (`App.tsx:25-43`) and construct `InMemoryRepository` inline
(`App.tsx:85`); Net Worth takes one `NetWorthServices` object because — per its
own comment at `App.tsx:26-35` — six loose props are what would let a build pair
Firebase records with an in-memory escrow.

---

## Q3 — The seven unreachable screens

Confirmed unreachable: each screen's non-test references are its own definition
and its package barrel re-export. **Not one has a call site.**

| Screen | File | Required props | What would have to call it |
| --- | --- | --- | --- |
| `SignupScreen` | `packages/auth/src/components/SignupScreen.tsx:15` | `messageForCode`, `onBackToSignIn` | Whatever owns `LoginScreen`'s `onCreateAccount` — today `() => undefined` in all three apps |
| `PasswordResetScreen` | `packages/auth/.../PasswordResetScreen.tsx:15` | `messageForCode`, `sentMessage`, `onBack` | `LoginScreen`'s `onForgotPassword` — today `() => undefined` |
| `DeviceVerification` | `packages/auth/.../DeviceVerification.tsx:15` | `deviceId`, `description`, `messageForCode`, `onVerified` | Nothing; `FirebaseAuthService.confirmDeviceVerification` throws `DEVICE_VERIFICATION_UNAVAILABLE` (`packages/firebase/src/services/FirebaseAuthService.ts:132-134`) |
| `ProfileScreen` | `packages/account/.../ProfileScreen.tsx:14` | `service: AccountService`, `messageForCode`, `savedMessage` | A settings destination |
| `SettingsScreen` | `packages/account/.../SettingsScreen.tsx:17` | all optional — `title?`, `sections?`, `dangerZone?` | A settings destination; **it is itself the container the others would sit in** |
| `DeleteAccount` | `packages/account/.../DeleteAccount.tsx:23` | `title`, `description`, `messageForCode`, `onDelete` | `SettingsScreen`'s `dangerZone`; `onDelete` would call `deleteAccountFlow`, which has no production caller (F-06) |
| `BackupScreen` | `packages/backup/.../BackupScreen.tsx:31` | `settings`, `now`, `messageForCode`, `labelForState`, `onExport`, `onImport` | Nothing — and deliberately: `BackupControls.tsx:19` records that `BackupScreen` wraps itself in a `Screen`, which is why `BackupControls` exists instead |

**Does `packages/core` have anywhere to mount them?** No. `packages/core/src/`
contains thirteen modules; the only ones that render an application-visible
destination are `DataKeyGate` (pre-key states) and two inline controls,
`BackupControls` and `PassphraseControls`, both of which render fragments into
whatever the app already shows. There is no container, slot or region into which
a screen could be placed.

`SettingsScreen` is the notable case: its props are all optional and it accepts
`sections` and a `dangerZone`, so it is shaped as a host for exactly the other
account screens. It has never been mounted.

---

## Q4 — Navigation

**There is no navigation mechanism of any kind.** Not a library, not a router,
not a stack, not a tab bar, and no app-level state that selects between
destinations.

What exists is **two state machines that each render one of a fixed set of
mutually exclusive states, neither of which can be navigated to or away from**:

- `DataKeyGate` (`packages/core/src/DataKeyGate.tsx`) — a sequence of early
  returns on a computed `step`: `show-code` (`:194`), `loading` (`:213`),
  `setup` (`:215`), `recover` (`:225`), `unlock` (`:253`), `pair` (`:274`),
  `blocked` (`:280`), otherwise `children`. The step is a pure function of
  lifecycle status (`dataKeyStep.ts`), not of user intent. The single exception
  is `pairingRequested`, a boolean the recover screen can set — the only
  user-driven branch anywhere in the shell, and it can only move one way.
- `PairingFlow` (`packages/core/src/PairingFlow.tsx`) — the same pattern over
  `pairingStep(view.phase, view.code)` (`:92`), branching at `:94`, `:120`,
  `:144`, `:158` and `:160`, driven by relay state (`view`, `:79`).

`AppCore` itself branches three ways on authentication (`AppCore.tsx:108-111`)
and never again. Once a user is signed in with a ready key, `children` renders
and the shell has no further say. Each app renders exactly one screen there,
forever.

---

## Q5 — What `AppCore` does, and what it owns

`AppCore` (`packages/core/src/AppCore.tsx:129-168`) is a provider stack; the
logic is in the inner `AuthGate` (`:58-123`).

**Mount to children, in order:**

1. `AppCore` assembles `config` from `appName`, `collections` and optional
   `featureFlags` (`:143-145`).
2. `ThemeProvider` (`:148`), then `ServicesProvider` with that config and every
   injected service (`:152`), then `AuthProvider` with `services.authService`
   (`:153`), then `AuthGate` (`:154`).
3. `AuthGate` reads `{ user, initializing }` from `useAuth()` (`:75`).
4. It memoises the data-key lifecycle on `[user?.id, dataKeyLifecycleFor]`
   (`:80-83`) — `null` when there is no user.
5. It memoises a `pairingSessionFor` factory on
   `[user?.id, lifecycle, pairingRelay, recordCipher, randomBytes, appName]`
   (`:93-106`), `undefined` unless all four ingredients are present.
6. `initializing` → `<Loading label="Starting" />` (`:108`).
7. `!user || !lifecycle` → `signedOut` (`:109`).
8. Otherwise `DataKeyGate` (`:111`) wrapping `EncryptedRepositoryProvider`
   (`:118`) wrapping `children`.

**State owned: none.** `AppCore` and `AuthGate` hold no `useState` and no
`useReducer`. They own two `useMemo` results and nothing else. All mutable state
lives below or beside them — `AuthProvider` owns `user` and `initializing`
(`AuthProvider.tsx:24-25`), `DataKeyGate` owns seven pieces of UI state
(`DataKeyGate.tsx:108-114`), `ThemeProvider` owns the preference.

The consequence for a shell: **there is no place in `AppCore` where a
"current destination" could live today**, because `AppCore` holds no state at
all.

---

## Q6 — The message map

25 codes (fact 6 says 26 — see Contradictions).

**Every one of the 25 is produced by a platform package. None originates in app
code.** Cross-referenced by searching each code across `packages/*/src` and
`apps/*/src`. "Produced" rather than "thrown" deliberately: 18 are thrown as
`*Error` codes from a package's `errors.ts`, the six credential-validation codes
are *returned* as a result from `packages/auth/src/credentials.ts:25-37`, and
`UNKNOWN_ERROR` is a *fallback* in `packages/utils/src/errors.ts:43`.

| Throwing package | Codes |
| --- | --- |
| `auth` (± `firebase`) | 15 — `EMAIL_REQUIRED`, `EMAIL_INVALID`, `PASSWORD_*` ×4, `INVALID_CREDENTIALS`, `EMAIL_ALREADY_IN_USE`, `WEAK_PASSWORD`, `USER_NOT_FOUND`, `DEVICE_VERIFICATION_FAILED`, `NETWORK_ERROR`, `EMAIL_NOT_VERIFIED`, `EMAIL_VERIFICATION_FAILED`, `DEVICE_VERIFICATION_UNAVAILABLE` |
| `account` (± `firebase`) | 3 — `REAUTHENTICATION_REQUIRED`, `ACCOUNT_DELETION_FAILED`, `DATA_DELETION_FAILED` |
| `backup` | 4 — `BACKUP_FAILED`, `RESTORE_FAILED`, `PASSPHRASE_REQUIRED`, `BACKUP_CORRUPT` |
| `security` | 2 — `PASSPHRASE_TOO_WEAK`, `SECURE_STORAGE_UNAVAILABLE` |
| `utils` | 1 — `UNKNOWN_ERROR` |
| **app code** | **0** |

**Consumers of `messageForCode`:** `packages/auth`, `packages/account`,
`packages/backup`, `packages/core` — four platform packages. In `core` the two
consumers are `BackupControls.tsx:110` and `PassphraseContext.tsx:137`, and in
both the prop is **optional**, falling back to rendering the raw code.

**Coverage gap.** 45 platform error codes have no entry and resolve to
"Something went wrong. Try again." They include the codes a user is most likely
to meet in the flows the shell does render: `RECOVERY_CODE_INVALID`,
`RECOVERY_ESCROW_MISSING`, `DATA_KEY_LOCKED`, `DECRYPTION_FAILED`,
`KEY_CUSTODY_UNUSABLE`, `BACKUP_TOO_LARGE`, and all five `PAIRING_*` codes.
`DataKeyGate` sidesteps this by carrying its own copy — a `text` table of
literals, `DEFAULT_LABELS` at `DataKeyGate.tsx:63-99`, rendered at `:237` and `:265` —
rather than calling `messageForCode` at all (it never imports it) —
so the gap is currently masked in the one place it would most obviously show.

---

## Q7 — Net Worth's composition and config

**`src/composition/services.ts` (97 lines).**

| Lines | Content | Would be identical for any app? |
| --- | --- | --- |
| `:1-11` | imports of six in-memory and Firebase services | **Yes**, verbatim |
| `:12` | `import { COLLECTIONS } from '../collections'` | Yes structurally; the value is app-specific |
| `:14-26` | the two-compositions doc comment | **Yes**, verbatim |
| `:27-41` | `NetWorthServices` interface — six fields | **Yes** but for the type name |
| `:53-71` | `createProductionServices` | **Yes** but for the App Check reason string |
| `:73-97` | `createPreviewServices` | **Yes** but for the seeded preview user/profile |

Net Worth-specific content is: the type name, the collection list, and the demo
identity `you@example.com`. **Everything else is platform composition** —
roughly 85 of 97 lines.

**`src/config/backend.ts` (101 lines).** One app-specific line:
`BACKEND_VARIABLE = 'EXPO_PUBLIC_NETWORTH_BACKEND'` (`:25`). The six
`FIREBASE_VARIABLES` (`:31-38`), `BackendSelection` (`:40`), `Environment`
(`:47`), `selectBackend` (`:58`) and `misconfigurationMessage` (`:92`) contain
nothing about Net Worth. **100 of 101 lines are app-agnostic.**

---

## Q8 — The memo (fact 7)

**Confirmed as stated, and the answer is: latent today, and it is a
sharper hazard than it looks.**

`dataKeyLifecycleFor` is a fresh arrow function on every `App` render
(`apps/networth/App.tsx:69`, and the same in the other two), and `AuthGate`
lists it in the memo's dependency array (`AppCore.tsx:82`). `useMemo` compares
dependencies with `Object.is`, so a new closure identity invalidates the memo.

**Does the memo rebuild on an `App` re-render? Yes.** **Does it rebuild on an
`AuthGate` re-render? No** — the prop value is whatever the last `App` render
produced, so `AuthGate` re-rendering for an auth-context change does not
recompute it. Only an `App` re-render does.

**Is it live today? No.** No `App.tsx` contains `useState` or `useReducer`
(verified: zero in all three). The entry points hold three `useState` each
(`apps/networth/index.tsx:125-127`) but set them only inside a single mount
effect (`:129`), so after initialisation nothing above `App` changes state and
`App` never re-renders.

**What would make it live** — any of:

- adding state to `App.tsx` itself;
- wiring `onThemePreferenceChange` (`AppCore.tsx:24`) to a `setState` above
  `App`. **No app wires it today** (verified: no reference in any `App.tsx` or
  `index.tsx`), which is the only reason this is not already live;
- any state added to the entry-point `Root` that changes after mount — which a
  navigation state, a settings screen, or a sign-out button would all introduce.

**Why it matters more since Gate 7.** Rebuilding the lifecycle discards the
closure holding the opened DEK (`dataKeyLifecycle.ts:198`). On a
passphrase-protected device the user would be silently thrown back to the
`unlock` step mid-session, having done nothing but change a theme. Before Gate 7
a rebuild was merely wasteful; now it is a visible loss of session state.

This sits directly in the path of any shell work, because **the first thing a
shell adds is app-level state.**

---

## Q9 — Existing tests that constrain the shell

**`packages/core/tests` — three files, none of which render anything.**

| File | Asserts |
| --- | --- |
| `dataKeyStep.test.ts` (119) | The pure status→step mapping: `ready`→`ready`, `needs-setup`→`setup`, `locked`→`unlock`, `unusable`→`blocked`, a pending code outranks every state, and **no state but `needs-setup` ever routes to `setup`** |
| `pairingStep.test.ts` (82) | The same for pairing phases, plus that every phase the session can publish is covered, plus failure-message grouping |
| `repositoryAccess.test.ts` (61) | `repositoryForConsumer` returns only a repository carrying the encryption-boundary marker, and refuses a raw store or a look-alike |

There is **no test that mounts `AppCore`, `DataKeyGate` or any screen.** The
constraint is entirely on decision functions, not on composition or rendering.
`packages/core/README.md:104-105` records the consequence ("in the absence of
component-test infrastructure"); the root `README.md:132-135` records the cause —
importing `react-native` pulls in Flow-typed source a plain test runner cannot
parse, and component tests would need a `react-native` → `react-native-web`
alias the repo does not configure.

**`apps/*/tests`** — Expense and Investment test domain arithmetic only. Net
Worth adds `backend.test.ts` (`selectBackend`), `netWorthRepository.test.ts`,
`firebase.integration.test.ts` (skipped unless configured) and
`backupWiring.test.ts`, which is the closest thing to a shell test: it asserts
the **entry point** wires a transport and that the composition does not name a
server-side backup path — by reading source text, not by rendering.

**Architecture guards** (`scripts/check-architecture.mjs:365-390`) require that
`AppCore` keeps `recordCipher` and `dataKeyLifecycleFor` non-optional and keeps
rendering `EncryptedRepositoryProvider`. Any shell restructuring must preserve
both.

---

## Q10 — Navigation in the lockfile

**Nothing.** A search of `pnpm-lock.yaml` for `react-navigation`, `expo-router`,
`react-router`, `@react-navigation/*`, `wouter` and the bare token `navigation`
returns **no matches at all** — not as a direct dependency, not transitively.
The platform has never had a navigation package.

---

## Q11 — Sign-out, and where F-05's `clear()` would go

**Sign-out is defined and has no caller.**

The context value exposes it (`packages/auth/src/AuthProvider.tsx:12`,
implemented `:61-64`), calling `service.signOut()` then `setUser(null)`. Both
implementations exist (`packages/firebase/src/services/FirebaseAuthService.ts:79-81`,
`packages/auth/src/services/InMemoryAuthService.ts:91`).

A search across `packages/` and `apps/`, excluding `dist/` and tests, finds
**only the interface declaration (`packages/auth/src/types/auth.ts:22`), the
context type (`AuthProvider.tsx:12`), the provider's implementation (`:61-62`)
and the two services. No component, screen or app invokes it.** There is no sign-out button anywhere in any application.

**Where it would be invoked from if a settings screen were reachable:**
`SettingsScreen`'s `sections` or `dangerZone` (`SettingsScreen.tsx:17`) would
hold the control; the handler would call `signOut` from `useAuth()`.

**Where F-05's `clear()` call must eventually go — established, not added.**
`AuthProvider.tsx:61-64` is the single funnel: every sign-out passes through it,
and it already has the sequencing (`await service.signOut()` before
`setUser(null)`). Two facts constrain the eventual placement and are recorded
here so the later gate does not have to rediscover them:

1. **`AuthProvider` cannot reach custody today.** It holds an `AuthService` and
   nothing else — no `SecureStorage`, no `KeyCustody`, no lifecycle. Custody is
   constructed inside `AppCore`'s `AuthGate` (`AppCore.tsx:80-83`), *below*
   `AuthProvider` in the tree. So the call cannot simply be added at `:62`; the
   custody handle would have to reach that scope, or the clear would have to be
   invoked from a component that has both.
2. **The owner must be known at clear time.** Since Gate 8C, custody is
   addressed per identity (`custodyAddress.ts`), so clearing needs the user id
   that is about to be discarded — available at `:62` but gone by `:63`.

---

## Reusable capability vs gap

| Capability | Exists | Reachable |
| --- | --- | --- |
| Auth gate (signed in / out / initializing) | ✅ `AppCore.tsx:108-111` | ✅ |
| Sign in | ✅ `LoginScreen` | ✅ |
| Sign up | ✅ `SignupScreen` | ❌ prop stubbed `() => undefined` in all three apps |
| Password reset | ✅ `PasswordResetScreen` | ❌ same |
| Sign out | ✅ `AuthProvider.tsx:61-64` | ❌ **no caller anywhere** |
| Data-key states (setup/recover/unlock/blocked) | ✅ `DataKeyGate` | ✅ |
| Trusted-device pairing | ✅ `PairingFlow`, `PairNewDeviceButton` | ✅ where a relay is injected |
| Passphrase controls | ✅ `PassphraseControls` | ✅ Net Worth only |
| Backup export/import | ✅ `BackupControls` | ✅ Net Worth only |
| Backup screen | ✅ `BackupScreen` | ❌ deliberately superseded (`BackupControls.tsx:19`) |
| Profile | ✅ `ProfileScreen` | ❌ nowhere to mount |
| Settings container | ✅ `SettingsScreen` | ❌ nowhere to mount |
| Account deletion | ✅ `DeleteAccount` + `deleteAccountFlow` | ❌ flow has no caller (F-06) |
| Device verification | ✅ `DeviceVerification` | ❌ service throws `…UNAVAILABLE` |
| Error copy | ✅ `messages.ts` | ⚠️ triplicated; 45 codes uncovered |
| **Navigation** | ❌ **nothing** | — |
| **A place to mount a second screen** | ❌ **nothing** | — |
| Theme | ✅ `ThemeProvider` | ⚠️ `onThemePreferenceChange` unwired |

---

## Risks

1. **`messages.ts` is triplicated platform vocabulary.** 105 lines across three
   files, zero app-specific content, and it drifts silently — nothing compares
   them. A fourth app copies it again.
2. **45 uncovered error codes** resolve to "Something went wrong", including
   every recovery, custody and pairing failure. Masked today only because
   `DataKeyGate` carries its own copy.
3. **The memo hazard (Q8) is armed by the first app-level state.** Shell work is
   exactly what introduces that, and the symptom — a protected user thrown back
   to `unlock` — will look like a Gate 7 bug rather than a memo bug.
4. **Seven built and tested screens are unreachable**, four of them because
   `AppCore` has nowhere to mount a second destination.
5. **No rendering test exists at any level.** Any shell change is unconstrained
   by tests except through the pure step functions and the architecture guards.
6. **F-05's fix has no natural home**, because `AuthProvider` sits above the
   layer that owns custody (Q11).

---

## What could not be established

1. **Whether any of the seven screens was ever reachable.** The audit reads the
   current tree; only history would show whether they were built for a shell
   that was removed or for one never written.
2. **Whether the `now?: Date` prop on Expense's `App.tsx:43` is deliberate
   divergence or drift.** Investment has no equivalent and nothing consumes it
   outside the demo month.
3. **Whether `onThemePreferenceChange` is unwired by intent.** It is a declared
   prop with no consumer; nothing records why.
4. **Runtime re-render behaviour.** Q8's conclusion is from static reading of
   React's memo semantics and the absence of state; no app was run and no render
   was counted. A rendering test would settle it.

---

GATE 9A RESULT: COMPLETE
