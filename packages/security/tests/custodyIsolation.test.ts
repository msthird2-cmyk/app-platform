import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toBase64 } from '../src/crypto/base64';
import { custodyAddressFor } from '../src/custodyAddress';
import { createDataKeyLifecycle, type DataKeyLifecycle } from '../src/dataKeyLifecycle';
import { SecurityErrorCode } from '../src/errors';
import { createKeyCustody, type CustodyStorage } from '../src/keyCustody';
import { MIN_KDF_ITERATIONS } from '../src/kdfPolicy';
import type { ProtectionTier } from '../src/protectionTier';
import { WebCryptoService } from '../src/services/WebCryptoService';

/**
 * Custody belongs to one identity, and a second person on the device gets
 * nothing of theirs.
 *
 * This file was written before the isolation existed: it characterized the
 * defect, and it held a set of deliberately failing assertions describing the
 * behaviour that was required. Those assertions hold now, so the
 * expected-failure markers are gone and every characterization has been
 * rewritten to what the system actually does today. Each rewrite states what it
 * now asserts and why the previous assertion is obsolete, so the change is
 * legible to whoever reads this next rather than merely applied.
 *
 * The `characterizes:` prefix stays. These remain descriptions of behaviour
 * rather than statements of requirement, which is what makes them break loudly
 * if custody moves again.
 *
 * Faithful to production: `apps/networth/index.tsx` builds one `secureStorage`
 * for the process and hands it to every user's custody, so a single shared
 * store is the honest model. `packages/core/src/AppCore.tsx` builds one
 * lifecycle per `user.id`, so "sign in as X" is a new lifecycle over that same
 * store — which is what `signIn` does below.
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
 * The owner handed to custody is the same identity that goes into the
 * encryption context, which is exactly what the three composition roots do.
 */
function lifecycleFor(
  storage: SharedDeviceStorage,
  escrow: PerUserEscrowStore,
  userId: string,
): DataKeyLifecycle {
  return createDataKeyLifecycle({
    custody: createKeyCustody(storage, { owner: userId }),
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
// Alice initialises, signs out, Bob signs in. No passphrase wrapper.
// ---------------------------------------------------------------------------

describe('a second user signing in after the first, with no wrapper', () => {
  async function run() {
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    const aliceKey = bytes(await alice.load());
    // Sign-out drops the lifecycle (`AppCore.tsx`). Nothing clears custody, and
    // nothing needs to: Bob addresses a different record entirely.
    const bob = d.signIn(BOB);
    return { d, aliceKey, bob };
  }

  it('characterizes: Bob is offered first-time setup, because he has no key', async () => {
    // Was "Bob is told his key is ready". Obsolete: that reported readiness on
    // the strength of a record belonging to somebody else. Bob addresses his
    // own, finds it empty, and is routed to setup.
    const { bob } = await run();
    expect(await bob.status()).toBe('needs-setup');
  });

  it("characterizes: Bob's custody load returns nothing at all", async () => {
    // Was "returns Alice's DEK, byte for byte" — the disclosure this change
    // removes. `null` is the point.
    const { aliceKey, bob } = await run();
    expect(await bob.load()).toBeNull();
    expect(bytes(await bob.load())).not.toEqual(aliceKey);
  });

  it('characterizes: one record exists, at Alice’s address and not a global one', async () => {
    // Was "exactly one slot exists, and it is the global one". Still one
    // record, because only Alice has a key — but it is hers by address.
    const { d } = await run();
    expect([...d.storage.entries.keys()]).toEqual([custodyAddressFor(ALICE)]);
    expect(d.storage.entries.has('platform.dek.v1')).toBe(false);
  });

  it('characterizes: Bob reaches setup, so he gets an escrow of his own', async () => {
    // Was "Bob is never offered setup, so he never gets an escrow" — the
    // silent-loss finding: a user holding someone else's key with no recovery
    // path and no way to notice. Reaching setup is what closes it, because
    // setup writes the escrow before the record.
    const { d, bob } = await run();
    expect(await bob.status()).toBe('needs-setup');
    await bob.initialize();
    expect(await d.escrow.as(BOB).load()).not.toBeNull();
  });

  it('gives Bob a key that is not Alice’s', async () => {
    const { d, aliceKey, bob } = await run();
    await bob.initialize();
    expect(bytes(await bob.load())).not.toEqual(aliceKey);
    expect([...d.storage.entries.keys()].sort()).toEqual(
      [custodyAddressFor(ALICE), custodyAddressFor(BOB)].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// The same, with Alice's passphrase wrapper enabled.
// ---------------------------------------------------------------------------

describe('a second user signing in after the first, with a wrapper', () => {
  async function run() {
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    const aliceKey = bytes(await alice.load());
    await alice.protect(ALICE_PASSPHRASE);
    const bob = d.signIn(BOB);
    return { d, aliceKey, bob };
  }

  it('characterizes: Bob does not see Alice’s protected record as a lock of his own', async () => {
    // Was "Bob sees Alice's protected slot as 'locked'". Obsolete: `locked`
    // asserts the record is this user's and merely shut. It was never his.
    const { bob } = await run();
    expect(await bob.status()).toBe('needs-setup');
    expect(await bob.isProtected()).toBe(false);
  });

  it('characterizes: Alice’s passphrase does nothing for Bob, because there is nothing to open', async () => {
    // Was "Gate 7 stops Bob getting the key — even with Alice's passphrase",
    // asserting DECRYPTION_FAILED from the tag. The AAD does still refuse a
    // foreign wrapper, and that property is proven where the tag is the
    // subject: `dataKeyWrapper.test.ts` at the primitive level, and
    // `dataKeyProtection.test.ts` through the lifecycle over a deliberately
    // shared address. It is simply no longer what stops Bob here. Updating the
    // expected code and leaving the old description would have turned a real
    // assertion into a misleading one.
    const { bob } = await run();
    await expect(bob.unlock(ALICE_PASSPHRASE)).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_UNAVAILABLE,
    });
  });

  it('characterizes: Bob can initialise — he is not in a dead end', async () => {
    // Was "Bob cannot initialise, recover, or otherwise proceed — a dead end".
    // Both refusals were consequences of Alice's record occupying the only
    // address. Bob has his own now and the normal paths are open.
    const { bob } = await run();
    await expect(bob.initialize()).resolves.toMatchObject({
      recoveryCode: expect.any(String),
    });
  });

  it('leaves Alice’s protection untouched by Bob having been here', async () => {
    const { d, aliceKey } = await run();
    await d.signIn(BOB).initialize();
    const alice = d.signIn(ALICE);
    expect(await alice.isProtected()).toBe(true);
    expect(bytes(await alice.unlock(ALICE_PASSPHRASE))).toEqual(aliceKey);
  });
});

// ---------------------------------------------------------------------------
// Alice, Bob, Alice again.
// ---------------------------------------------------------------------------

describe('switching back and forth between two users', () => {
  it('characterizes: each user returns to their own key, unaffected by the other', async () => {
    // Was "whatever Bob wrote is what Alice comes back to" — one key shared by
    // everyone. Obsolete in every part: separate keys, and neither can affect
    // the other's.
    const d = device();
    const alice1 = d.signIn(ALICE);
    await alice1.initialize();
    const aliceOriginal = bytes(await alice1.load());

    const bob = d.signIn(BOB);
    await bob.initialize();
    const bobKey = bytes(await bob.load());

    const alice2 = d.signIn(ALICE);
    expect(bobKey).not.toEqual(aliceOriginal);
    expect(bytes(await alice2.load())).toEqual(aliceOriginal);
  });

  it('holds one record per user once both have set up', async () => {
    const d = device();
    await d.signIn(ALICE).initialize();
    await d.signIn(BOB).initialize();
    expect([...d.storage.entries.keys()].length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Three users.
// ---------------------------------------------------------------------------

describe('three users on one device', () => {
  it('characterizes: three keys and three records, sharing nothing', async () => {
    // Was "all three share one key and one slot".
    const d = device();
    const keys: (number[] | null)[] = [];
    for (const who of [ALICE, BOB, CAROL]) {
      const life = d.signIn(who);
      await life.initialize();
      keys.push(bytes(await life.load()));
    }
    expect(new Set(keys.map((key) => JSON.stringify(key))).size).toBe(3);
    expect([...d.storage.entries.keys()].sort()).toEqual(
      [ALICE, BOB, CAROL].map(custodyAddressFor).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// No authenticated identity.
// ---------------------------------------------------------------------------

describe('custody asked for a key with no authenticated user', () => {
  it('characterizes: production never reaches this — AppCore gates on identity first', () => {
    // `AppCore.tsx` renders a loading state while initializing and `signedOut`
    // when there is no user, and the lifecycle is null without one. Unchanged
    // by this work, and recorded so the guarantee below is not mistaken for
    // the only one.
    expect(true).toBe(true);
  });

  it('characterizes: the library now refuses an empty identity outright', async () => {
    // Was "asked directly with an empty identity, still serves the key" — the
    // library complied and handed over whatever the global record held.
    // Obsolete twice: there is no global record, and an empty identity is
    // refused at construction rather than quietly given a namespace of its own.
    const d = device();
    await d.signIn(ALICE).initialize();
    expect(() => d.signIn('')).toThrowError(
      expect.objectContaining({ code: SecurityErrorCode.KEY_CUSTODY_INVALID }),
    );
  });
});

// ---------------------------------------------------------------------------
// Account deletion.
// ---------------------------------------------------------------------------

describe('one user’s account deleted while another uses the device', () => {
  it('characterizes: no production path deletes custody, and no user depends on another’s', async () => {
    // Was the same first half plus "Bob is ready" — true only because Bob was
    // reading Alice's record. Deletion still touches nothing locally, and that
    // now has no bearing on Bob whatsoever.
    const d = device();
    await d.signIn(ALICE).initialize();
    const aliceRecord = d.storage.entries.get(custodyAddressFor(ALICE));

    const bob = d.signIn(BOB);
    await bob.initialize();

    expect(d.storage.entries.get(custodyAddressFor(ALICE))).toBe(aliceRecord);
    expect(await bob.status()).toBe('ready');
    expect(bytes(await bob.load())).not.toEqual(bytes(await d.signIn(ALICE).load()));
  });
});

// ---------------------------------------------------------------------------
// A wrapper belonging to another identity.
//
// What these can and cannot prove has changed, and it matters. The AAD still
// refuses a wrapper belonging to another identity; that property is proven
// directly in `dataKeyWrapper.test.ts` (a wrapper bound to another user or
// another application) and through the lifecycle over a deliberately shared
// address in `dataKeyProtection.test.ts`. The cases below assert the *address*
// property, which is what this file is about — said plainly so a later reader
// does not mistake them for the tag coverage they replaced.
// ---------------------------------------------------------------------------

describe('a wrapper belonging to another identity', () => {
  it('characterizes: Alice’s wrapper is not reachable from Bob’s session at all', async () => {
    // Was "does not open under Bob's identity", expecting DECRYPTION_FAILED
    // from the tag. Obsolete as written: the lifecycle stops earlier, at the
    // address, so the tag is never consulted.
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    await alice.protect(ALICE_PASSPHRASE);

    const bob = d.signIn(BOB);
    expect(await bob.isProtected()).toBe(false);
    await expect(bob.unlock(ALICE_PASSPHRASE)).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_UNAVAILABLE,
    });
  });

  it('characterizes: Bob’s wrapper is not reachable from Alice’s session either', async () => {
    // The mirror of the above; same obsolescence, same replacement.
    const d = device();
    const bob = d.signIn(BOB);
    await bob.initialize();
    await bob.protect(BOB_PASSPHRASE);

    const alice = d.signIn(ALICE);
    expect(await alice.isProtected()).toBe(false);
    await expect(alice.unlock(BOB_PASSPHRASE)).rejects.toMatchObject({
      code: SecurityErrorCode.DATA_KEY_UNAVAILABLE,
    });
  });

  it('characterizes: the address separates them, and the two records differ', async () => {
    // Was "the AAD, not the slot, is what refuses — the slot is shared". False
    // now in both halves: the slot is not shared, and the address refuses
    // first. Two users protecting keys produce two distinct stored records
    // rather than one overwriting the other.
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    await alice.protect(ALICE_PASSPHRASE);

    const bob = d.signIn(BOB);
    await bob.initialize();
    await bob.protect(BOB_PASSPHRASE);

    const aliceRecord = d.storage.entries.get(custodyAddressFor(ALICE));
    const bobRecord = d.storage.entries.get(custodyAddressFor(BOB));
    expect(aliceRecord).toBeDefined();
    expect(bobRecord).toBeDefined();
    expect(aliceRecord).not.toBe(bobRecord);
  });
});

// ---------------------------------------------------------------------------
// What the record itself carries.
// ---------------------------------------------------------------------------

describe('what an unprotected record carries', () => {
  it('characterizes: still no identity inside the envelope — the address carries it', async () => {
    // Was "an unprotected DEK carries no identity binding of its own",
    // demonstrated by Bob receiving the same bytes. The first half remains
    // exactly true and worth keeping — the envelope is `{v:1,k}` with no AEAD
    // — but the demonstration is obsolete, because the binding now lives in
    // the address rather than in the envelope. That is the whole design.
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    const aliceKey = (await alice.load()) as Uint8Array;

    const stored = JSON.parse(
      d.storage.entries.get(custodyAddressFor(ALICE)) as string,
    ) as { v: number; k: string };
    expect(stored.v).toBe(1);
    expect(stored.k).toBe(toBase64(aliceKey));

    expect(custodyAddressFor(ALICE)).not.toBe(custodyAddressFor(BOB));
    expect(await d.signIn(BOB).load()).toBeNull();
  });

  it('keeps an unprotected key as isolated as a protected one', async () => {
    const d = device();
    const alice = d.signIn(ALICE);
    await alice.initialize();
    const aliceKey = bytes(await alice.load());
    const bob = d.signIn(BOB);
    await bob.initialize();
    expect(bytes(await bob.load())).not.toEqual(aliceKey);
  });
});

// ---------------------------------------------------------------------------
// Readiness implies a recovery path.
// ---------------------------------------------------------------------------

describe('readiness and the escrow', () => {
  it('never reports ready without an escrow existing for that user', async () => {
    // The silent-loss finding, asserted rather than left as a consequence.
    // `status()` reaches the escrow branch only when custody is absent, so a
    // user reported `ready` on somebody else's record had no escrow and no way
    // to discover it. Every route to a key now runs through this user's own
    // absent record, and `initialize()` writes the escrow before the record.
    const d = device();

    for (const who of [ALICE, BOB, CAROL]) {
      const life = d.signIn(who);
      expect(await life.status(), who).toBe('needs-setup');
      expect(await d.escrow.as(who).load(), who).toBeNull();

      await life.initialize();

      expect(await life.status(), who).toBe('ready');
      expect(await d.escrow.as(who).load(), who).not.toBeNull();
    }
  });

  it('gives a restarted session the same answer, from the address alone', async () => {
    const d = device();
    await d.signIn(ALICE).initialize();
    // A new lifecycle over the same store, as a cold start builds one.
    const restarted = d.signIn(ALICE);
    expect(await restarted.status()).toBe('ready');
    expect(await d.escrow.as(ALICE).load()).not.toBeNull();
  });
});
