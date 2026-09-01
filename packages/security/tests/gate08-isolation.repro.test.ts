import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toBase64 } from '../src/crypto/base64';
import { createDataKeyLifecycle, type DataKeyLifecycle } from '../src/dataKeyLifecycle';
import { createKeyCustody, type CustodyStorage } from '../src/keyCustody';
import { MIN_KDF_ITERATIONS } from '../src/kdfPolicy';
import type { ProtectionTier } from '../src/protectionTier';
import { WebCryptoService } from '../src/services/WebCryptoService';

/**
 * Gate 8A — reproduction of per-user custody isolation behaviour.
 *
 * **This file contains two kinds of test and they must not be merged.**
 *
 * `characterizes:` — asserts what the system does **today**, exactly as
 * observed. These pass now. They are not endorsements: several of them
 * describe behaviour Gate 8 intends to change. Their job is to make that
 * change loud. If a later gate alters custody behaviour without updating this
 * file deliberately, these break, and that is the point.
 *
 * `GATE-8 RED:` — asserts the behaviour that is **required and does not hold
 * yet**. Each carries a one-line statement of the invariant in plain terms.
 * They are marked `it.fails`, which in Vitest 2.1.9 passes while the assertion
 * fails and **fails the moment the assertion starts passing** — so when Gate 8C
 * lands, CI forces the marker off rather than letting a fixed invariant sit
 * silently mis-labelled. That is a ratchet, not a suppression.
 *
 * Where the right answer is a genuine design decision rather than an
 * unarguable requirement — stale custody with no authenticated user, and what
 * account deletion owes a slot — there is a characterization test only, and
 * the question is routed to Open Questions in `docs/gates/gate-08a-audit.md`.
 * Nothing here settles a design question by asserting it.
 *
 * Faithfulness to production: `apps/networth/index.tsx:95` builds **one**
 * `secureStorage` for the process and passes it to every user's custody, so a
 * single shared store is the honest model. `packages/core/src/AppCore.tsx:80`
 * builds one lifecycle per `user.id`, so "sign in as X" is a new lifecycle over
 * that same store — which is exactly what `lifecycleFor` does below.
 */

const crypto = new WebCryptoService(MIN_KDF_ITERATIONS);
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

const APP_NAME = 'networth';
const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const CAROL = 'carol-uid';
const ALICE_PASSPHRASE = 'zq7-marmalade-quorum-vessel';
const BOB_PASSPHRASE = 'xt4-obsidian-lantern-thicket';

/** The slot every production app actually uses. `keyCustody.ts:96`. */
const GLOBAL_SLOT = 'platform.dek.v1';

/** One store for the whole process, as the entry point builds it. */
class SharedDeviceStorage implements CustodyStorage {
  readonly entries = new Map<string, string>();
  readonly protection: ProtectionTier = 'os-keystore';
  async get(key: string) {
    return this.entries.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.entries.set(key, value);
  }
  async remove(key: string) {
    this.entries.delete(key);
  }
}

/** Per-user escrow, as Firestore gives it: keyed by the signed-in user. */
class PerUserEscrowStore {
  private readonly docs = new Map<string, unknown>();
  constructor(private userId: string) {}
  as(userId: string): PerUserEscrowStore {
    this.userId = userId;
    return this;
  }
  async load(): Promise<unknown | null> {
    return this.docs.get(this.userId) ?? null;
  }
  async save(document: unknown): Promise<void> {
    this.docs.set(this.userId, document);
  }
}

/**
 * "Sign in as this user" — a new lifecycle over the same device storage.
 *
 * Mirrors `AppCore.tsx:80-83`: the lifecycle is memoised on `user.id`, so a
 * different id produces a different lifecycle and the previous one — with the
 * DEK it had opened — is dropped with its closure.
 */
function lifecycleFor(
  storage: SharedDeviceStorage,
  escrow: PerUserEscrowStore,
  userId: string,
): DataKeyLifecycle {
  return createDataKeyLifecycle({
    // Exactly the production call: no `storageKey`. `apps/networth/App.tsx:71`.
    custody: createKeyCustody(storage),
    escrowStore: escrow.as(userId),
    crypto,
    context: { userId, appName: APP_NAME },
    randomBytes,
  });
}

function device() {
  const storage = new SharedDeviceStorage();
  const escrow = new PerUserEscrowStore(ALICE);
  return {
    storage,
    escrow,
    signIn: (userId: string) => lifecycleFor(storage, escrow, userId),
  };
}

const bytes = (key: Uint8Array | null) => (key === null ? null : Array.from(key));

// ---------------------------------------------------------------------------
// Sequence 1 — Alice init, sign-out, Bob load. No passphrase wrapper.
// ---------------------------------------------------------------------------

describe('S1 — Alice initialises, signs out, Bob signs in (no wrapper)', () => {
  async function run() {
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    const aliceKey = bytes(await alice.load());
    // Sign-out: AppCore renders `signedOut` and drops the lifecycle
    // (`AppCore.tsx:109`). Nothing clears custody — there is no production
    // caller of `custody.clear()` anywhere in the repository.
    const bob = d.signIn(BOB);
    return { d, aliceKey, bob };
  }

  it('characterizes: Bob is told his key is ready', async () => {
    const { bob } = await run();
    expect(await bob.status()).toBe('ready');
  });

  it("characterizes: Bob's custody load returns Alice's DEK, byte for byte", async () => {
    const { aliceKey, bob } = await run();
    expect(bytes(await bob.load())).toEqual(aliceKey);
  });

  it('characterizes: exactly one slot exists on the device, and it is the global one', async () => {
    const { d } = await run();
    expect([...d.storage.entries.keys()]).toEqual([GLOBAL_SLOT]);
  });

  it('characterizes: Bob is never offered setup, so he never gets an escrow of his own', async () => {
    const { d, bob } = await run();
    // `needs-setup` is the only state in which `DataKeyGate` runs first-time
    // setup and mints a recovery code (`dataKeyStep.ts` maps it to 'setup').
    expect(await bob.status()).not.toBe('needs-setup');
    expect(await d.escrow.as(BOB).load()).toBeNull();
  });

  // The invariant this whole gate exists for.
  it.fails('GATE-8 RED: loading custody for Bob must never return Alice’s DEK', async () => {
    const { aliceKey, bob } = await run();
    expect(bytes(await bob.load())).not.toEqual(aliceKey);
  });

  it.fails('GATE-8 RED: a user with no key of their own must be offered setup', async () => {
    const { bob } = await run();
    expect(await bob.status()).toBe('needs-setup');
  });
});

// ---------------------------------------------------------------------------
// Sequence 2 — the same, with Alice's Gate 7 wrapper enabled.
// ---------------------------------------------------------------------------

describe('S2 — Alice protects her key, then Bob signs in', () => {
  async function run() {
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    const aliceKey = bytes(await alice.load());
    await alice.protect(ALICE_PASSPHRASE);
    const bob = d.signIn(BOB);
    return { d, aliceKey, bob };
  }

  it("characterizes: Bob sees Alice's protected slot as 'locked'", async () => {
    const { bob } = await run();
    expect(await bob.status()).toBe('locked');
  });

  it('characterizes: Gate 7 stops Bob getting the key — even with Alice’s passphrase', async () => {
    // The AAD binds the wrapper to Alice's userId, so this is a tag failure
    // rather than a key. This is Gate 7 doing real work on this defect.
    const { bob } = await run();
    await expect(bob.unlock(ALICE_PASSPHRASE)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('characterizes: Bob cannot initialise, recover, or otherwise proceed — a dead end', async () => {
    const { bob } = await run();
    await expect(bob.initialize()).rejects.toMatchObject({ code: 'KEY_CUSTODY_INVALID' });
    await expect(bob.recover('K7QM-2XPD-9RTF')).rejects.toMatchObject({
      code: 'KEY_CUSTODY_INVALID',
    });
  });

  it.fails('GATE-8 RED: Bob must not be shown another user’s protected custody at all', async () => {
    const { bob } = await run();
    expect(await bob.status()).not.toBe('locked');
  });
});

// ---------------------------------------------------------------------------
// Sequence 3 — Alice, Bob, Alice again.
// ---------------------------------------------------------------------------

describe('S3 — Alice, then Bob, then Alice returns', () => {
  it('characterizes: whatever Bob wrote is what Alice comes back to', async () => {
    const d = device();
    const alice1 = d.signIn(ALICE);
    await alice1.initialize();
    const aliceOriginal = bytes(await alice1.load());

    // Bob is handed Alice's key and it becomes his working key too.
    const bob = d.signIn(BOB);
    const bobSaw = bytes(await bob.load());

    const alice2 = d.signIn(ALICE);
    const aliceReturns = bytes(await alice2.load());

    // All three are the same bytes: there is only ever one key on the device.
    expect(bobSaw).toEqual(aliceOriginal);
    expect(aliceReturns).toEqual(aliceOriginal);
  });

  it.fails('GATE-8 RED: Alice’s key must be unaffected by Bob having used the device', async () => {
    // Stated positively: Bob must have his own slot, so Alice's must still be
    // hers alone. Today there is one slot, so "unaffected" is accidental.
    const d = device();
    const alice1 = d.signIn(ALICE);
    await alice1.initialize();
    const bob = d.signIn(BOB);
    await bob.load().catch(() => null);
    expect([...d.storage.entries.keys()].length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Sequence 4 — three users in turn.
// ---------------------------------------------------------------------------

describe('S4 — Alice, Bob, Carol', () => {
  it('characterizes: all three share one key and one slot', async () => {
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    const key = bytes(await alice.load());

    expect(bytes(await d.signIn(BOB).load())).toEqual(key);
    expect(bytes(await d.signIn(CAROL).load())).toEqual(key);
    expect([...d.storage.entries.keys()]).toEqual([GLOBAL_SLOT]);
  });

  it.fails('GATE-8 RED: three users on one device must hold three separate slots', async () => {
    const d = device();
    await d.signIn(ALICE).initialize();
    await d.signIn(BOB).load().catch(() => null);
    await d.signIn(CAROL).load().catch(() => null);
    expect([...d.storage.entries.keys()].length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Sequence 5 — no authenticated user.
//
// DESIGN QUESTION, NOT ASSERTED. What custody should do when asked for a key
// with no signed-in identity is a decision for 8B, not something to settle
// here. Characterization only; routed to Open Questions (OQ-1).
// ---------------------------------------------------------------------------

describe('S5 — custody asked for a key with no authenticated user', () => {
  it('characterizes: production never reaches this — AppCore gates on identity first', () => {
    // `AppCore.tsx:108` returns <Loading/> while `initializing`, and `:109`
    // returns `signedOut` when `!user || !lifecycle`. The lifecycle itself is
    // `null` without a user (`:80-83`), so no custody object is constructed.
    // This test records the gate as the reason, not an assumption about it.
    expect(true).toBe(true);
  });

  it('characterizes: the library, asked directly with an empty identity, still serves the key', async () => {
    // Nothing in `createKeyCustody` or `createDataKeyLifecycle` validates the
    // identity, because the slot does not depend on it. If a future caller
    // loses the AppCore gate, this is what it gets.
    const d = device();
    await d.signIn(ALICE).initialize();
    const anonymous = d.signIn('');
    expect(await anonymous.status()).toBe('ready');
    expect(bytes(await anonymous.load())).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sequence 6 — Alice's account deleted.
//
// DESIGN QUESTION, NOT ASSERTED. What deletion owes a slot is for 8B (OQ-2).
// ---------------------------------------------------------------------------

describe('S6 — Alice, Bob, then Alice’s account is deleted', () => {
  it('characterizes: no production code path deletes custody at all', async () => {
    // `deleteAccountFlow` ends with `callbacks.clearLocalState()`
    // (`deleteAccountFlow.ts:80`), but the flow has no caller outside
    // `packages/account`, and `custody.clear()` has no production caller
    // anywhere. Deleting an account therefore leaves the device key in place.
    const d = device();
    await d.signIn(ALICE).initialize();
    const before = d.storage.entries.get(GLOBAL_SLOT);

    // Alice's account is deleted server-side. Nothing touches the device.
    const bob = d.signIn(BOB);

    expect(d.storage.entries.get(GLOBAL_SLOT)).toBe(before);
    expect(await bob.status()).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// Sequences 7 and 8 — wrapper bytes moved between identities.
//
// This is the layer that is already doing the work, and it is worth having
// asserted so that Gate 8 cannot quietly weaken it while adding a namespace.
// ---------------------------------------------------------------------------

describe('S7/S8 — a wrapper moved between identities', () => {
  it('characterizes: Alice’s wrapper does not open under Bob’s identity', async () => {
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    await alice.protect(ALICE_PASSPHRASE);

    // The bytes are already in the shared slot; Bob's lifecycle reads them.
    const bob = d.signIn(BOB);
    await expect(bob.unlock(ALICE_PASSPHRASE)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('characterizes: Bob’s wrapper does not open under Alice’s identity', async () => {
    const d = device();
    const bob = d.signIn(BOB);
    await bob.initialize();
    await bob.protect(BOB_PASSPHRASE);

    const alice = d.signIn(ALICE);
    await expect(alice.unlock(BOB_PASSPHRASE)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('characterizes: the AAD, not the slot, is what refuses — the slot is shared', async () => {
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    await alice.protect(ALICE_PASSPHRASE);
    const raw = d.storage.entries.get(GLOBAL_SLOT) as string;

    // Bob reads the identical bytes. Nothing about storage separated them.
    const bob = d.signIn(BOB);
    expect(d.storage.entries.get(GLOBAL_SLOT)).toBe(raw);
    await expect(bob.unlock(ALICE_PASSPHRASE)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The unprotected case, stated on its own, because it is the one where the
// AAD is not load-bearing and nothing else stands in the way.
// ---------------------------------------------------------------------------

describe('S9 — what the AAD does not cover', () => {
  it('characterizes: an unprotected DEK carries no identity binding of its own', async () => {
    // A v1 envelope is `{v:1,k:<base64>}` (`keyCustody.ts`), and `load()`
    // returns those bytes to whoever asks. The record AAD binds *records* to a
    // user; it does not bind the *key* to one. With no wrapper there is
    // nothing between a second user and the first user's key material.
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    const aliceKey = (await alice.load()) as Uint8Array;

    const stored = JSON.parse(d.storage.entries.get(GLOBAL_SLOT) as string) as {
      v: number;
      k: string;
    };
    expect(stored.v).toBe(1);
    expect(stored.k).toBe(toBase64(aliceKey));

    // And Bob holds the same 32 bytes.
    expect(bytes(await d.signIn(BOB).load())).toEqual(Array.from(aliceKey));
  });

  it.fails('GATE-8 RED: an unprotected key must be as isolated as a protected one', async () => {
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    const aliceKey = bytes(await alice.load());
    expect(bytes(await d.signIn(BOB).load())).not.toEqual(aliceKey);
  });
});
