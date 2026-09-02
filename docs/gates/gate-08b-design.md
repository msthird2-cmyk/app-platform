# Gate 8B — Per-user custody isolation: design

## 1. Gate 8B status

Design only. No production source, test, `CLAUDE.md`, `docs/ARCHITECTURE.md`,
package README or implementation-state table is modified by this gate.

Branch note: this branch is cut from `gate-08a-audit` (`cfa2fa2`) rather than
from `b7a6d0b` directly. `b7a6d0b` is an ancestor, so the stated base holds, but
the Gate 8A audit, the Gate 8A.1 facts and the reproduction tests are all
required reading for this gate and exist only on that branch. Branching from the
bare base would have made them unreadable from the working tree and would have
split the gate record across two unmergeable lines.

**Result: see the final line.**

## 2. Problem statement

Custody is addressed by one process-wide slot, `platform.dek.v1`
(`packages/security/src/keyCustody.ts:96`), which all three applications use
unmodified. The authenticated identity reaches the encryption context and never
reaches the storage namespace. A second user signing in on a device therefore
reads the first user's custody record.

The task is the smallest change that makes a custody record belong to exactly one
authenticated identity, plus a defensible answer for the legacy records that
already exist without one.

## 3. Established facts

Facts 1–15 supplied with this gate are adopted as stated. Two require comment
because the repository speaks to them.

**Fact 14 — no real-user migration population.** The repository is consistent
with this and adds supporting evidence rather than contradicting it:

- The only workflow is `.github/workflows/android-runtime.yml`; its APK step
  ends at `actions/upload-artifact@v4` (`:282`). There is **no release,
  store, or EAS publication step anywhere**.
- `apps/networth/app.json:5` and `apps/networth/package.json:3` both report
  version `0.1.0`.
- No distribution channel exists in the repository.

What the repository **cannot** establish is whether any build was distributed by
hand outside it. That is recorded in §21 and the design does not depend on the
answer: every path below is safe whether or not such installs exist.

This matters because `docs/ARCHITECTURE.md:660` is the governing rule:

> Before first real user data, security changes are code/config changes. After
> real data exists, changes to recovery-code hashing, encryption envelope/KDF,
> sync metadata or Security Rules may require migrations.

The design therefore does not owe a migration to a population that is not
established. It nonetheless specifies safe legacy behaviour, because "no
established population" is not the same as "provably nobody".

**Fact 11 — anonymous auth.** Confirmed absent at every call site by Gate 8A.1
Q3. The design assumes every custody owner is an authenticated identity with a
stable `userId` for the duration of a session, and nothing more.

## 4. Security invariants

Numbered for the implementation gate to prove.

- **G8-SEC-01 — Identity boundary.** A custody record belongs to exactly one
  authenticated `userId`. The storage address of a custody record is a total
  function of that `userId`.
- **G8-SEC-02 — No cross-user return.** No DEK stored under identity A is ever
  returned to a session authenticated as B, for any A ≠ B, through any public
  API of `packages/security`.
- **G8-SEC-03 — No custody without identity.** It is not possible to construct a
  custody object without supplying an owner identity. This is a type-level
  property, not a caller convention.
- **G8-SEC-04 — No ownerless adoption.** A custody record carrying no ownership
  evidence is never adopted into any user's session, under any circumstance,
  including when it is the only record on the device.
- **G8-SEC-05 — Proof precedes adoption.** A legacy record is adopted only after
  positive cryptographic proof that it belongs to the current identity. Absence
  of failure is not proof.
- **G8-SEC-06 — `status()` implies ownership.** `ready` means a key exists for
  *this* identity and is available. It never means "a key exists on this device".
- **G8-SEC-07 — Export requires owned custody.** `exportForPairing()` may export
  only a DEK read from the current identity's own custody address.
- **G8-SEC-08 — Failure is not evidence.** No decision is taken on the basis of a
  failed unwrap, because failure is deliberately indistinguishable across wrong
  identity, wrong passphrase and tampering.
- **G8-SEC-09 — Ambiguous custody is preserved, not destroyed.** A record whose
  ownership is unproven is never deleted, on the grounds that deletion is not
  required for security once it is unreachable.

Answering the gate's explicit questions against these: when A signs out and B
signs in, it must be impossible for B to read, unlock, export, pair, or recover
using A's DEK (SEC-02, SEC-07). No DEK of A's may ever reach B's session
(SEC-02). Where no ownership evidence exists, the record is ignored — not
adopted, not deleted (SEC-04, SEC-09). `status()` must report on this identity's
custody only (SEC-06). `exportForPairing()` must require that the key came from
this identity's own address (SEC-07).

## 5. Threat model

**Assets.** In priority order: the DEK (real key material, per fact 10); the
records it protects; the recovery escrow; the passphrase, which is never stored.

**Attacker.** The first-class case is not a conventional attacker. It is a
**legitimate second user of a shared device**, using only public application
APIs, signed in as themselves. They have no filesystem or keystore access — if
they did, the namespace would provide nothing at all, since a keystore-level
adversary reads any slot regardless of its name.

**Trust boundaries.** The authenticated identity is the boundary. Everything
inside a session is trusted with that identity's key and nothing else. The
device is *not* a trust boundary — this is precisely the assumption the current
code makes and the defect it produces.

**Defended.** Cross-user DEK read, adoption, export, and pairing propagation via
public APIs. Silent association of an ownerless key with the wrong account.

**Deliberately undefended.** An attacker with keystore or filesystem access — the
namespace is a correctness mechanism, not a confidentiality one, and this design
does not claim otherwise. A compromised OS. An attacker who already holds the
device unlocked with the app open, which Gate 7 also declined to defend. Records
already written by a second user under an inherited key: §16 states plainly why
these cannot be preserved.

**Which layer is load-bearing.** For the *unprotected* v1 record, nothing is —
the AAD binds records, not the key, so a second user receives real key material
(fact 10). The namespace is the only defence and is therefore load-bearing. For
the *v2* record the AAD is already load-bearing and the namespace is defence in
depth. This asymmetry is the reason the namespace is required rather than
optional: the case where it does all the work is the default case.

## 6. Current-state summary

Established by Gate 8A; not re-derived. One global slot; identity in the
encryption context only; `status()` returns `ready` on `present` without
consulting ownership or escrow (`dataKeyLifecycle.ts:211`); `exportForPairing`
requires only `present` or `protected` (`:351`); `custody.clear()` has no
production caller; deletion flow unwired.

## 7. Target architecture

**Custody is addressed by owner.** `createKeyCustody` takes a required owner
identity and derives its own address. The `storageKey` option is withdrawn, so
there is exactly one way to address a slot and no way to construct custody
without an identity (SEC-03).

**Address form.**

```
platform.dek.v2.<lowercase hex of SHA-256(owner identity)>
```

Decisions embedded in that, each with its rejected alternatives:

- **Hashed, not raw.** Chosen for **charset safety, not secrecy** — stated
  explicitly because the instruction warns against choosing what merely sounds
  secure. `expo-secure-store@14.0.1` rejects any key outside
  `[A-Za-z0-9._-]` (`SecureStore.js:148`), and Gate 8A.1 OQ-3 leaves the
  Firebase UID charset unestablished. Hashing makes the address valid for **any**
  identity string, including one from a future provider. It provides no
  confidentiality: an adversary who can enumerate the keystore has already
  defeated everything this mechanism does.
  *Rejected — raw uid:* depends on an unestablished charset guarantee, and a
  disallowed character would surface as a storage exception deep beneath the
  security layer.
  *Rejected — base64 of the digest:* `+`, `/` and `=` are outside the permitted
  set. Base64url would work but needs a new encoder with padding rules; hex is
  shorter to specify and has no edge cases.
- **Deterministic, from the identity alone.**
  *Rejected — HMAC under a device-held secret:* the address would change whenever
  that secret is lost. On iOS the Keychain survives app deletion, so a
  reinstall would orphan a slot whose owner could otherwise still reach it. A
  non-deterministic namespace converts a recoverable state into an unrecoverable
  one, which is a worse failure than the one it prevents.
- **Versioned prefix `v2`.** The address, not the envelope, carries the scheme
  version, so a future re-namespacing is a new prefix rather than a reader
  change. `v1` remains exactly what it is today and is never written again.
- **Full 256-bit digest.** No length limit was found for either backend; if one
  emerges, truncation to 128 bits is sufficient for the handful of accounts a
  device holds. Recorded in §21.

`sha256` from `@noble/hashes/sha2.js` is already a portable-path dependency
(`PortableCryptoService.ts:3`, `KeyAgreement.ts:3`) and is already exercised on
Hermes by the X-1 self-test, so this adds no dependency and no new runtime risk.
A small hex encoder is required; `packages/security/src/crypto/` has `base64`
and `utf8` but no hex today.

**Legacy addressing is quarantined.** The `v1` constant survives in exactly one
place: a read-only legacy reader used solely by the claim path in §9. It cannot
write, and no general-purpose escape hatch replaces `storageKey`.

**Collisions.** Two distinct identities collide only on a SHA-256 collision.
Deterministic derivation means one identity always resolves to one address, so
self-collision across restarts is impossible by construction.

**Sign-out and account switch.** No change is required. `AppCore.tsx:80-83`
already rebuilds the lifecycle per `user.id` and nulls it when signed out; with
an owner-addressed custody the new lifecycle simply resolves a different
address. The in-memory opened DEK already dies with the closure (Gate 8A §3).

## 8. Ownership-proof analysis

| Mechanism | Evidence | Positive proof? | v1 | v2 | New recovery path? | User interaction | New assumption |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Slot contents | none — `{v:1,k}` carries no identity | No | ✗ | n/a | No | None | — |
| "First user after upgrade" | none; a guess | No | ✗ | ✗ | No | None | Would assume the device has one user — false by construction |
| v2 unwrap under current uid | AAD binds `uid`; success means the wrapper was created for this identity | **Yes** | ✗ | ✓ | No — it is Gate 7's mechanism | Passphrase | None |
| Recovery code → escrow | escrow is per-uid server-side, AAD-bound; opening it yields this identity's DEK | **Yes** | ✓ indirectly | ✓ indirectly | No — it is Gate 3's mechanism | Recovery code | None |
| Firestore rules | authorize server documents, not local slots (fact 12) | No | ✗ | ✗ | No | None | — |
| Failed unwrap | ambiguous by design (fact 6) | No — SEC-08 | ✗ | ✗ | No | Passphrase | Would assume failure implies non-ownership — false |

**There is no mechanism that proves ownership of a v1 record.** Stated
explicitly, as required. The v1 envelope contains no ownership evidence and none
can be manufactured after the fact.

The recovery row deserves precision, because it resolves the migration without
proving anything about the *record*. Opening identity U's escrow with U's
recovery code yields U's DEK directly. That DEK can then be written to U's own
namespaced address. **The legacy record is not needed and its ownership is never
in question** — the key arrives from the escrow, not from the slot. This is the
existing Gate 3 path, unchanged, and it is why no new recovery mechanism is
introduced (§14).

## 9. Legacy v1 migration design

The five states the gate asks for, plus interruption.

**A — legacy v1 exists and the current user can prove ownership.**
This state is empty for v1, and saying so is the design. No evidence exists
(§8). The user is not asked to prove anything about the slot; they take path B.

**B — legacy v1 exists and ownership cannot be proven.**
The record is **ignored**: not read into the session, not adopted, not deleted
(SEC-04, SEC-09). The user's own address is consulted, finds nothing, and the
existing absent-custody logic runs unchanged — `needs-recovery` if their escrow
exists, `needs-setup` if it does not (`dataKeyLifecycle.ts:226`).

For every user who completed `initialize()`, an escrow is **guaranteed** (Gate
8A.1 Q2, path 1: escrow is saved at `:315` before the slot at `:316`). Those
users therefore land on `needs-recovery`, enter their recovery code, and their
DEK is written to their own address. Same key, same records, no ownership
question asked. **This is the migration for v1, and it is entirely existing
machinery.**

**C — legacy v1 exists and another legitimate user signs in.**
Identical to B, and that is the point: the design has no branch that
distinguishes "the original owner" from "somebody else", because it cannot. Both
get their own address; neither is handed the legacy key.

**D — no legacy custody.**
Unchanged. `needs-setup` → `initialize()` → escrow then slot, now at the
namespaced address.

**E — v2 protected legacy custody.** See §10.

**F — interrupted migration.** See §15.

**Consequence stated plainly.** A user in the Gate 8A.1 defect class — one who
only ever read another identity's slot and never ran `initialize()` — has no
escrow, so they land on `needs-setup` and receive a **new** key. Records they
wrote under the inherited key become unreadable to them. This is not an
oversight: handing them the other user's DEK is exactly the failure being fixed
(fact 10). There is no safe alternative, and §16 records it as accepted data loss
rather than hiding it.

## 10. v2 migration design

A v2 legacy record **can** be proven (fact 5). Successful `unwrapDataKey` under
the current identity's `userId` proves the wrapper was created for that identity,
because the AAD binds `uid` (`envelope.ts:43`) and both crypto implementations
build the decrypt AAD from the stored envelope rather than device state
(`WebCryptoService.ts:125-127`, `PortableCryptoService.ts:150`) — so it holds
across reinstall and on a second device.

**Design: an optional, explicit claim.**

- Offered **only** when the current identity's own address is empty **and** a v2
  legacy record exists.
- Presented as a secondary option beside the normal path, never as a required
  step and never as a blocking prompt. A user who cannot satisfy it must be able
  to proceed to recovery or setup without dismissing an obstacle.
- On success: the DEK is written to the user's own address, preserving its
  protected form, and the legacy record may then be deleted (§16) because
  ownership is now proven.
- On failure: **nothing is inferred** (SEC-08). No state changes, no deletion,
  no lockout, and the normal paths remain available. The user is told the
  passphrase did not open it — not that the key is not theirs, which is not
  established.

**Why include it at all**, given priority 5. It is the only path for a user who
remembers their passphrase but has lost their recovery code, and without it that
user loses their records. The mechanism already exists and is already tested; the
increment is a state and a flow, not new cryptography. Priority 3 — preserve
legitimate access where ownership can actually be established — applies exactly
here and nowhere else in this design.

*Rejected — attempting the unwrap silently, without asking.* Impossible: unwrap
requires the passphrase (Gate 8A.1 Q4). Ownership cannot be tested in the
background, which is why this must be a user-visible option rather than an
automatic migration.

## 11. Account-switching behaviour

- **A → B.** B resolves a different address, finds it empty, follows §9-B. A's
  record is untouched and unreachable.
- **B → A.** A resolves A's address. If A migrated, their key is there and they
  are `ready`. If A has not yet migrated, A sees `needs-recovery` exactly as in
  §9-B.
- **A → B → A.** No shared mutable state: each resolution is a pure function of
  the identity. The Gate 8A characterization test S3 — which today asserts all
  three see one key — is expected to break, correctly, and its replacement is
  named in §22.
- **Multiple accounts.** Each holds its own address; three users hold three
  records. This is the assertion in the `GATE-8 RED` test for S4.
- **Restart between users.** The address is deterministic, so a restart changes
  nothing. The in-memory DEK does not survive, which is already the case.
- **Upgrade then switch.** The legacy record stays inert across every switch; no
  user's behaviour depends on another user having been present.

## 12. `status()` behaviour

Semantics are **unchanged in form and corrected in meaning**: because the address
is now the identity's own, `present` → `ready` (`:211`) already means "this
user's key is available". No new state is required for v1, whose handling is
"ignore" and therefore indistinguishable from absence.

One new state is required for §10: a v2 legacy record present while the user's
own address is empty. It must be distinct from `needs-setup` — which would
invite creating a key while an unclaimed one sits there — and from `locked`,
which asserts the record is this user's. It is an *offer*, not an obligation, and
the gate must render the normal paths alongside it.

`status()` continues **not** to consult the escrow when custody is present. That
is correct once custody is owned, and the Gate 8A.1 Q2 concern it raised — a
`ready` user with no escrow — is extinguished by the namespace: every user now
reaches `needs-setup` and therefore `initialize()`, which guarantees an escrow.
**The F-03 silent-loss finding is fixed as a side effect and needs no separate
mechanism.**

## 13. Pairing behaviour

- **Can pairing occur before ownership is established?** No, and it requires no
  new check. `exportForPairing` reads through the user's own custody address, so
  post-namespace there is no reachable state in which it holds another
  identity's key. SEC-07 is satisfied structurally.
- **Can an inherited legacy DEK be exported?** No. The legacy record is never
  read into a session (§9-B), and the claim path (§10) writes to the user's own
  address only after proof.
- **Proof required.** None beyond what the namespace already provides, plus
  Gate 7's existing rule that a locked device must open its key before exporting.
- **Does the receiving device need extra identity information?** No. Pairing is
  intra-account (`FirebasePairingRelay.ts:74-75`), and `completePairing` writes
  through the custody object it is given, which is already owner-addressed.
- **Changes outside custody?** None.
- **Migration dependency?** One, worth stating: a device that has not yet
  migrated has an empty address and cannot export. Pairing from such a device
  requires the user to complete recovery first. That is correct rather than
  regrettable — it is the same requirement as pairing from any fresh device.

The Gate 8A.1 finding that the defect class could propagate an inherited key
through pairing is closed by the same structural property.

## 14. Recovery behaviour

Recovery **is** the v1 migration (§8, §9-B), and it establishes what is needed
without ever ruling on the legacy record: the escrow is per-identity, server-side
and AAD-bound, so opening it with the recovery code yields *this* identity's DEK
by construction. The trust relationship is Gate 3's, unchanged — the recovery
code authenticates the holder to their own escrow, and the escrow's AAD binds the
result to their identity.

**No new recovery mechanism is introduced.** The existing architecture supports
the migration without one, which is the stated condition for not adding one.
`recoverDataKey` needs only the escrow, the code and `{userId, appName}` (Gate
8A.1 Q2) — nothing local — so it works on a device that has never held the
user's data, which is exactly the post-upgrade situation.

Optional, and explicitly not required: after a successful recovery the recovered
DEK may be compared with the legacy record. Equality is positive proof that the
legacy record belonged to this user, obtained with zero additional friction, and
permits its deletion. If the comparison is not implemented, the record simply
remains inert.

## 15. Interrupted-migration behaviour

The sequence is **read legacy → prove → write namespaced → verify → delete
legacy**, and it is crash-safe with **no marker, journal or transaction**, for
one reason: the namespaced address is the single source of truth and the legacy
record is read-only from the moment the scheme lands.

| Crash point | Resulting state | Why it is safe |
| --- | --- | --- |
| After read, before write | Nothing written | No state changed; the claim can be retried |
| After write, before verify | Namespaced record present | The user's address is authoritative; next launch reads it and reports `ready` |
| After verify, before delete | Namespaced record present, legacy orphan remains | Identical to the above; the orphan is unreachable |
| During delete | Either state | Deletion is idempotent; a surviving orphan is inert |

There is no window producing duplicate *conflicting* custody, because the two
addresses are never both consulted for the same decision, and no window producing
partial state, because a write is a single `storage.set` of a complete envelope.

*Rejected — a migration marker or journal.* It would add state whose own
corruption becomes a new failure mode, to protect a sequence that is already
idempotent. The smallest mechanism that works is copy-verify-delete, and that is
what is specified.

## 16. Data-loss analysis

| Path | Legacy record recoverable after? | Deletion permitted? |
| --- | --- | --- |
| v1, user recovers via escrow | Yes — untouched | Only if the recovered DEK is compared and matches (§14) |
| v1, user has no escrow (defect class) | Yes — untouched | No |
| v2, claim succeeds | Superseded by the namespaced copy | Yes — ownership proven |
| v2, claim fails or is declined | Yes — untouched | No |
| Fresh install / no legacy | n/a | n/a |

**Deletion is permitted only after proven ownership and a verified write.**
Cleanup without ownership proof is not permitted (SEC-09). The justification is
that deletion is not *necessary* for security here: once no read path addresses
the legacy slot, an orphan is inert, and the gate's own instruction is to favour
preserving encrypted data over deleting ambiguous custody unless deletion is
required. It is not.

**Does an orphan create future cross-user risk?** Only if future code reads the
global address. The design removes every such reader except the quarantined,
read-only legacy reader, so the risk is bounded by a rule the architecture guard
can enforce (§18).

**Accepted, unavoidable loss.** A user in the defect class loses access to
records they wrote under another identity's key. The alternative is to keep
handing them that key, which is the vulnerability. Given fact 14 and the evidence
in §3, the expected size of this population is zero; the design does not depend
on that being true, but the trade would deserve re-examination if it were not.

**Also accepted.** A user with a v1 record who has lost their recovery code has
no path. This is not a regression: `recoverDataKey` already required the code,
and Gate 7 already established that the passphrase is not a recovery path. The
namespace changes nothing about it.

## 17. User-experience consequences

Product behaviour and required states only; no screens are designed.

- **First launch after upgrade, user with an escrow.** Sees the existing
  recovery prompt. One recovery-code entry, then normal use. Copy must explain
  this is a one-time step after an update, not a failure.
- **Existing owner returning.** After migrating once, nothing differs from today.
- **Second account on the device.** Sees first-time setup, as if the device were
  new to them — which, correctly, it now is.
- **v2 legacy present.** An additional, secondary option to unlock the existing
  protected key with its passphrase, never blocking the normal paths.
- **Wrong passphrase on the claim.** One message stating the passphrase did not
  open it. It must **not** say the key is not theirs, and must not lock, delete,
  or count attempts toward anything destructive.
- **No recovery capability.** Told plainly that their previous data cannot be
  reached and that continuing creates a new key. This must be explicit, because
  it is the one path where the security fix costs the user something.
- **Interrupted migration.** Invisible — the next launch resolves to whichever
  state completed.
- **Pairing from a migrated device.** Unchanged. From an unmigrated one, the user
  completes recovery first.

## 18. Package and boundary impact

Per the app-specific-first rule, nothing new is extracted; the change lands where
the existing abstraction already is.

- **`packages/security`** — owns the whole change: owner-addressed
  `createKeyCustody`, the hex helper, the quarantined legacy reader, the v2 claim
  operation on the lifecycle, and the new status state. This is the correct home
  because custody, its states and its envelopes already live here.
- **`packages/core`** — the data-key gate renders one additional state. No new
  concept.
- **Applications** — the three `App.tsx` composition roots pass the owner they
  already hold (`apps/networth/App.tsx:64-71` already receives `userId`).
- **`tools/x1-selftest`** — its `storageKey` uses (`:300`, `:586`, `:587`) become
  distinct owners. It is simulating two devices, so this is a closer fit than
  what it does today.
- **Auth / session** — unchanged. `AppCore.tsx:109` already gates on identity;
  the design does not weaken or rely further on that gate, because SEC-03 moves
  the guarantee into the type system.
- **Pairing, recovery, backup, platform secure storage, Firestore rules** —
  unchanged.

**No architecture rule needs to change.** `ARCHITECTURE.md:660` permits this as a
code change absent an established user population, and nothing in `CLAUDE.md`
conflicts. The gate is therefore not blocked.

## 19. Required documentation changes

For the implementation gate to make, not this one:

- `docs/ARCHITECTURE.md` — the custody section describing states and the single
  slot; the release-gate list if a per-user-isolation gate is wanted.
- `packages/security/README.md` — the `KeyCustody` API row, the custody-states
  paragraph, and the new claim operation.
- `CLAUDE.md` — the implementation-state table row for custody.
- `apps/*/README.md` — only if the one-time recovery step is user-visible enough
  to warrant it.

## 20. Rejected alternatives

Collected; each also appears in context above.

1. **Auto-adopt the legacy record for the first user after upgrade.** Rejected:
   fact 13, and it is the defect restated as a feature. No evidence supports the
   assumption.
2. **Adopt on "absence of unwrap failure".** Rejected: SEC-08 — failure is
   ambiguous by design, so its absence is not evidence.
3. **Delete the legacy record unconditionally at upgrade.** Rejected: destroys
   key material whose owner may still reach it, for no security gain once it is
   unreachable.
4. **Raw uid as the address.** Rejected: unestablished charset guarantee against
   a hard storage constraint.
5. **HMAC of the uid under a device secret.** Rejected: non-deterministic across
   reinstall; converts a recoverable state into an unrecoverable one.
6. **Keep `storageKey` as a general option alongside an owner.** Rejected: two
   ways to address a slot, one of which is the current defect. SEC-03 requires
   the unsafe form be unrepresentable.
7. **A migration marker or journal.** Rejected: unnecessary state with its own
   corruption modes; the sequence is already idempotent.
8. **A new ownership-token mechanism written into the v1 envelope at upgrade.**
   Rejected: it would manufacture ownership evidence retroactively, which is
   forbidden and would be a lie — whoever is signed in at upgrade time is not
   known to be the owner.
9. **Requiring an escrow before `exportForPairing`.** Rejected as out of scope:
   the defect class it would address is extinguished by the namespace (§12), so
   the check would guard a state that can no longer arise.

## 21. Open questions and external facts

1. **Whether any build was distributed by hand.** Not determinable from the
   repository (§3). Would be answered by the maintainer. Does not change any
   path; it changes only the expected size of the accepted-loss population.
2. **Firebase Auth UID stability** across reinstall, email change and account
   linking — carried from Gate 8A OQ-3, still unresolved. Bears on whether a
   user's address survives an email change. **Not blocking:** if a UID changes,
   the user resolves an empty address and recovers, which is the same path as any
   unmigrated user.
3. **Whether anonymous auth is enabled in the Firebase console.** Carried from
   Gate 8A.1. Not blocking — no call site exists.
4. **Storage key length limits.** None found for either backend; if one emerges,
   truncating the digest to 128 bits is sufficient.
5. **Whether the browser tier warrants the same treatment.** Carried from Gate 8A
   OQ-6. The design applies uniformly because the address is computed above the
   storage interface, so no per-tier decision is required — recorded in case a
   later gate wants to revisit the web threat model.

## 22. Implementation gate sequence

Smallest safe order. Not implemented here. Each step names the RED test it turns
green; RED tests precede implementation in every case.

1. **Hex encoder** in `packages/security/src/crypto/`. Tests first: round-trip
   and charset. Turns no RED test green; it is a prerequisite.
2. **Address derivation** — a pure function from owner identity to slot address.
   Tests first: determinism across calls, distinctness for distinct identities,
   output charset within `[a-z0-9.]`, stability of the prefix. No RED test.
3. **Owner-addressed `createKeyCustody`**, withdrawing `storageKey`; update the
   three composition roots and the self-test. **Turns green:** the S1 pair
   (`Bob's load must never return Alice's DEK`, `a user with no key of their own
   must be offered setup`), S3 (`Alice's key must be unaffected`), S4 (`three
   users must hold three slots`), S9 (`an unprotected key must be as isolated as
   a protected one`). This is the whole isolation fix; steps 4–6 exist only for
   legacy records.
4. **Characterization reconciliation.** The 16 `characterizes:` tests are
   revisited as a deliberate act: those describing the shared-slot behaviour must
   be rewritten to the new truth, and the `it.fails` markers removed from every
   RED test step 3 turned green — CI forces this, since `it.fails` fails once the
   assertion passes. §23 lists which.
5. **Quarantined legacy reader** — read-only, addressing `v1`, with an
   architecture guard asserting it is the sole reference to the legacy constant
   outside tests. Prove the guard fires.
6. **v2 claim operation** on the lifecycle plus its status state. Tests first:
   success under the owning identity migrates and preserves protection; failure
   under a wrong passphrase changes nothing; failure under a different identity
   changes nothing and is indistinguishable from the wrong-passphrase case.
   **Turns green:** S2 (`Bob must not be shown another user's protected custody`)
   — note this one is turned green by step 3, and step 6 must not regress it.
7. **Gate rendering** of the claim state in `packages/core`, alongside the
   existing paths rather than in place of them.
8. **Optional cleanup** — post-recovery DEK comparison and legacy deletion on
   match. Last, separable, and droppable without affecting any invariant.
9. **Documentation** per §19.

## 23. Acceptance criteria for the implementation gate

- Every `GATE-8 RED` test passes with its `it.fails` marker **removed**. A
  remaining marker is a failure, not a pass: `it.fails` fails once the assertion
  holds, so CI enforces this automatically.
- Every `characterizes:` test is either still passing unchanged, or rewritten
  with its replacement assertion recorded in the commit. Enumerated, because the
  count is higher than it first appears: **15 of the 16 break, and exactly one
  survives.**

  | Test | Post-change | Why |
  | --- | --- | --- |
  | S1 ×4 | break | Bob is `needs-setup`, `load()` is null, the address is not the global one, and he *is* offered setup |
  | S2 ×3 | break | Bob is not `locked`; `unlock` fails earlier; he *can* initialise |
  | S3, S4 | break | Users no longer share a key or a slot |
  | S5 case 1 | **survives** | A documentation assertion with no behavioural content |
  | S5 case 2 | break | An empty identity now resolves to its own empty address rather than someone else's key |
  | S6 | break | The slot-unchanged half still holds; the `ready` half does not |
  | S7/S8 ×3 | break | See the caution below |
  | S9 case 1 | break | Asserts the global address and that Bob holds the same bytes |

  **Caution, and it is the one that could quietly cost coverage.** S7/S8 today
  prove the AAD refuses a wrapper belonging to another identity. Post-change they
  break **not because that stopped being true** but because the lifecycle no
  longer reaches the AAD — it fails earlier, on an empty address, with a
  different error code. A rewrite that simply updates the expected code would
  silently retire a real security assertion. The AAD property must remain proven:
  it is already covered at the primitive level in
  `packages/security/tests/dataKeyWrapper.test.ts:103-112`, and any rewrite here
  must either defer to that explicitly or reconstruct the cross-identity case
  directly rather than through custody.
- New tests prove: address determinism across restart; three identities holding
  three records; a v2 claim succeeding only under the owning identity; failure
  changing no state; crash-safety at each of the four points in §15; and that the
  legacy constant has exactly one reader.
- The architecture guard for the legacy constant is proven to fire by breaking it.
- `pnpm lint`, `pnpm verify` (28/28) and both Hermes API levels green.
- No change to the record envelope, record AAD, escrow format, pairing protocol,
  backup format, Security Rules or KDF parameters.

## 24. Scope exclusions

Not in this design and not to be added by the implementation gate: app lock,
biometrics, backup redesign, Firebase configuration, the account-deletion flow
(unwired, per Gate 8A F-06), the cold-start identity race (Gate 8A F-07 — no
custody impact, tracked separately), `DataKeyGate` state retention (F-09 —
latent, unreachable), any change to Gate 7's passphrase semantics, and any new
recovery mechanism.

---

GATE 8B RESULT: READY FOR IMPLEMENTATION
