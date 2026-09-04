# Gate 9B — Application shell: design

Base `main` at `2d01967`. Design only: no production source, no tests, and no
change to CLAUDE.md, `docs/ARCHITECTURE.md`, the package READMEs or any
implementation-state table. Type and interface signatures appear below; no
function bodies and no patches.

---

## Status

**`GATE 9B RESULT: READY FOR IMPLEMENTATION`**

The first pass of this gate was BLOCKED on a missing input: the requirement lock
it was asked to justify against did not exist in the repository, on any branch,
or in any blob in the history, and inventing FR/AC text would have been resolving
a contradiction the brief said to report. **The lock has since been supplied and
is recorded verbatim below.** Q2, Q4 and Q10 are now answered against it, and
nothing else blocks.

All ten questions are answered and all nine required decisions are made, with
rejected alternatives. **No locked requirement is unmet** (§Q10), and **no rule
in CLAUDE.md or `docs/ARCHITECTURE.md` has to change** — see
[Rules this design lives inside](#rules-this-design-lives-inside).

One requirement is met with a caveat that is recorded rather than passed over:
FR-03/AC-02's seventh screen, `DeviceVerification`, is reachable by navigation in
every app and functional only against an auth service that implements it — which
`InMemoryAuthService` does and `FirebaseAuthService` deliberately does not
(§Q2). Every other requirement is met without qualification; NFR-01's 25-line
entry file comes out at 21 (§Q3).

---

## Contradictions with the established facts

**Fact 5 names four findings by identifier; this repository carries no
identifiers.** The four are recorded as prose in package READMEs, and the
mapping is unambiguous, so this does not block:

| Brief | Repository | Recorded state |
| --- | --- | --- |
| F-05 | `packages/security/README.md:105-112` | live |
| F-07 | `packages/auth/README.md:54-64` | live |
| F-09 | `packages/core/README.md:62-70` | latent |
| F-08 (noted in Q6) | `packages/security/README.md:114-121` | live |
| F-06 (cited by 9A) | `packages/account/README.md:57-63` | live |

The F-*nn* numbering exists only in the operator's tracker. Reported so that a
later gate reconciling the two does not assume the repository lost them.

**Facts 1, 2, 3, 4 and 6 are confirmed and are treated as settled.** Fact 1 is
re-verified below where the design turns on it (§Q5).

---

## Problem

`AppCore` renders exactly one thing after the gates and has no state
(`AppCore.tsx:129-168`; the inner `AuthGate` at `:58-123` holds two `useMemo`s
and no `useState`). Seven built, tested platform screens have no call site.
Sign-out is implemented (`packages/auth/src/AuthProvider.tsx:61-64`) and never
invoked. Net Worth needs more than one destination and cannot express a second.

The shell has to add navigation without moving any of the four properties the
previous gates made structural:

1. Domain screens never see the raw repository — `useRepository()` throws
   `REPOSITORY_NOT_ENCRYPTING` rather than returning it
   (`repositoryAccess.ts:21-23`).
2. `EncryptedRepositoryProvider` is rendered unconditionally inside the gate,
   with no branch that skips it (`AppCore.tsx:111-120`, guarded at
   `scripts/check-architecture.mjs:386-391`).
3. A locked or unusable key means no application renders at all — `DataKeyGate`
   returns before `children` in every non-`ready` step
   (`DataKeyGate.tsx:194,213,215,225,253,274,280`).
4. Custody is addressed per identity and the address is derived, never stored
   (`custodyAddress.ts:46-54`).

---

## Requirement lock — application shell

Supplied after the first pass of this gate, and reproduced verbatim. This is the
settled input the decisions below are justified against.

> **Problem:** an app must copy ~110 lines of composition to run; seven built
> platform screens are unreachable; there is no navigation of any kind; three
> unbuilt apps would each copy it again.
>
> **Goal:** a new app declares its name, collections and screens; the platform
> supplies everything else.
>
> **Workflow:** launch → login or resume → unlock → app home. Platform
> destinations — settings, profile, backup, pairing, delete account — reachable
> from anywhere. Back and the Android hardware back button behave consistently.
>
> * **FR-01** The shell owns one route table merging platform routes with
>   app-declared routes.
> * **FR-02** An app declares its routes and home; it writes no navigation code.
> * **FR-03** All seven currently-unreachable platform screens are reachable.
> * **FR-04** Back and Android hardware back are handled by the shell.
> * **FR-05** The key gate wraps the navigator. While the key is locked, no route
>   mounts. Once unlocked, every route is reachable without a further prompt for
>   the rest of the session.
> * **FR-06** Sign-out is reachable and clears custody for the signed-in identity.
> * **FR-07** A single factory replaces per-app composition boilerplate.
> * **NFR-01** A new app's entry file is under 25 lines.
> * **NFR-02** Dependency direction and the portable-path guard hold; no
>   navigation dependency reaches `packages/security`.
> * **NFR-03** App-level state must not rebuild the data-key lifecycle.
> * **NFR-04** Existing apps keep working; Net Worth's persistence is untouched.
> * **AC-01** Net Worth, Expense and Investment run on the shell; each entry file
>   under 25 lines.
> * **AC-02** Every platform screen reachable by navigation in at least one app.
> * **AC-03** Hardware back from a nested route returns to the parent, not out of
>   the app.
> * **AC-04** App state changes do not reset an unlocked key.
> * **AC-05** Sign-out leaves no custody record for that identity, verified after
>   a cold start.
> * **AC-06** Components render under test; the shell is not untested.
>
> **Non-goals:** deep linking, push notifications, per-app theming, the platform
> message-map gap, web parity, and any app's own feature screens.

### What the lock changed in this design

The first pass was written without it. Four things moved, and they are marked
where they occur rather than only listed here:

1. **FR-03 and AC-02 put all seven screens in scope.** The first pass excluded
   `SignupScreen`, `PasswordResetScreen` and `DeviceVerification` as a
   signed-out concern, and kept `BackupScreen` superseded. Both exclusions are
   withdrawn (§Q2, and Scope exclusions 7 and 9 are struck).
2. **FR-07 and NFR-01 add a second factory.** `createAppShell` builds the shell;
   they require something larger — a factory that absorbs the entry point's
   bootstrap as well. `createApp` is added (§Q3, §Q7, gate 9C-5).
3. **The non-goals settle two open questions.** "Any app's own feature screens"
   removes the pressure for route params, and "deep linking" retires the
   link-handling question. Both are now positively justified rather than
   deferred.
4. **AC-06 makes the mount harness mandatory** rather than the thinner of two
   options (§Q9).

### Traceability

| Req | Met by | Verified by |
| --- | --- | --- |
| FR-01 | §Q2 route model; `resolveRouteTable` merges platform and app routes | 9C-1 |
| FR-02 | §Q3 `AppRouteTable` incl. `home`; §Q9 tier-3 guard that no app screen imports `@react-navigation/*` | 9C-1, 9C-3 |
| FR-03 | §Q2 Settings tab (4 screens) + auth stack (3 screens). `DeleteAccount` is a route unconditionally; only its Settings row is capability-gated | 9C-1, 9C-4, AC-02 |
| FR-04 | §Q1 `native-stack` + `NavigationContainer`; no `BackHandler` code | 9C-6 (AC-03) |
| FR-05 | §Q4 | 9C-3, 9C-6 |
| FR-06 | §Q6 F-05; `useSignOut` running `signOutPlan` | 9C-3, 9C-6, AC-05 |
| FR-07 | §Q3 `createApp` | 9C-5 |
| NFR-01 | §Q3 `createApp`, platform modules injected — measured at 21 lines | 9C-7/8/9 (AC-01) |
| NFR-02 | §Q7 boundary: `security` imports only `utils`; the portable-path guard walks out from `security` | 9C-2, `pnpm lint` |
| NFR-03 | §Q5 memo keyed on `[user?.id]`; constructions absorbed by `createApp` | 9C-3, 9C-6 (AC-04) |
| NFR-04 | §Q8 additive migration; Net Worth's persistence in no diff | 9C-7/8/9 |
| AC-06 | §Q9 tier-2 mount harness | 9C-6 |

---

## Established facts this design uses

Each verified against the tree at `2d01967`.

1. **`@react-navigation/native@7.3.18` has no native peer.** Its
   `peerDependencies` are `react >= 18.2.0` and `react-native: "*"` — nothing
   else. (npm registry, fetched.)
2. **`native-stack@7.18.10` and `bottom-tabs@7.18.18` peer on
   `react-native-screens >= 4.0.0` and `react-native-safe-area-context >= 4.0.0`**,
   and nothing else beyond react/react-native/`@react-navigation/native`.
3. **Expo SDK 52 pins both of those natives**, from the installed
   `expo@52.0.49`'s own `bundledNativeModules.json`: `react-native-screens
   ~4.4.0`, `react-native-safe-area-context 4.12.0`.
4. **`expo-router@4.0.22` *depends on* React Navigation** —
   `@react-navigation/native ^7.0.14`, `@react-navigation/bottom-tabs ^7.2.0`,
   `@react-navigation/native-stack ^7.2.0` — plus `react-helmet-async`,
   `react-native-helmet-async`, `@radix-ui/react-slot`,
   `react-native-is-edge-to-edge`; and peers on `expo-linking ~7.0.5`,
   `expo-constants ~17.0.8`, `react-native-reanimated` (Expo pins `~3.16.1`) and
   `@react-navigation/drawer ^7.1.1`.
5. **The lockfile contains no navigation package** (9A Q10), so either choice is
   a genuine addition.
6. **Only `@platform/*` imports are lint-restricted.** `eslint.config.mjs:85-119`
   derives forbidden groups from the internal dependency table alone; an
   external package is unconstrained. Adding a navigator to `packages/core`
   requires no ESLint change.
7. **`secureStorage` is already inside the provider tree.** It is a field of
   `PlatformServices` (`ServicesProvider.tsx:25`), so any component under
   `AppCore` can reach it — which is what makes F-05 solvable at all.
8. **The Hermes CI job builds `tools/x1-selftest`, not the three apps**
   (`.github/workflows/android-runtime.yml:195-196`). New native modules in
   `apps/*` do not affect that job — and are not exercised by it either.

---

## Target architecture

```text
index.tsx            builds secureStorage, fails closed, registers Root
  App.tsx            constructs services ONCE (see §Q5), declares its routes
    AppCore                       ── unchanged composition root
      ThemeProvider
        ServicesProvider
          AuthProvider
            AuthGate              ── initializing / signed-out / signed-in
              DataKeyGate         ── setup / recover / unlock / pair / blocked
                EncryptedRepositoryProvider
                  AppShell        ── NEW. NavigationContainer lives here.
                    Tabs          ── [ ...app tabs, Settings ]
                      Stack       ── one native-stack per tab
                      Modals      ── one root-level modal group
```

The only structural change to the existing tree is that `AppCore`'s `children`
— today a screen — becomes `<AppShell routes={…} />`. Everything above it is
untouched, so every property in §Problem holds by construction rather than by
review.

---

## The ten questions, and the nine decisions

### Q1 — Navigator: `@react-navigation/native`, with `native-stack` and `bottom-tabs`

`expo-router` is rejected. Three reasons, in order of weight.

**1. Its route table is a directory, and the shell cannot own a directory.**
Fact 3 of the brief says the shell owns the table and apps declare into it.
`expo-router` resolves routes from files under the *application's* `app/`
directory. A package can export components for those files to re-export, but the
set of routes — the table — is then the app's filesystem. That is the inverse of
the requirement, and no configuration reverses it.

**2. It displaces the entry point, which is where custody fails closed.**
`expo-router` replaces `registerRootComponent` with `expo-router/entry`. Today
each app's entry (`apps/expense/index.tsx:71-101`) builds secure storage, and on
failure renders "Secure storage is unavailable on this device, so the app cannot
start" and nothing else — no in-memory substitute, no plaintext fallback
(`:79-80`) — the failure branch renders that message and nothing else (`:87-93`). Under file-system routing the route files sit above that bootstrap,
so a route can be resolved and rendered before the storage decision has been
made. This is a security-significant relocation of a fail-closed boundary, and
it is the reason `expo-router` is not merely the heavier option but the wrong
one here.

**3. It is a superset, and the surplus is all cost.** Fact 4 above: it *contains*
the three React Navigation packages this design uses. Choosing React Navigation
directly is choosing the subset — with none of `react-native-reanimated` (a
native module with a Babel plugin), `expo-linking`, `expo-constants`,
`@react-navigation/drawer`, `react-helmet-async` or `@radix-ui/react-slot`.

**Bundle and native cost of the accepted choice.**
`@react-navigation/native` adds no native module (fact 1). `native-stack` and
`bottom-tabs` require `react-native-screens ~4.4.0` and
`react-native-safe-area-context 4.12.0` (facts 2, 3) — both pinned by Expo SDK 52,
both installable with `npx expo install`, neither needing app config.
`@react-navigation/elements` peers optionally on
`@react-native-masked-view/masked-view` (`peerDependenciesMeta.optional: true`,
verified); it is not installed and is not needed.

**Rejected alternatives.**

| Rejected | Why |
| --- | --- |
| `expo-router` | The three reasons above. |
| `@react-navigation/stack` (JS stack) | Adds `react-native-gesture-handler` on top of screens and safe-area-context, for a worse-performing stack. Strictly more dependency for strictly less. |
| A hand-rolled navigator (a discriminated union in React state) | Zero dependencies, and it was seriously considered — it is the smallest thing that satisfies fact 3. Rejected because it re-implements back-handling, Android hardware back, deep links, state restoration and tab state, and the first of those it gets wrong is a user losing typed input. CLAUDE.md's "explain why the existing stack is insufficient" is answered by exactly this list. |
| Nothing; keep one screen per app | Contradicts fact 4 (Net Worth is multi-screen). |

### Q2 — Route model: one tab navigator, a stack inside each tab, one modal group

- **Tabs** are the top level. The app's declared destinations are the leading
  tabs; **the shell appends `Settings` as the last tab**, always, and the app
  cannot remove it. That is what gives the seven unreachable screens
  (9A Q3) a home without any app having to know they exist.
- **A native-stack inside each tab**, so a tab can push a detail view without
  leaving the tab — the shape Net Worth needs (fact 4).
- **One root-level modal group** (`presentation: 'modal'`) for transient flows
  that are not destinations: pairing, backup export/import, passphrase change,
  delete-account confirmation.
- **Platform destinations are not tabs.** Profile, Backup, Pair device,
  Passphrase and Delete account are rows *inside* the Settings tab's stack,
  assembled into `SettingsScreen`'s existing `sections` and `dangerZone` props
  (`SettingsScreen.tsx:11-15`) — which is the shape that component was built for
  and has never been given.

**Where the app's set attaches:** at the tab list, and nowhere else. An app
cannot add a route to Settings, cannot reorder Settings, and cannot add a modal
that the shell does not know about. One direction of extension, so there is one
place to audit — which is FR-01's "one route table" and FR-02's "writes no
navigation code" expressed as a shape rather than a convention.

#### Against FR-03 and AC-02 — where each of the seven screens lands

FR-03 requires all seven reachable; AC-02 requires each reachable by navigation
in at least one app. **Two navigators, never both mounted**, are what it takes:

| Screen | Route | Navigator |
| --- | --- | --- |
| `SignupScreen` | `signup` | auth stack |
| `PasswordResetScreen` | `reset` | auth stack |
| `DeviceVerification` | `verify-device` | auth stack, and a Settings row |
| `SettingsScreen` | `settings` (the appended tab) | app shell |
| `ProfileScreen` | `settings/profile` | app shell |
| `BackupScreen` | `settings/backup` | app shell |
| `DeleteAccount` | `settings/delete` | app shell — route always; **row conditional** |

**Ruling — account deletion: the route exists, the row is hidden.**
`DeleteAccount` is a route unconditionally, so FR-03 and AC-02 are met: the
screen is reachable. **The Settings row that reaches it is omitted unless a
deletion flow is injected** — `deleteAccountAvailable` on `ShellCapabilities`
(§Q3), making `'delete-account'` conditional in `resolveRouteTable` exactly as
`backup`, `pair-device` and `sign-out` already are. One rule for capabilities
the composition did not supply, not four cases and an exception.

*Rejected alternative: ship the row anyway.* A visible, permanently enabled
"Delete my account" that does nothing is worse than no row. It is the most
consequential control in the product, a user pressing it has decided something,
and a button that silently fails there teaches them their data is gone when it
is not — or that the app is broken at the moment they least want to find out.
CLAUDE.md rule 28 already refuses to let deletion *imply* more than it does;
implying it happened at all is the same error, larger. This is the same
discipline `pairingRelay` and `backupTransport` established: a capability that
cannot be completed is not offered.

**F-06 closes in its own gate, afterwards.** Wiring `onDelete` to
`deleteAccountFlow` (`packages/account/README.md:57-63`) is a deliberate piece
of work with a re-authentication step and a documented deletion order, and it is
required by no clause of the lock. This gate stops at making the destination
exist and the row honest about whether it can be reached.

**The auth stack is new to this pass**, and FR-03 is what adds it.
`SignupScreen` and `PasswordResetScreen` hang off `LoginScreen`'s
`onCreateAccount` and `onForgotPassword`, which are `() => undefined` in all
three apps (9A Q3). A stub is not reachability, so the signed-out branch gets a
navigator of its own: a native-stack rooted at `LoginScreen`, rendered as
`AppCore`'s `signedOut`, replacing the bare `<LoginScreen …/>` each app passes
today.

**This does not weaken FR-05.** The auth stack sits in `AuthGate`'s
`!user → signedOut` branch (`AppCore.tsx:109`), which returns *before*
`DataKeyGate` and *before* `EncryptedRepositoryProvider`. There is no key and no
encrypting repository in that subtree — and it fails closed if one is ever
reached for: `useRepository()` there resolves the raw repository and throws
`REPOSITORY_NOT_ENCRYPTING` (`repositoryAccess.ts:21-23`). FR-05's "the key gate
wraps the navigator" is about the application navigator, and it does.

**`BackupScreen` is reinstated, and the repository predicted it.**
`BackupControls.tsx:19-21` records that it is *deliberately* not `BackupScreen`
because that component "wraps itself in a `Screen`, which belongs to an
application with navigation to route to it". This gate supplies the navigation,
so the stated condition is met: `BackupScreen` becomes the `settings/backup`
route. `BackupControls` stays exported for a host with no navigation, and its
comment becomes a description of the alternative rather than of an absence.

**`DeviceVerification` — reachable everywhere, functional where the service
implements it.** It is a `settings/verify-device` row and an auth-stack route, so
it is navigable unconditionally. Its action then depends on the injected service,
and the two implementations differ by design, not by defect:
`InMemoryAuthService.confirmDeviceVerification` (`packages/auth/src/services/InMemoryAuthService.ts:116-119`) works, so the screen
is functional end-to-end in every preview composition — which is what AC-02's "in
at least one app" asks for. `FirebaseAuthService` throws
`DEVICE_VERIFICATION_UNAVAILABLE` (`packages/firebase/src/services/FirebaseAuthService.ts:132-134`),
which is the documented fail-closed contract of the interface itself
(`packages/auth/src/types/auth.ts:28-33`: an implementation without a trusted
server *must* fail closed). Recorded plainly: **against Firebase this screen is
reachable but cannot succeed**, and closing that needs a trusted server, which
Firebase Spark rules out (CLAUDE.md rule 21). It is not this gate's to close.

#### Against FR-04 and AC-03 — hardware back

AC-03 requires hardware back from a nested route to return to the parent rather
than exiting. The route model delivers this structurally rather than with a
handler:

- **A nested route inside a tab is a native-stack push.** `native-stack` maps
  Android's back gesture and hardware button onto a stack pop through
  `react-native-screens`. Back from `settings/profile` returns to `settings`.
- **From a tab root, `bottom-tabs`' default `backBehavior: 'firstRoute'` returns
  to the first tab** — the app's declared `home` (§Q3) — rather than exiting.
- **From `home` with an empty stack, back exits.** That is the correct terminal
  behaviour and is what AC-03's "not out of the app" excludes only for a *nested*
  route.
- **The shell writes no `BackHandler` code**, which is FR-04's "handled by the
  shell": the shell owns the navigator, and the navigator owns back. An app
  registering its own handler would be app navigation code, which the §Q9 tier-3
  guard forbids.

**The gate steps are deliberately outside this.** `DataKeyGate`'s steps are not
routes (§Q4), so hardware back at the unlock screen exits the app. That is the
consequence of FR-05, and it is the right one: there is nowhere behind an unlock
screen to go back to, and a back that dismissed it would be a way past the gate.

**Rejected alternatives.** A single stack with no tabs (cheapest, but Settings
then has to be reachable from every screen's header, which is a per-screen
obligation the shell cannot enforce, and the lock's "reachable from anywhere"
would become a convention). Tabs with no stacks (no push, so AC-03 has nothing
to pop and fact 4's detail views cannot exist). Settings as a modal rather than
a tab (works, and was close — rejected because a modal has no stable back-stack,
so AC-03 inside Settings would depend on the modal's own dismissal semantics,
and account deletion and passphrase change are flows a user may need to leave
and return to). Signup and reset as modals over `LoginScreen` (fewer moving
parts than an auth stack, rejected for the same AC-03 reason).

### Q3 — The app-declaration contract

Signatures only.

```ts
// packages/core/src/shell/routes.ts — types and a pure factory. No JSX.

/** A destination an application contributes. Components take no props: they
 *  read data through the existing hooks (`useRepository`, `useAppConfig`). */
export interface AppDestination {
  /** Stable, unique within the table. Used as the navigator's route name and
   *  as the deep-link path segment. */
  readonly name: string;
  /** Tab label and stack header title. */
  readonly title: string;
  /** Lucide icon name, resolved by the shell. Absent renders a text label. */
  readonly icon?: string;
  readonly component: ComponentType;
}

/** A destination reachable only by pushing onto a tab's stack. */
export interface AppDetailDestination extends AppDestination {
  /** Which tab's stack it belongs to. Must name a member of `tabs`. */
  readonly within: string;
}

export interface AppRouteTable {
  /** At least one. The order is the tab order; `Settings` is appended by the
   *  shell and may not appear here. */
  readonly tabs: readonly [AppDestination, ...AppDestination[]];
  /** FR-02's "and home": names the tab the app opens on, and the tab hardware
   *  back returns to (AC-03). Must name a member of `tabs`; defaults to the
   *  first. Explicit rather than positional so that reordering the tabs does
   *  not silently move the home destination. */
  readonly home?: string;
  readonly details?: readonly AppDetailDestination[];
  readonly modals?: readonly AppDestination[];
  /** Extra rows for the Settings tab, below the platform's own. */
  readonly settingsSections?: readonly SettingsSection[];
}

/** What the shell decides, as data — the `dataKeyStep` pattern (§Q9). */
export interface ShellCapabilities {
  readonly backupAvailable: boolean;         // a BackupTransport was injected
  readonly pairingAvailable: boolean;        // a PairingRelay was injected
  readonly signOutAvailable: boolean;        // a clearDataKeyFor was injected
  readonly deleteAccountAvailable: boolean;  // a deletion flow was injected
}

export interface ResolvedRouteTable {
  readonly tabs: readonly AppDestination[];        // app tabs + Settings
  readonly details: readonly AppDetailDestination[];
  readonly modals: readonly AppDestination[];
  readonly settingsRows: readonly SettingsRowId[];
}

export type SettingsRowId =
  | 'profile' | 'theme' | 'passphrase' | 'pair-device'
  | 'backup' | 'sign-out' | 'delete-account';

/** Pure. Throws `SHELL_ROUTE_TABLE_INVALID` on a duplicate name, an empty tab
 *  list, a `within` naming no tab, a `home` naming no tab, or an app trying to
 *  declare `Settings`.
 *
 *  Four `settingsRows` are conditional on a capability and are omitted when it
 *  is absent: `backup`, `pair-device`, `sign-out` and `delete-account`. The
 *  routes still exist either way — only the row that reaches them is dropped. */
export function resolveRouteTable(
  table: AppRouteTable,
  capabilities: ShellCapabilities,
): ResolvedRouteTable;
```

```ts
// packages/core/src/shell/AppShell.tsx — the one component.
export interface AppShellProps { readonly routes: AppRouteTable }
export function AppShell(props: AppShellProps): ReactElement;

/** Navigation, for a screen. The only navigation API a screen may use. */
export function useNavigateTo(): (name: string) => void;
```

**The factory the brief asks for**, for an app that would rather build the table
once at module scope than re-declare it per render (§Q5 makes this the
recommended form):

```ts
export function createAppShell(table: AppRouteTable): ComponentType;
```

It validates `table` **at call time** — module scope, before React — so a
malformed table is a startup failure, not a render-time one, and returns a
zero-prop component to pass as `AppCore`'s `children`.

**No route params in v1.** Deliberate and recorded as a scope exclusion: no
existing screen takes an id, adding a typed param map is the largest single
piece of type machinery in this design, and rule 12 makes adding it later a
breaking change that must update all three apps in one commit. That trade is
named in [Open questions](#open-questions) rather than decided here, because the
requirement lock is what should decide it.

**Rejected alternatives.** Apps passing a rendered `<Navigator>` (they would own
the navigator — fact 3 forbids it). Apps registering routes imperatively via a
mutable registry (order becomes import-order-dependent, and nothing can validate
the table before render). Routes as React children (`<Route …/>` elements) — the
table then cannot be inspected without rendering, which forfeits the entire
pure-function test strategy of §Q9.


#### `createApp` — the factory FR-07 and NFR-01 require

`createAppShell` above builds the shell. FR-07 asks for "a single factory
[that] replaces per-app composition boilerplate" and NFR-01 caps a new app's
entry file at 25 lines, which is a larger job: today Expense needs 113 lines of
`App.tsx` and 105 of `index.tsx` before a domain rule exists (9A Q1). So a
second, outer factory absorbs the entry point's bootstrap.

```ts
// packages/core/src/shell/createApp.tsx

/** The platform modules the bootstrap needs. Injected, never imported by this
 *  package — see the constraint below. */
export interface AppPlatform {
  /** `expo-secure-store`, as a module namespace. */
  readonly secureStore: SecureStoreModule;
  /** Keychain namespace. Distinct per app, as today. */
  readonly keychainService: string;
  readonly randomBytes: RandomBytes;
}

export interface AppDefinition {
  readonly appName: string;
  readonly collections: readonly string[];
  readonly routes: AppRouteTable;
  readonly platform: AppPlatform;
  /** Backend-dependent services. Resolved once, at bootstrap. Rejecting means
   *  the app does not start — there is no preview fallback. */
  readonly services: () => Promise<PlatformServices> | PlatformServices;
  readonly backupTransport?: BackupTransport;
  /** Copy for a bootstrap that failed closed. A default is supplied. */
  readonly unavailable?: (reason: BootstrapFailure) => ReactNode;
}

export type BootstrapFailure = 'secure-storage' | 'services';

/** The root component. Pass straight to `registerRootComponent`. */
export function createApp(definition: AppDefinition): ComponentType;
```

**What it absorbs**, all of it identical across the three apps today (9A Q2
measured zero platform-logic differences between Expense and Investment):
`buildCustodyStorage()` and its browser/native branch; the fail-closed bootstrap
state machine and its "cannot start" rendering; `createCryptoService`;
`createRecordCipher`; `dataKeyLifecycleFor`; `clearDataKeyFor` (§Q6); the
`AppCore` element; and the signed-out auth stack (§Q2).

**What stays with the app:** its name, its collections, its keychain namespace,
its routes, and a `services` resolver — which is the only thing permitted to
name a backend, and stays in `src/composition/**` where the ESLint rule and
`check-architecture.mjs` already require it.

**The hard constraint, and why the platform modules are parameters.** No file
under `packages/` imports an Expo module today — verified: zero matches for
`from 'expo…'` or `registerRootComponent` across every `packages/*/src`. That is
deliberate and stated at `apps/expense/index.tsx:31-32`: *"Secure storage is
chosen here, at the composition root, and injected — the shared packages never
reach for a platform module themselves."* A `createApp` that imported
`expo-secure-store` would make `packages/core` Expo-only and break the property
that every shared package is testable and portable. So `AppPlatform` is a
parameter, the entry file imports the modules, and `registerRootComponent` stays
in the app.

**Measured against NFR-01.** Net Worth is the worst case, because it is the only
app with a backup transport and a backend selection:

```tsx
import { registerRootComponent } from 'expo';                    //  1
import * as SecureStore from 'expo-secure-store';                //  2
import { getRandomBytes } from 'expo-crypto';                    //  3
import { createApp } from '@platform/core';                      //  4
import { COLLECTIONS } from './src/collections';                 //  5
import { ROUTES } from './src/routes';                           //  6
import { resolveServices } from './src/composition/services';    //  7
                                                                 //  8
registerRootComponent(                                           //  9
  createApp({                                                    // 10
    appName: 'Net Worth',                                        // 11
    collections: COLLECTIONS,                                    // 12
    routes: ROUTES,                                              // 13
    platform: {                                                  // 14
      secureStore: SecureStore,                                  // 15
      randomBytes: getRandomBytes,                               // 16
      keychainService: 'networth',                               // 17
    },                                                           // 18
    services: resolveServices,                                   // 19
  }),                                                            // 20
);                                                               // 21
```

**21 lines**, against NFR-01's cap of 25. Expense and Investment come out at 21
too — they differ only in the app name, the collections and the keychain
namespace, which is 9A Q2's finding restated as a file. **The `backupTransport`
parameter is deliberately not used here.** Passing it in the entry file was the
first draft and came to exactly 25 lines, which fails a cap written as *under*
25; folding the transport into `resolveServices` instead costs nothing, because
Net Worth already merges it into the services object at
`apps/networth/index.tsx:150` (`setServices({ ...composed, backupTransport })`).
The parameter stays on `AppDefinition` for an app that wants the transport
visible at its root, but no app uses it.

**What moves out of `apps/networth/index.tsx` to make this fit:**
`readEnvironment()` (`:49-60`), the `selectBackend` / `misconfigurationMessage`
branch (`:132-136`), the two composition calls (`:145-146`) and the transport
construction (`:118-122`) all move behind `resolveServices` in
`src/composition/services.ts`. That is app composition moving into the app's
composition module — the layer CLAUDE.md already designates as the only place
permitted to name a backend — not logic moving into a package. **NFR-04 is
satisfied by exactly this**: `src/data/`, the Firestore document shapes and
`firestore.rules` are untouched, and `createProductionServices` keeps its
current body.

**Rejected alternatives.** `createApp` importing the Expo modules directly
(fewest lines in the entry file, and rejected on the boundary above — it would
also make every `packages/core` test require an Expo runtime, which would take
AC-06's harness from difficult to impossible). One factory instead of two —
`createApp` returning the shell as well (rejected because `createAppShell`'s
table validation must run at module scope, before React, and `createApp`'s
bootstrap is inherently async; folding them hides a synchronous validation
inside an async boot). Codegen or a template CLI (does not satisfy FR-07's
"single factory", and generated boilerplate is still boilerplate — it just stops
being reviewed).

### Q4 — Gate placement: **the gates wrap the navigator**

`AuthGate` → `DataKeyGate` → `EncryptedRepositoryProvider` → `AppShell`. Auth and
unlock are **not** routes, and there is no navigation guard anywhere.

Three reasons, and the first is a hard rule.

1. **CLAUDE.md hard rule 14** — *"Never rely on hidden buttons, client-side role
   checks, navigation restrictions, or client validation alone for security."* A
   gate implemented as a redirect is a navigation restriction. Wrapping is the
   only placement the rule set permits.
2. **A route-based gate mounts every screen while the key is locked.** Under a
   redirect the navigator exists, so route components mount and their effects
   run. `useRepository()` resolves — the `EncryptingRepository` is in context —
   and a `useEffect` firing a read before the redirect lands calls
   `lifecycle.load()`, which throws `DATA_KEY_LOCKED`. The user sees a crash or
   a swallowed error where they should see the unlock screen. Wrapping means the
   screen component does not exist.
3. **It is the property the tree already encodes.** `EncryptedRepositoryProvider`
   is rendered with no conditional above it precisely so that no composition can
   fall past it by omission (`AppCore.tsx:112-117`), and
   `check-architecture.mjs:386-391` fails the build if it stops being rendered.
   Putting the navigator inside that provider extends the existing guarantee
   rather than adding a parallel one.

**Deep links.** `NavigationContainer` reads the initial URL when it mounts. Since
it does not mount until the gates open, a link arriving during setup, recovery
or unlock is resolved *after* the key is ready — the correct behaviour, obtained
for free from the placement rather than from link-handling code.

**Cost, stated plainly.** Wrapping means the navigator unmounts and remounts
whenever the gate closes — a passphrase-protected user backgrounding and
returning loses their route. That is the price of property 3 in §Problem, and it
is the right price: the alternative is a mounted screen tree over a locked key.

**Ruling — always home.** After an unlock the shell opens on the app's declared
`home` destination (§Q3). **Route position is not persisted across a locked
key**, and this is settled rather than deferred.

The reason is where the persisted value would have to live. A route name
survives a locked key only by being written somewhere the app can read *before*
the key is opened — which is, by definition, outside the encrypted boundary.
Every record this platform stores goes through `EncryptingRepository`, and the
one thing deliberately kept outside it is the wrapped key itself. Adding a
second exception for a convenience would put a fact about what the user was
looking at — "assets", "delete account", the name of a detail route — into
plaintext storage, readable by anything that can reach the device's files. That
is a small disclosure, but it is a new category of one, bought for a
scroll-position-sized benefit.

And it is not a trade worth making, because **home is a correct destination.**
It is where the app opens on a cold start, it is where hardware back returns
from a tab root (AC-03), and it is a place the user chose to have as their
first screen. Landing there after an unlock is not a degraded outcome; it is
the ordinary one.

#### Against FR-05

FR-05 is written as wrapping rather than routing, which is the placement decided
above. Its three clauses map onto the tree exactly:

| FR-05 clause | Where it holds |
| --- | --- |
| "The key gate wraps the navigator" | `DataKeyGate` → `EncryptedRepositoryProvider` → `AppShell` (§Target architecture) |
| "While the key is locked, no route mounts" | `DataKeyGate` returns at `:253` for `unlock` and never reaches `children`; `AppShell` is `children` |
| "Once unlocked, every route is reachable without a further prompt for the rest of the session" | `opened` lives in the lifecycle closure (`dataKeyLifecycle.ts:198`) and survives for as long as that object does — which is what NFR-03 and §Q5 exist to guarantee |

**The reason it is wrapping rather than routing, recorded under FR-05 as
required.** Hard rule 14 forbids relying on navigation restrictions for security,
and the failure it is guarding against is concrete here rather than theoretical:
**a redirect-based gate mounts every screen while the key is locked.** The
navigator exists, so route components mount and their effects run;
`useRepository()` resolves, because `EncryptedRepositoryProvider` is in context
above the navigator; and an effect firing a read before the redirect lands calls
`lifecycle.load()`, which throws `DATA_KEY_LOCKED`. The user gets a crash or a
swallowed error at the moment they should be getting an unlock prompt. Wrapping
means the screen component does not exist, so there is no effect to fire.

Note that FR-05's third clause and NFR-03 are the same requirement approached
from two directions: a rebuilt lifecycle has `opened === null`, which is exactly
"a further prompt in the same session". §Q5 is therefore load-bearing for FR-05,
not only for AC-04.

**Rejected alternatives.** Gates as routes with a `beforeRemove`/redirect guard
(reasons 1–3). A hybrid — auth as a route, unlock as a wrapper (splits one
invariant across two mechanisms, so a reader has to know which is which; and the
auth half still violates rule 14). Gates inside a `Suspense` boundary (React 18.3
here, no data-fetching integration, and a thrown promise would not express
"blocked, no resolution" — the `unusable` dead end has no retry).

### Q5 — State ownership without arming 9A Q8

**The mechanism, in three parts.**

**1. The route table is not React state.** `createAppShell(table)` runs at module
scope. `resolveRouteTable` is pure. Nothing about the table can be rebuilt by a
render.

**2. Navigator state lives in `NavigationContainer`, below the gates.** The
current route is React Navigation's own store, inside a component that is a
descendant of `AuthGate`. A tab change re-renders the navigator subtree and
**cannot** re-render `AuthGate` or `App`. `AppCore` gains no `useState`, so 9A
Q5 ("nowhere a current destination could live") is satisfied by putting the
destination somewhere that already exists rather than by adding state upward.

**3. The hazard is removed at its source, not avoided.** Points 1 and 2 mean
*this design* does not re-render `App`. That is not good enough: 9A Q8's warning
is that the first app-level state arms it, and a shell is what invites app-level
state. So the memo is fixed as part of this work.

**The hazard is worse than 9A Q8 recorded, and this is a new finding.** 9A
identified one unmemoised construction. There are **three**, in each of the three
apps, none memoised (verified: zero `useMemo` and zero `useState` in all three
`App.tsx`):

| Line (expense) | Constructed per render | Consequence of a rebuild |
| --- | --- | --- |
| `:56` `createCryptoService(…)` | a new crypto service | changes a `PlatformServices` value, so `ServicesProvider`'s `useMemo(…, Object.values(services))` yields a new `services` identity |
| `:60` `createRecordCipher(…)` | a new record cipher | a dependency of `EncryptedRepositoryProvider`'s memo (`:46`) |
| `:67` `dataKeyLifecycleFor` | a new closure | invalidates `AuthGate`'s memo (`AppCore.tsx:82`) |

The combined effect of one `App` re-render is therefore: a new `EncryptingRepository`
(new `services` **and** new `cipher` **and** new `lifecycle` — three of that
memo's four deps at once), and a new `DataKeyLifecycle` whose `opened` is `null`
(`dataKeyLifecycle.ts:198`), which re-runs `DataKeyGate`'s `useEffect([lifecycle])`
(`:121-131`) and returns a protected user to `unlock`.

**The fix, in two layers:**

- **Structural, in `packages/core`.** `AuthGate`'s lifecycle memo keys on
  `[user?.id]` alone, reading the factory through a latest-ref rather than
  listing it as a dependency. The lifecycle's identity then depends on the
  *user*, which is the invariant that actually matters, and no application can
  undo it. Enforced by a new assertion in `scripts/check-architecture.mjs` that
  the dependency array is `[user?.id]` — an *addition* to enforcement, which
  hard rule 22 permits (it forbids weakening enforcement to make a feature
  compile).
- **Local, in each app.** The three constructions move to module scope, above
  the component. They close over nothing render-scoped, so this is a move, not a
  memoisation — and a move cannot be defeated by a missing dependency.

Doing only the second would leave the next app free to reintroduce it; doing
only the first leaves `recordCipher` and `cryptoService` rebuilding. Both.

**Rejected alternatives.** Requiring apps to `useMemo` (a convention the fourth
app forgets, and 9A Q8 notes the symptom looks like a Gate 7 bug, so it would be
diagnosed in the wrong package). Caching lifecycles in a module-level `Map` keyed
by user id (a process-lifetime cache of objects holding an opened DEK, surviving
sign-out — directly against F-05's direction of travel). Moving `opened` out of
the closure into storage (defeats Gate 7). A state-management library — banned
outright: `redux` and `mobx` are in `BANNED_DEPS` (`check-architecture.mjs:34`).

**Concurrent-rendering caveat.** The latest-ref pattern assigns during render.
This tree uses no concurrent feature — no `startTransition`, no `Suspense`, RN
0.76 with React 18.3.1 — so the pattern is safe here; React Navigation ships
`use-latest-callback` for the same reason. Recorded in
[Open questions](#open-questions) as something to revisit if concurrent
rendering is ever enabled.

### Q6 — Ruling on F-05, F-07, F-09

#### F-05 — custody never cleared: **required**

Not deferrable, and the reason is specific: **this gate creates the defect's
reachability.** F-05 is live today only in the sense that `clear()` has no
caller; a user cannot sign out at all (9A Q11), so no key is ever left behind by
a sign-out that happened. The Settings tab adds the first sign-out button in the
platform's history. Shipping that button without the clear means shipping a
feature whose entire observable effect is to leave a data encryption key on a
device the user believes they have left.

**Exact call site.** A new `useSignOut()` in `packages/core`, consumed by the
Settings tab's sign-out row. Not `AuthProvider.signOut` — `AuthProvider` holds
only an `AuthService` (`AuthProvider.tsx:19`) and sits *above* the layer that
owns custody, exactly as 9A Q11 established.

**Identity available there.** `useAuth().user.id`, read *before* `signOut()` is
called. The ordering is the whole point: the id exists at `AuthProvider.tsx:62`
and is gone by `:63`, so the clear must happen in the caller, before the funnel.

**The sequence, and it is a pure function** (`signOutPlan`, §Q9):

```text
1. read userId from useAuth()          ── must precede everything
2. clearDataKeyFor(userId)             ── custody.clear(), address derived
3. signOut()                           ── AuthProvider's existing funnel
4. AuthGate re-renders → signedOut     ── gate unmounts, navigator with it
```

**F-08 is satisfied by construction.** `clear()` removes
`custodyAddressFor(owner)` (`keyCustody.ts:177`, `:246-248`) — the address is
recomputed from the identity by `custodyAddressFor` (`custodyAddress.ts:53`),
never read from a list of what this process wrote. So this path does not inherit
`OsKeystoreStorage.clear()`'s inability to reach a previous process's key
(`packages/security/README.md:114-121`): it never enumerates.

**How custody reaches the call site.** A new optional `AppCore` prop, declared
beside `dataKeyLifecycleFor` and built from the same closure:

```ts
/** Removes this user's stored data key. Absent ⇒ no sign-out is offered. */
clearDataKeyFor?: (userId: string) => Promise<void>;
```

Optional, and its absence removes the sign-out row entirely
(`ShellCapabilities.signOutAvailable`, §Q3) — the same discipline
`pairingRelay` and `backupTransport` already use: a capability that cannot be
completed is not offered. Rejected alternative: adding `clear()` to
`DataKeyLifecycle`, which would widen a deliberately narrow security interface
(`docs/ARCHITECTURE.md:465`) and give every holder of a lifecycle the ability to
destroy a key.

**If the clear fails.** Sign-out still proceeds, and the failure is surfaced, not
swallowed. Refusing to sign out would strand a user on a shared device because
of a keystore error; and the state after a failed clear is exactly today's state,
which is the documented status quo. Rejected alternative: clear-after-sign-out
(the id is gone) and best-effort-silent (a security-relevant failure with no
signal).

#### F-07 — cold-start race: **required, and sequenced first**

`AuthProvider` (`AuthProvider.tsx:27-47`) clears `initializing` in `.finally()`
regardless of outcome, and its `.then()` at `:36-39` can overwrite an
already-restored user with `null`. Two consequences today; the shell adds a
third and worse one.

Today: a signed-in person can be shown signed out. With the shell: `user`
transitioning to `null` takes `AuthGate` down the `signedOut` branch
(`AppCore.tsx:109`), which **unmounts `DataKeyGate` and the entire navigator**.
When `onAuthStateChanged` then delivers the real user, everything remounts, the
key state is re-read, and a protected user is asked for their passphrase — on a
cold start, before they have touched anything. That is indistinguishable to the
user from Gate 7 being broken.

Required, but **scoped to `packages/auth` and sequenced before any shell code**
(Gate 9C-0 below): it is a defect in that package, it is testable without any
shell, and fixing it inside the shell work would entangle a three-line auth
change with a navigator.

#### F-09 — `DataKeyGate` per-user state: **deferrable — with a mandatory guard**

The finding is latent because every identity change passes through `user ===
null`, which unmounts the gate (`packages/core/README.md:66-70`). **This design
preserves that**: `AuthGate`'s `!user → signedOut` branch is untouched, and the
sign-out sequence in F-05 ends by going through it. Sign-out → sign-in as a
different user still passes through `null`. So the shell does not arm F-09.

Deferring the fix is only safe if the *unmounting* stays true, and nothing
currently asserts it. So the ruling is: **fix deferred, guard required.** A
characterization test pins that `AuthGate` renders `signedOut` — not the gate —
whenever `user` is null, so that a later "keep the shell mounted across account
switch" change fails a test instead of silently arming a retained recovery code.
Rejected alternative: fixing F-09 now anyway — it is cheap, but it would be an
untested-by-need change to a security component in a gate that has no way to
exercise the path, and Gate 7's discipline was not to touch what the gate cannot
demonstrate.

### Q7 — Package boundary: everything in `packages/core`; **no new package**

`docs/ARCHITECTURE.md:19` — *"When uncertain, build app-specific first. On second
use, extract the generic part."* Strictly applied, the shell is not app-specific:
fact 3 makes it shared by definition, and building three copies to extract on the
second would be building the duplication the rule exists to prevent. The rule's
purpose — do not create a package before the shape is known — is served instead
by putting it in a package that already exists.

**`core` is the right one.** CLAUDE.md:67 defines it as *"AppCore composition
root and shared providers"*; the shell is a provider around the composition
root's children. `core` may already import any shared package
(`docs/ARCHITECTURE.md:31`), which the Settings tab needs — it mounts screens
from `auth`, `account` and `backup` at once, and **no other package is permitted
to import all three.** That alone rules out putting it anywhere else, and FR-03
sharpens it: the auth stack adds `auth`'s three screens to the same requirement.

**NFR-02 is satisfied by this placement, not despite it.** `security` may import
only `utils` (`docs/ARCHITECTURE.md:24`), so no navigation dependency can reach
it by any path ESLint permits; and the portable-path guard computes its file set
by walking imports *out from* `PortableCryptoService` and `recoveryCodes`
(`check-architecture.mjs:97-153`), so a dependency added to `core` — which
`security` does not import — cannot enter that set.

**What `core` gains:**

| New | Kind | Tested by |
| --- | --- | --- |
| `src/shell/routes.ts` | types + `resolveRouteTable` (pure) | unit, no harness |
| `src/shell/signOutPlan.ts` | pure ordered plan | unit, no harness |
| `src/shell/AppShell.tsx` | `NavigationContainer`, tabs, stacks | mount harness |
| `src/shell/AuthStack.tsx` | signed-out stack: login → signup / reset / verify-device (FR-03) | mount harness |
| `src/shell/SettingsRoute.tsx` | assembles `SettingsScreen` sections | mount harness |
| `src/shell/useSignOut.ts` | hook running `signOutPlan` | mount harness |
| `src/shell/createApp.tsx` | the bootstrap factory (FR-07, NFR-01) | unit (fail-closed) + mount harness |
| `AppCore` | `clearDataKeyFor?` prop; memo keyed on `[user?.id]` | unit + guard |

**Dependencies**, added to `packages/core/package.json` as **peerDependencies**
(so exactly one copy exists — React Navigation's context and both native modules
break with two): `@react-navigation/native`, `@react-navigation/native-stack`,
`@react-navigation/bottom-tabs`, `react-native-screens`,
`react-native-safe-area-context`. Installed as real dependencies in each of the
three apps at the Expo-pinned versions (facts 2, 3).

**A new `@platform/shell` package is rejected**, and the cost is concrete: a new
row in CLAUDE.md's dependency table, a new entry in `eslint.config.mjs`'s
`DEPENDENCIES`, a new README, a new block in `docs/ARCHITECTURE.md`, and a
`packages/<pkg>/{src/index.ts,README.md,package.json}` triple that
`check-architecture.mjs:723-729` requires — all at first use, for a module whose
only consumer is `AppCore`, in the same package. **The trigger to split later:**
a second navigator shape (a drawer, or a web router) landing beside this one.

### Q8 — Migration: **dependencies simultaneously, screens one at a time**

The distinction is the decision, and it is forced by how bundling works:
`packages/core/src/index.ts` re-exports everything, so **every app pulls
`AppShell` and `createApp` into its bundle the moment they exist**, whether or
not it renders them. The five packages of §Q7 therefore land in all three apps in
one commit. There is no arrangement in which only the migrated app needs them.

**The migration itself is additive and therefore staged.** `AppCore`'s
`children` stays `ReactNode` and `createApp` is a new export beside it, not a
replacement for anything. An app passing a screen keeps working exactly as today;
an app whose entry file calls `createApp` gets the shell. No existing signature
changes, so CLAUDE.md rule 12 (breaking changes update all apps in one change) is
not triggered — by design, because triggering it would force all three apps to
migrate in a single commit and make the first shell change the largest one.

**This is what NFR-04 asks for**, and it is worth being precise about what "keep
working" means: each app's `App.tsx` is *absorbed* by `createApp` rather than
edited in place, so at any commit an app is either fully on the old path or
fully on the new one, never half-migrated. Net Worth's persistence is untouched
throughout — `src/data/`, the document shapes and `firestore.rules` appear in no
diff in this sequence.

Order: **Expense (9C-7) → Investment (9C-8) → Net Worth (9C-9).** Expense first because it is the
smallest (`App.tsx` 113 lines, one screen) and because Expense and Investment
differ by 23 lines of which zero are platform logic (9A Q2) — so Investment's
migration is a near-copy of a reviewed one. Net Worth last because it is the only
app with `src/composition/` and `src/config/`, and the only one that is actually
multi-screen (fact 4), so it is where the route model gets its real test.

**What breaks:**

- Nothing in `apps/*` at migration time, by the additive design above. Each
  app's old `App.tsx` is deleted in its own migration commit, once its entry file
  calls `createApp`.
- **`apps/networth/tests/backupWiring.test.ts` will need updating.** It asserts
  wiring by reading source text (9A Q9); moving backup into the Settings tab
  changes the text it reads. This is the one existing test the migration
  invalidates, and it must be re-pointed rather than deleted.
- **`app.json`** needs no change: neither native module requires config, and both
  are autolinked.
- **The Hermes CI job is unaffected and that is a gap**, not a relief: it builds
  `tools/x1-selftest` (fact 8), so `react-native-screens` will not be exercised
  on a real device by anything in CI. The tier-2 harness renders through
  `react-native-web`, so it does not close the gap either. Nothing in the lock
  requires closing it — AC-06 asks that components render under test, not on a
  device — so it is recorded as a standing risk rather than added to scope.

### Q9 — Test harness: **two tiers, and the first tier carries the weight**

**Tier 1 — pure decision functions, in the existing Vitest. No new dependency.**
This is the `dataKeyStep`/`pairingStep` pattern (`packages/core/README.md:102-105`;
`dataKeyStep.ts:5-11` states the reasoning), applied deliberately so that
**everything security-significant is testable without mounting anything**:

- `resolveRouteTable(table, capabilities)` — that `Settings` is always appended;
  that an app declaring `Settings` is rejected; that `backup`, `pair-device` and
  `sign-out` rows are absent when the corresponding capability is absent; that
  duplicate names and a dangling `within` throw.
- `signOutPlan(userId)` — that the clear precedes the sign-out, and that a plan
  with no `userId` is refusable rather than a clear of `''` (which
  `custodyAddressFor` already rejects, `custodyAddress.ts:50-52`).
- The existing `dataKeyStep` and `pairingStep` suites are unchanged.

**Tier 2 — a mount harness, for the three things tier 1 cannot express.** Named:
**Vitest + `jsdom` + `@testing-library/react`, with a `react-native` →
`react-native-web` alias**, as a second Vitest project config
(`vitest.shell.config.ts`) so the existing suites keep running with no
environment change. This is precisely the missing infrastructure the root
`README.md:132-135` names.

The three assertions that require it:

1. **The navigator does not mount while gated.** Render with a lifecycle
   reporting `locked`; assert no route component is in the tree.
2. **Gate order.** `AuthGate` outside `DataKeyGate` outside
   `EncryptedRepositoryProvider` outside `NavigationContainer`.
3. **Sign-out clears before it signs out.** Assert the observed call order on
   test doubles — the property F-05 turns on.

**Tier 3 — architecture guards, which already exist as a mechanism.** Additions
to `scripts/check-architecture.mjs`: that `AuthGate`'s lifecycle memo keys on
`[user?.id]` (§Q5); that `AppShell` is rendered inside
`EncryptedRepositoryProvider` and never above it; that no file under
`apps/*/src/screens/` imports `@react-navigation/*` directly, which would be an
app owning a navigator (fact 3).

**Rejected alternatives.** Jest + `jest-expo` + `@testing-library/react-native`
— the closest thing to a standard RN harness, and rejected because it means a
second test runner in a repo whose CI runs `pnpm turbo test` into Vitest, and
`turbo.json`'s `test: { dependsOn: ["^build"] }` would have to grow a second
task. `react-test-renderer` — no jsdom needed, but it is deprecated in React 19
and would be a dependency with a known end date. Snapshot-testing the navigator
tree — asserts shape, not behaviour, and would pass with the gates in the wrong
order.

**Honest limitation of tier 2:** it renders through `react-native-web`, and fact
2 puts web parity out of scope. So tier 2 proves *component composition*, not
platform behaviour. That is exactly why the security-significant decisions are in
tier 1 and the guards are in tier 3 — tier 2 is deliberately the thinnest layer,
covering only what genuinely needs a tree.

---

### Q10 — Which locked requirements cannot be met by this design

**None.** All seven FRs, four NFRs and six ACs are met. Three are met with a
qualification, stated here rather than buried in the section that decides them.

**FR-03 / AC-02 — `DeviceVerification` is reachable everywhere and functional
only where the service implements it.** The screen is a route in the auth stack
and a row in Settings, so it is navigable in all three apps. Its confirm action
succeeds against `InMemoryAuthService` (`packages/auth/src/services/InMemoryAuthService.ts:116-119`) — so it is functional
end-to-end in every preview composition, which is what AC-02's "in at least one
app" asks — and throws `DEVICE_VERIFICATION_UNAVAILABLE` against
`FirebaseAuthService` (`packages/firebase/src/services/FirebaseAuthService.ts:132-134`).
That is not a gap this design leaves: it is the interface's own documented
fail-closed contract (`packages/auth/src/types/auth.ts:28-33` — an implementation
without a trusted server *must* fail closed), and issuing the code needs a
trusted server, which CLAUDE.md rule 21 rules out while Spark is the target.
**Making it functional under Firebase is out of reach of any shell design.**

**NFR-01 / AC-01 — met at 21 lines, but only because two things moved.** The cap
is met with margin, and the margin is manufactured: `readEnvironment`, the
backend selection and the transport construction move out of Net Worth's entry
file into its composition module (§Q3). Nothing is deleted and nothing moves into
a package, but the count depends on that move, and a future entry-point
responsibility eats the margin. Recorded so a later gate does not read 21 as
comfortable.

**AC-06 — met for the shell, not retroactively for the platform.** "Components
render under test; the shell is not untested" is satisfied: the tier-2 harness
(§Q9) mounts `AppCore`, the gates and the navigator. It does not make the seven
platform screens component-tested; they become *reachable*, and the harness
asserts the routes exist and mount, not that each screen behaves. Extending
coverage to them is a natural follow-on and is not claimed here.

**Two locked items are met by explicitly doing nothing**, which is worth stating
so it is not mistaken for an oversight. The non-goals retire two of the first
pass's open questions: "any app's own feature screens" is why v1 carries no route
params (§Q3) — no platform screen takes an id, so the param machinery has no
caller — and "deep linking" is why there is no `linking` config and no
`expo-linking` dependency. `NavigationContainer` still resolves an initial URL if
the platform hands it one, which §Q4 notes as a consequence of gate placement;
that is a property falling out of the design, not a feature being built.

## Package impact

| Package | Change | Breaking |
| --- | --- | --- |
| `packages/core` | 7 new modules under `src/shell/` (adds `AuthStack.tsx` and `createApp.tsx`); `AppCore` gains an optional prop and a changed memo dependency; 5 new peer dependencies | No |
| `packages/auth` | `AuthProvider` cold-start fix (F-07) | No |
| `packages/account` | None — `SettingsScreen`, `ProfileScreen`, `DeleteAccount` are consumed as they are | No |
| `packages/backup` | None — but `BackupScreen` stops being dead code and becomes the `settings/backup` route; `BackupControls.tsx:19-21`'s comment needs rewording in 9D, not the component | No |
| `packages/security` | None. **NFR-02 restated:** `security` may import only `utils`, so no navigation dependency can reach it; and the portable-path guard walks *out from* `PortableCryptoService` and `recoveryCodes`, so adding to `core` cannot enter its transitive set | No |
| `apps/*` (all three) | 5 new dependencies at Expo-pinned versions; a new entry file under 25 lines; `App.tsx` and its three per-render constructions absorbed by `createApp`; a new `src/routes.ts` | No |
| `apps/networth` | `readEnvironment`, backend selection and transport construction move into `src/composition/services.ts`; `tests/backupWiring.test.ts` re-pointed. `src/data/`, document shapes and `firestore.rules` untouched (NFR-04) | Test only |
| `scripts/check-architecture.mjs` | 4 guards added (the three of §Q9 tier 3, plus "no `packages/` file imports an Expo module") | No |

---

## Rules this design lives inside

Checked deliberately, because the brief asks for BLOCKED if one must change.
**None must change**, including under the supplied lock — the two clauses most
likely to force one, NFR-01's line cap and FR-03's seventh screen, are met by
injecting platform modules (§Q3) and by accepting the interface's own
fail-closed contract (§Q10) rather than by relaxing anything.

| Rule | Bearing | Status |
| --- | --- | --- |
| CLAUDE.md 14 — never rely on navigation restrictions for security | Decides Q4 | Satisfied: gates wrap, no guard |
| CLAUDE.md 10 / 22 — never weaken lint or architecture enforcement | Q5, Q9 tier 3 add guards | Satisfied: additions only |
| CLAUDE.md 12 — breaking changes update all apps together | Q8 | Avoided: additive |
| CLAUDE.md "no new framework … without explaining why the existing stack is insufficient" | Q1 | Explanation given (back handling, Android back, deep links, state restoration, tab state) |
| `BANNED_DEPS` (`check-architecture.mjs:34`) | Q5 | Satisfied: no redux/mobx |
| ARCHITECTURE.md:19 — build app-specific first | Q7 | Addressed, with the reason it does not apply |
| ARCHITECTURE.md:465 — custody is deliberately narrow | Q6 F-05 | Satisfied: no widening of `DataKeyLifecycle` |
| CLAUDE.md 21 — no backend beyond Spark; document the limitation instead | Q10, FR-03 | Satisfied: `DeviceVerification` is reachable, and the reason it cannot succeed under Firebase is documented rather than worked around |
| "shared packages never reach for a platform module" (`apps/expense/index.tsx:31-32`) | Q3 `createApp` | Satisfied: `AppPlatform` is a parameter; a guard is added so it stays one |

---

## Required documentation changes

To be made by the documentation gate (9D), not now:

- `CLAUDE.md` — the navigator in the Stack section, with the "why the existing
  stack is insufficient" note; the shell in the Layout description of `core`.
- `docs/ARCHITECTURE.md` — gate placement as a stated invariant (gates wrap the
  navigator; it is not a routing guard) and the reason.
- `packages/core/README.md` — the shell, the route contract, `createApp`, the
  settings tab ownership, and F-09's status change from "latent" to "latent,
  guarded".
- `packages/backup/README.md` and `BackupControls.tsx:19-21` — the comment says
  `BackupScreen` is not used because it "belongs to an application with
  navigation to route to it". That condition is now met, so the comment must be
  reworded to describe the two hosts rather than an absence.
- `packages/auth/README.md` — that `SignupScreen`, `PasswordResetScreen` and
  `DeviceVerification` are reachable, and that the last one cannot succeed
  against `FirebaseAuthService` by design.
- `packages/security/README.md` — F-05's status once the clear ships.
- `packages/auth/README.md` — F-07's status once the cold-start fix ships.
- `docs/adr/` — the navigator choice. **Note:** `docs/adr/` does not exist in
  this repository; whether ADRs are kept here is an open question.

---

## Open questions

Resolved by the lock, and struck: *the requirement lock* (supplied), *route
params* (the non-goal "any app's own feature screens" settles it — v1 carries
none), and *deep linking* (a non-goal).

**Resolved by product ruling, and struck:**

- ~~**Route restoration across a lock.**~~ **Ruled: always home** (§Q4). After an
  unlock the shell opens on the declared `home`; route position is not persisted
  across a locked key, because the persisted value would have to sit outside the
  encrypted boundary, and home is a correct destination.
- ~~**F-06 and account deletion.**~~ **Ruled: hide the row** (§Q2).
  `DeleteAccount` stays a route, so FR-03 holds; the Settings row is omitted
  unless a deletion flow is injected. Shipping a reachable button with no effect
  was the rejected alternative. F-06 closes in its own gate afterwards.

What remains:

1. **`docs/adr/` does not exist in this repository.** The release flow naming it
   belongs to a different repo, so the navigator ADR needs a home before 9D can
   write it.
2. **Concurrent rendering** and the latest-ref pattern (§Q5). Safe in this tree
   today; revisit if a concurrent feature is ever enabled.
3. **AC-05's cold start, in test.** The criterion says "verified after a cold
   start". §Q9 satisfies it at the custody level — clear, construct a fresh
   `KeyCustody` over the same storage, assert `absent` — which is a new process's
   view of the store without being a new process. Whether that reading is
   accepted, or whether the Hermes job should carry a device-level check, is for
   the implementation gate to confirm.

---

## Implementation gate sequence

Described, not implemented. **T** marks a gate whose tests precede its
implementation. The lock added two gates: **9C-4** (the auth stack, for FR-03)
and **9C-5** (`createApp`, for FR-07/NFR-01).

| Gate | Scope | Requirements | Tests first? |
| --- | --- | --- | --- |
| **9C-0** | F-07: `AuthProvider` cold start. `packages/auth` only, no shell code. | — | **T** — a failing test reproducing the `null` overwrite, before the fix. |
| **9C-1** | Pure core: `routes.ts`, `signOutPlan.ts`. No JSX, no dependency. | FR-01, FR-02 | **T** — the full tier-1 suite, red, before either module exists. |
| **9C-2** | Dependencies: 5 packages into `packages/core` (peer) and all three apps (real). Nothing rendered yet. | NFR-02 | No — verified by `pnpm turbo build test lint` staying green and the lockfile diff. |
| **9C-3** | `AppShell.tsx`, `SettingsRoute.tsx`, `useSignOut.ts`; `AppCore` gains `clearDataKeyFor` and the fixed memo; the three architecture guards. | FR-04, FR-05, FR-06, NFR-03 | **T** — guards added and shown failing against the current tree before the memo is changed. |
| **9C-4** | The auth stack: `LoginScreen` → `signup` / `reset` / `verify-device`, replacing the bare `signedOut` element. | FR-03 | **T** — the route table assertions extended before the stack exists. |
| **9C-5** | `createApp`, with `AppPlatform` injected. No app migrated yet. | FR-07, NFR-01 | **T** — a bootstrap test asserting fail-closed on both `BootstrapFailure` values. |
| **9C-6** | The tier-2 mount harness and its assertions. | AC-06, AC-03, AC-04 | **T** — by definition. |
| **9C-7** | Expense migration: new entry file, three per-render constructions removed. | AC-01 | Existing suites must stay green. |
| **9C-8** | Investment migration. | AC-01 | As above. |
| **9C-9** | Net Worth migration; `readEnvironment`/backend selection/transport moved behind `resolveServices`; `backupWiring.test.ts` re-pointed. | AC-01, NFR-04 | **T** — the re-pointed assertion written before the move. |
| **9D** | Documentation reconciliation across the four layers. | — | n/a |

### Acceptance criteria

**9C-0** — A test fails on `main` demonstrating that a resolved `getCurrentUser()`
can overwrite a user delivered by `onAuthStateChanged`; it passes after; no other
`packages/auth` test changes.

**9C-1** *(FR-01, FR-02)* — `resolveRouteTable` appends `Settings` in every case;
rejects an app declaring `Settings`, a duplicate name, an empty tab list, a
dangling `within` and a `home` naming no tab; defaults `home` to the first tab.
**All four conditional rows are covered, each in both directions:** `backup`,
`pair-device`, `sign-out` and `delete-account` are present when their capability
is true and omitted when it is false, asserted one capability at a time so a row
cannot be gated on the wrong flag. **`settings/delete` is in `details` whichever
way `deleteAccountAvailable` falls** — the ruling in §Q2 is that the row is
hidden, not the route, and a test that only checked the row would pass if the
route disappeared with it. `signOutPlan` orders the clear strictly before the
sign-out and refuses an empty identity. Zero new dependencies in this gate.

**9C-2** *(NFR-02)* — `pnpm turbo build test lint` green, which includes the
portable-path guard; `pnpm-lock.yaml` shows the five packages at the Expo-pinned
versions (`react-native-screens ~4.4.0`, `react-native-safe-area-context
4.12.0`); no `@react-navigation/*` or `react-native-screens` entry appears in
`packages/security/package.json`; no app renders a navigator yet.

**9C-3** *(FR-05, FR-06, NFR-03)* — The memo guard fails against the unmodified
`AuthGate` and passes after. `AppShell` is rendered only inside
`EncryptedRepositoryProvider`. No `apps/*/src/screens/**` file imports
`@react-navigation/*`. `AppCore` with no `clearDataKeyFor` yields
`signOutAvailable: false`, and the Settings tab then has no sign-out row.

**9C-4** *(FR-03)* — `signup`, `reset` and `verify-device` are routes in the
signed-out stack; `LoginScreen`'s `onCreateAccount` and `onForgotPassword` are
wired to pushes rather than `() => undefined`; the signed-out subtree renders no
`EncryptedRepositoryProvider`, asserted structurally.

**9C-5** *(FR-07, NFR-01)* — `createApp` fails closed on a rejected `services`
resolver and on a failed secure-storage bootstrap, rendering the unavailable copy
and nothing else in both cases; no file under `packages/` imports an Expo module
(the existing zero-match property, asserted in `check-architecture.mjs` so it
cannot regress).

**9C-6** *(AC-03, AC-04, AC-06)* — With a lifecycle reporting `locked`, no route
component is in the rendered tree (FR-05). The gate order is asserted
structurally. Hardware back from a nested route pops to its parent and does not
exit. A state change above `AppCore` does not construct a second
`DataKeyLifecycle` — the memo identity is stable across the re-render. Sign-out
calls `clearDataKeyFor` before `signOut`, proven by call order.

**9C-7/8/9** *(AC-01, AC-02, AC-05, NFR-04)* — Each app builds; each entry file
is **under 25 lines**, asserted mechanically rather than by eye; existing suites
pass unchanged (except Net Worth's `backupWiring.test.ts`, re-pointed in 9C-9);
every one of the seven platform screens is reachable by navigation in at least
one app (AC-02). **AC-05:** after sign-out, a freshly constructed `KeyCustody`
over the same storage reports `absent` for that identity, and the address it
looks at equals `custodyAddressFor(userId)` — the derived address, never a list
of what this process wrote (F-08). **NFR-04:** `apps/networth/src/data/`,
the Firestore document shapes and `firestore.rules` are unchanged in the diff.
The Hermes job passes at both API levels.

---

## Scope exclusions

Named so a later gate does not read them as omissions. **Two exclusions from the
first pass are struck**, because the lock puts them in scope.

1. **Route params** (§Q3) — no destination takes an id in v1. Now positively
   justified by the non-goal "any app's own feature screens", rather than
   deferred.
2. **Deep-link URL scheme.** A non-goal. No `linking` config, no `expo-linking`,
   no registered scheme; `NavigationContainer` still resolves an initial URL if
   the platform hands it one, which is a consequence of §Q4 rather than a feature.
3. **Web.** A non-goal, and fact 2. `react-native-web` appears only in the tier-2
   test harness, never as a shipping target.
4. **Route restoration across a lock.** Ruled, not deferred: always home (§Q4).
5. **Wiring `deleteAccountFlow`.** `DeleteAccount` is *reachable*, which is what
   FR-03 requires; connecting `onDelete` to the flow is required by no clause and
   closes in its own gate. Until it is injected the Settings row is hidden rather
   than inert (§Q2).
6. **F-09's fix.** Deferred with a guard (§Q6).
7. ~~**`SignupScreen`, `PasswordResetScreen`, `DeviceVerification`.**~~ **Struck.**
   FR-03 and AC-02 put all seven screens in scope; they become the auth stack
   (§Q2, gate 9C-4).
8. **A drawer, a header search, or any second navigator shape.** The trigger for
   a `@platform/shell` package (§Q7), not a target now.
9. ~~**`BackupScreen`.**~~ **Struck.** FR-03 requires it reachable, and
   `BackupControls.tsx:19-21`'s own stated condition — an application with
   navigation to route to it — is now met. It becomes the `settings/backup`
   route; `BackupControls` stays exported for a host without navigation.
10. **Push notifications, per-app theming, and the platform message-map gap**
    (9A Q6's 45 uncovered codes). All three are non-goals in the lock, and the
    message-map gap in particular stays open and stays recorded.
11. **Component tests for the seven platform screens themselves.** AC-06 covers
    the shell; the harness asserts the routes mount, not that each screen behaves
    (§Q10).

---

GATE 9B RESULT: READY FOR IMPLEMENTATION
