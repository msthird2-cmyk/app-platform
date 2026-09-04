# Gate 9B — Application shell: design

Base `main` at `2d01967`. Design only: no production source, no tests, and no
change to CLAUDE.md, `docs/ARCHITECTURE.md`, the package READMEs or any
implementation-state table. Type and interface signatures appear below; no
function bodies and no patches.

---

## Status

**`GATE 9B RESULT: BLOCKED`** — on one missing input, not on a design problem.

The design is complete and is recorded in full below. Nine of the nine required
decisions are made, with rejected alternatives. What blocks the gate is that
**the requirement lock the brief calls "settled input" was not supplied and does
not exist in this repository.** Three of the ten questions are stated in terms of
it, and cannot be answered without inventing it:

- Q2 asks the route model to be justified "against FR-03 and AC-03".
- Q4 says gate placement "decides FR-05".
- Q10 asks "which locked requirements cannot be met by this design".

Searched: every `.md` in the working tree (15 files), every branch (21 local, 19
remote), and the full commit history. The tokens `FR-`, `AC-` and the phrase
"requirement lock" appear nowhere. The brief's instruction is *"Report a
contradiction rather than resolving it"*, and manufacturing plausible FR/AC text
in order to satisfy the questions would be resolving it.

**To unblock:** supply the requirement-lock text (FR-* and AC-* clauses). The
design below does not change; §Q2, §Q4 and §Q10 gain their justifications, and
the final line flips.

Nothing else blocks. In particular, **no rule in CLAUDE.md or
`docs/ARCHITECTURE.md` has to change** for this design — see
[Rules this design lives inside](#rules-this-design-lives-inside).

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

## The nine decisions

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
place to audit.

> **Cannot be justified against FR-03 and AC-03** — those clauses were not
> supplied. The justification above is against fact 4 and 9A Q3 only.

**Rejected alternatives.** A single stack with no tabs (cheapest, but Settings
then has to be reachable from every screen's header, which is a per-screen
obligation the shell cannot enforce). Tabs with no stacks (cannot express a
detail view; fact 4 fails). Settings as a modal rather than a tab (works, and
was close — rejected because a modal has no stable back-stack, and account
deletion and passphrase change are flows a user may need to leave and return to).

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
  readonly details?: readonly AppDetailDestination[];
  readonly modals?: readonly AppDestination[];
  /** Extra rows for the Settings tab, below the platform's own. */
  readonly settingsSections?: readonly SettingsSection[];
}

/** What the shell decides, as data — the `dataKeyStep` pattern (§Q9). */
export interface ShellCapabilities {
  readonly backupAvailable: boolean;   // a BackupTransport was injected
  readonly pairingAvailable: boolean;  // a PairingRelay was injected
  readonly signOutAvailable: boolean;  // a clearDataKeyFor was injected
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
 *  list, a `within` naming no tab, or an app trying to declare `Settings`. */
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
Route restoration across a lock is listed in [Open questions](#open-questions).

> **This is stated to decide FR-05, which was not supplied.** The reasoning above
> stands on hard rule 14 and on the tree as it exists.

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
to import all three.** That alone rules out putting it anywhere else.

**What `core` gains:**

| New | Kind | Tested by |
| --- | --- | --- |
| `src/shell/routes.ts` | types + `resolveRouteTable` (pure) | unit, no harness |
| `src/shell/signOutPlan.ts` | pure ordered plan | unit, no harness |
| `src/shell/AppShell.tsx` | `NavigationContainer`, tabs, stacks | mount harness |
| `src/shell/SettingsRoute.tsx` | assembles `SettingsScreen` sections | mount harness |
| `src/shell/useSignOut.ts` | hook running `signOutPlan` | mount harness |
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
`AppShell` into its bundle the moment it exists**, whether or not it renders it.
The five packages of §Q7 therefore land in all three apps in one commit. There is
no arrangement in which only the migrated app needs them.

**The migration itself is additive and therefore staged.** `AppCore`'s `children`
stays `ReactNode`. An app passing a screen keeps working exactly as today; an app
passing `<AppShell routes={…}/>` gets navigation. No signature changes, so
CLAUDE.md rule 12 (breaking changes update all apps in one change) is not
triggered — by design, because triggering it would force all three apps to
migrate in a single commit and make the first shell change the largest one.

Order: **Expense → Investment → Net Worth.** Expense first because it is the
smallest (`App.tsx` 113 lines, one screen) and because Expense and Investment
differ by 23 lines of which zero are platform logic (9A Q2) — so Investment's
migration is a near-copy of a reviewed one. Net Worth last because it is the only
app with `src/composition/` and `src/config/`, and the only one that is actually
multi-screen (fact 4), so it is where the route model gets its real test.

**What breaks:**

- Nothing in `apps/*` at migration time, by the additive design above.
- **`apps/networth/tests/backupWiring.test.ts` will need updating.** It asserts
  wiring by reading source text (9A Q9); moving backup into the Settings tab
  changes the text it reads. This is the one existing test the migration
  invalidates, and it must be re-pointed rather than deleted.
- **`app.json`** needs no change: neither native module requires config, and both
  are autolinked.
- **The Hermes CI job is unaffected and that is a gap**, not a relief: it builds
  `tools/x1-selftest` (fact 8), so `react-native-screens` will not be exercised
  on a real device by anything in CI. Listed as a risk and as an acceptance
  criterion for 9C-4.

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

## Package impact

| Package | Change | Breaking |
| --- | --- | --- |
| `packages/core` | 5 new modules under `src/shell/`; `AppCore` gains an optional prop and a changed memo dependency; 5 new peer dependencies | No |
| `packages/auth` | `AuthProvider` cold-start fix (F-07) | No |
| `packages/account` | None — `SettingsScreen`, `ProfileScreen`, `DeleteAccount` are consumed as they are | No |
| `packages/backup` | None — `BackupControls` is consumed; `BackupScreen` stays superseded (`BackupControls.tsx:19`) | No |
| `packages/security` | None | No |
| `apps/*` (all three) | 5 new dependencies at Expo-pinned versions; the three per-render constructions hoisted to module scope; `clearDataKeyFor` wired | No |
| `apps/networth` | `tests/backupWiring.test.ts` re-pointed | Test only |
| `scripts/check-architecture.mjs` | 3 guards added | No |

---

## Rules this design lives inside

Checked deliberately, because the brief asks for BLOCKED if one must change.
**None must change.**

| Rule | Bearing | Status |
| --- | --- | --- |
| CLAUDE.md 14 — never rely on navigation restrictions for security | Decides Q4 | Satisfied: gates wrap, no guard |
| CLAUDE.md 10 / 22 — never weaken lint or architecture enforcement | Q5, Q9 tier 3 add guards | Satisfied: additions only |
| CLAUDE.md 12 — breaking changes update all apps together | Q8 | Avoided: additive |
| CLAUDE.md "no new framework … without explaining why the existing stack is insufficient" | Q1 | Explanation given (back handling, Android back, deep links, state restoration, tab state) |
| `BANNED_DEPS` (`check-architecture.mjs:34`) | Q5 | Satisfied: no redux/mobx |
| ARCHITECTURE.md:19 — build app-specific first | Q7 | Addressed, with the reason it does not apply |
| ARCHITECTURE.md:465 — custody is deliberately narrow | Q6 F-05 | Satisfied: no widening of `DataKeyLifecycle` |

---

## Required documentation changes

To be made by the documentation gate (9D), not now:

- `CLAUDE.md` — the navigator in the Stack section, with the "why the existing
  stack is insufficient" note; the shell in the Layout description of `core`.
- `docs/ARCHITECTURE.md` — gate placement as a stated invariant (gates wrap the
  navigator; it is not a routing guard) and the reason.
- `packages/core/README.md` — the shell, the route contract, the settings tab
  ownership, and F-09's status change from "latent" to "latent, guarded".
- `packages/security/README.md` — F-05's status once the clear ships.
- `packages/auth/README.md` — F-07's status once the cold-start fix ships.
- `docs/adr/` — the navigator choice. **Note:** `docs/adr/` does not exist in
  this repository; whether ADRs are kept here is an open question.

---

## Open questions

1. **The requirement lock.** The blocker. FR-* and AC-* text.
2. **Route params.** v1 has none (§Q3). Adding them later is a breaking change to
   `AppDestination`. The lock should decide whether a detail screen needs an id
   in the first release.
3. **Route restoration across a lock.** Wrapping means a passphrase-protected
   user returns to the first tab, not their route (§Q4). Restoring it means
   persisting a route name across a locked key — cheap, and not obviously
   something to do without deciding whether a route name is sensitive.
4. **`docs/adr/`** does not exist here; the release flow that names it belongs to
   a different repository.
5. **Concurrent rendering** and the latest-ref pattern (§Q5).
6. **Sign-out and F-06.** `deleteAccountFlow` has no caller
   (`packages/account/README.md:57-63`); the Settings tab is where its button
   would go. Out of scope here, but this gate creates the place for it.

---

## Implementation gate sequence

Described, not implemented. **T** marks a gate whose tests precede its
implementation.

| Gate | Scope | Tests first? |
| --- | --- | --- |
| **9C-0** | F-07: `AuthProvider` cold start. `packages/auth` only, no shell code. | **T** — a failing test reproducing the `null` overwrite, before the fix. |
| **9C-1** | Pure core: `routes.ts`, `signOutPlan.ts`. No JSX, no dependency. | **T** — the full tier-1 suite, red, before either module exists. |
| **9C-2** | Dependencies: 5 packages into `packages/core` (peer) and all three apps (real). Nothing rendered yet. | No — verified by `pnpm turbo build test lint` staying green and the lockfile diff. |
| **9C-3** | `AppShell.tsx`, `SettingsRoute.tsx`, `useSignOut.ts`; `AppCore` gains `clearDataKeyFor` and the fixed memo; the three architecture guards. | **T** — guards added and shown failing against the current tree before the memo is changed. |
| **9C-4** | The tier-2 mount harness and its three assertions. | **T** — by definition. |
| **9C-5** | Expense migration; the three per-render constructions hoisted. | Existing suites must stay green. |
| **9C-6** | Investment migration. | As above. |
| **9C-7** | Net Worth migration; `backupWiring.test.ts` re-pointed. | **T** — the re-pointed assertion written before the move. |
| **9D** | Documentation reconciliation across the four layers. | n/a |

### Acceptance criteria

**9C-0** — A test fails on `main` demonstrating that a resolved `getCurrentUser()`
can overwrite a user delivered by `onAuthStateChanged`; it passes after; no other
`packages/auth` test changes.

**9C-1** — `resolveRouteTable` appends `Settings` in every case; rejects an app
declaring `Settings`, a duplicate name, an empty tab list and a dangling
`within`; omits `backup`, `pair-device` and `sign-out` when the capability is
absent. `signOutPlan` orders the clear strictly before the sign-out and refuses
an empty identity. Zero new dependencies in this gate.

**9C-2** — `pnpm turbo build test lint` green; `pnpm-lock.yaml` shows the five
packages at the Expo-pinned versions (`react-native-screens ~4.4.0`,
`react-native-safe-area-context 4.12.0`); no app renders a navigator yet.

**9C-3** — The memo guard fails against the unmodified `AuthGate` and passes
after. `AppShell` is rendered only inside `EncryptedRepositoryProvider`. No
`apps/*/src/screens/**` file imports `@react-navigation/*`. `AppCore` with no
`clearDataKeyFor` yields `signOutAvailable: false`.

**9C-4** — With a lifecycle reporting `locked`, no route component is in the
rendered tree. The gate order is asserted structurally. Sign-out calls
`clearDataKeyFor` before `signOut`, proven by call order, and the address
cleared equals `custodyAddressFor(userId)`.

**9C-5/6/7** — Each app builds, its existing tests pass unchanged (except Net
Worth's `backupWiring.test.ts`, re-pointed in 9C-7), Settings is reachable, and
sign-out leaves no custody record at the derived address. The Hermes job passes
at both API levels.

---

## Scope exclusions

Named so a later gate does not read them as omissions:

1. **Route params** (§Q3) — no destination takes an id in v1.
2. **Deep-link URL scheme.** `NavigationContainer` handles a link if one arrives;
   no `linking` config, no `expo-linking`, no registered scheme.
3. **Web.** Fact 2. `react-native-web` appears only in the tier-2 test harness,
   never as a shipping target.
4. **Route restoration across a lock** (open question 3).
5. **F-06 / account deletion.** The Settings tab creates the place for the
   button; wiring `deleteAccountFlow` is not this gate.
6. **F-09's fix.** Deferred with a guard (§Q6).
7. **`SignupScreen`, `PasswordResetScreen`, `DeviceVerification`.** The shell
   makes Settings reachable, which unblocks `ProfileScreen`, `SettingsScreen`,
   `DeleteAccount` and backup. The three auth screens hang off `LoginScreen`'s
   stubbed `onCreateAccount`/`onForgotPassword` (9A Q3) — a signed-out flow,
   below the auth gate, and a separate piece of work.
8. **A drawer, a header search, or any second navigator shape.** The trigger for
   a `@platform/shell` package (§Q7), not a target now.
9. **`BackupScreen`.** Stays superseded by `BackupControls`
   (`BackupControls.tsx:19`); the Settings tab mounts the control, not the screen.

---

GATE 9B RESULT: BLOCKED
