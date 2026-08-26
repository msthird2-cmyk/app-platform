import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  collectionGroup,
  getDocs,
} from 'firebase/firestore';
import { ALICE, BOB, createTestEnvironment, envelope, record, unverified, verified } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnvironment();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

/** Writes a record bypassing rules, so read/update tests have something to hit. */
async function seedRecord(uid: string, collectionName: string, id: string, extra = {}) {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${uid}/${collectionName}/${id}`), {
      id,
      revision: 1,
      deletedAt: null,
      updatedAt: new Date(),
      ...extra,
    });
  });
}

describe('unauthenticated access', () => {
  it('is denied everywhere', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}`)));
    await assertFails(getDoc(doc(db, `users/${ALICE}/assets/a1`)));
    await assertFails(setDoc(doc(db, `users/${ALICE}/assets/a1`), record('a1')));
    await assertFails(getDocs(collection(db, `users/${ALICE}/assets`)));
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/assets/a1`)));
  });
});

describe('cross-user access', () => {
  beforeEach(async () => {
    await seedRecord(ALICE, 'assets', 'a1');
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${ALICE}`), { displayName: 'Alice' });
      await setDoc(doc(context.firestore(), `users/${ALICE}/backups/backup-1`), {
        id: 'backup-1', createdAt: 1, sizeBytes: 1, recordCount: 1, appName: 'Net Worth',
      });
    });
  });

  it('denies Bob reading Alice records', async () => {
    const db = verified(env, BOB).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}/assets/a1`)));
    await assertFails(getDocs(collection(db, `users/${ALICE}/assets`)));
  });

  it('denies Bob writing into Alice records', async () => {
    const db = verified(env, BOB).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/assets/new`), { ...record('new'), updatedAt: serverTimestamp() }),
    );
  });

  it('denies Bob updating an Alice record', async () => {
    const db = verified(env, BOB).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/assets/a1`), {
        ...record('a1', { revision: 2 }), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('denies Bob deleting an Alice record', async () => {
    await assertFails(deleteDoc(doc(verified(env, BOB).firestore(), `users/${ALICE}/assets/a1`)));
  });

  it('denies Bob reading or writing the Alice profile', async () => {
    const db = verified(env, BOB).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}`)));
    await assertFails(setDoc(doc(db, `users/${ALICE}`), { displayName: 'owned' }));
  });

  it('denies Bob writing to Alice devices', async () => {
    const db = verified(env, BOB).firestore();
    await assertFails(setDoc(doc(db, `users/${ALICE}/devices/d1`), { name: 'Planted' }));
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/devices/d1`)));
  });

  it('denies Bob writing to Alice settings', async () => {
    const db = verified(env, BOB).firestore();
    await assertFails(setDoc(doc(db, `users/${ALICE}/settings/s1`), { theme: 'dark' }));
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/settings/s1`)));
  });

  it('denies Bob writing to the Alice deletion journal', async () => {
    const db = verified(env, BOB).firestore();
    // Forging a journal entry would misrepresent the state of someone else's
    // account deletion; clearing one would hide an unfinished deletion.
    await assertFails(setDoc(doc(db, `users/${ALICE}/deletion/status`), { startedAt: 1 }));
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/deletion/status`)));
  });

  it('denies Bob creating a backup summary under Alice', async () => {
    const db = verified(env, BOB).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/backups/planted`), {
        id: 'planted', createdAt: 1, sizeBytes: 1, recordCount: 1, appName: 'Net Worth',
      }),
    );
  });

  it('denies Bob touching Alice backups, devices, settings or deletion journal', async () => {
    const db = verified(env, BOB).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}/backups/backup-1`)));
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/backups/backup-1`)));
    await assertFails(getDoc(doc(db, `users/${ALICE}/devices/d1`)));
    await assertFails(setDoc(doc(db, `users/${ALICE}/settings/s1`), { theme: 'dark' }));
    await assertFails(getDoc(doc(db, `users/${ALICE}/deletion/status`)));
  });
});

describe('owner access', () => {
  it('allows a verified owner to create, read and delete a record', async () => {
    const db = verified(env, ALICE).firestore();
    await assertSucceeds(
      setDoc(doc(db, `users/${ALICE}/assets/a1`), { ...record('a1'), updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(getDoc(doc(db, `users/${ALICE}/assets/a1`)));
    await assertSucceeds(getDocs(collection(db, `users/${ALICE}/assets`)));
    await assertSucceeds(deleteDoc(doc(db, `users/${ALICE}/assets/a1`)));
  });

  it('allows the owner to read but not write when the address is unverified', async () => {
    await seedRecord(ALICE, 'assets', 'a1');
    const db = unverified(env, ALICE).firestore();
    await assertSucceeds(getDoc(doc(db, `users/${ALICE}/assets/a1`)));
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/assets/a2`), { ...record('a2'), updatedAt: serverTimestamp() }),
    );
  });
});

describe('record shape', () => {
  it('rejects a client-chosen updatedAt', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/assets/a1`), { ...record('a1'), updatedAt: 4102444800000 }),
    );
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/assets/a1`), {
        ...record('a1'), updatedAt: new Date('2999-01-01'),
      }),
    );
  });

  it('rejects an id that does not match the document path', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/assets/a1`), {
        ...record('somewhere-else'), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a non-positive revision', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/assets/a1`), {
        ...record('a1', { revision: 0 }), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a revision moving backwards', async () => {
    await seedRecord(ALICE, 'assets', 'a1', { revision: 5 });
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/assets/a1`), {
        ...record('a1', { revision: 4 }), updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(db, `users/${ALICE}/assets/a1`), {
        ...record('a1', { revision: 6 }), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('refuses to resurrect a tombstone', async () => {
    await seedRecord(ALICE, 'assets', 'a1', { deletedAt: new Date() });
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/assets/a1`), {
        ...record('a1', { revision: 2, deletedAt: null }), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects an unknown collection name', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/attacker-chosen/a1`), {
        ...record('a1'), updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(getDoc(doc(db, `users/${ALICE}/attacker-chosen/a1`)));
  });
});

describe('profile fields', () => {
  it('allows only displayName', async () => {
    const db = verified(env, ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, `users/${ALICE}`), { displayName: 'Alice' }));
    await assertFails(setDoc(doc(db, `users/${ALICE}`), { displayName: 'Alice', role: 'admin' }));
    await assertFails(setDoc(doc(db, `users/${ALICE}`), { plan: 'premium' }));
    await assertFails(setDoc(doc(db, `users/${ALICE}`), { displayName: 42 }));
  });

  it('never allows listing the users collection', async () => {
    await assertFails(getDocs(collection(verified(env, ALICE).firestore(), 'users')));
  });
});

describe('backup metadata', () => {
  const summary = { id: 'abc123', createdAt: 1, sizeBytes: 10, recordCount: 2, appName: 'Net Worth' };

  it('accepts a well-formed summary from the owner', async () => {
    const db = verified(env, ALICE).firestore();
    await assertSucceeds(setDoc(doc(db, `users/${ALICE}/backups/abc123`), summary));
  });

  it('rejects a summary carrying record content', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/backups/abc123`), { ...summary, records: [{ value: 1 }] }),
    );
  });

  it('rejects an id that is not a safe filename', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/backups/has spaces`), { ...summary, id: 'has spaces' }),
    );
  });

  it('refuses to update a backup summary the owner owns', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${ALICE}/backups/abc123`), summary);
    });
    const db = verified(env, ALICE).firestore();
    // A summary is immutable once written: its counts describe an object in
    // Storage that itself cannot be replaced.
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/backups/abc123`), { ...summary, recordCount: 99 }),
    );
  });

  it('refuses to overwrite an existing backup summary', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), `users/${ALICE}/backups/abc123`), summary);
    });
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, `users/${ALICE}/backups/abc123`), { ...summary, recordCount: 999 }),
    );
  });
});

describe('collection group queries', () => {
  // The usual way a path-scoped ruleset leaks: a collection group query is not
  // evaluated against `/users/{uid}/...`, so it must be denied outright.
  beforeEach(async () => {
    await seedRecord(ALICE, 'assets', 'a1');
    await seedRecord(BOB, 'assets', 'b1');
  });

  it('denies a collection group query over records', async () => {
    await assertFails(getDocs(collectionGroup(verified(env, ALICE).firestore(), 'assets')));
    await assertFails(getDocs(collectionGroup(verified(env, BOB).firestore(), 'assets')));
  });

  it('denies a collection group query over backups and secondary collections', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(getDocs(collectionGroup(db, 'backups')));
    await assertFails(getDocs(collectionGroup(db, 'devices')));
    await assertFails(getDocs(collectionGroup(db, 'deletion')));
  });

  it('denies a collection group query to an unauthenticated caller', async () => {
    await assertFails(getDocs(collectionGroup(env.unauthenticatedContext().firestore(), 'assets')));
  });
});

describe('token claims', () => {
  it('denies a record write when the token carries no email_verified claim', async () => {
    // A custom or provider token may omit the claim entirely. That must be a
    // denial decision, not an evaluation error.
    const db = env.authenticatedContext('claimless-uid', {}).firestore();
    await assertFails(
      setDoc(doc(db, 'users/claimless-uid/assets/a1'), {
        ...record('a1'), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('still allows a claimless owner to read and delete their own records', async () => {
    await seedRecord('claimless-uid', 'assets', 'a1');
    const db = env.authenticatedContext('claimless-uid', {}).firestore();
    await assertSucceeds(getDoc(doc(db, 'users/claimless-uid/assets/a1')));
    await assertSucceeds(deleteDoc(doc(db, 'users/claimless-uid/assets/a1')));
  });
});

describe('paths closed to every client', () => {
  it('denies the owner reading or writing device verifications', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}/deviceVerifications/device-1`)));
    await assertFails(setDoc(doc(db, `users/${ALICE}/deviceVerifications/device-1`), { status: 'verified' }));
  });

  it('denies the owner reading or writing recovery-code hashes', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}/recoveryCodes/c1`)));
    await assertFails(setDoc(doc(db, `users/${ALICE}/recoveryCodes/c1`), { digest: 'x' }));
  });

  it('denies access to anything outside the modelled tree', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(getDoc(doc(db, 'admin/config')));
    await assertFails(setDoc(doc(db, 'admin/config'), { open: true }));
  });
});

/**
 * P0-9. Ownership, role and entitlement state is decided by the token and by a
 * trusted server; a client that can write those names into its own document
 * can later be mistaken for privileged by any code that reads them back. The
 * domain record model stays open-ended, so this is a denylist rather than an
 * allowlist — every field below is refused on every user-controlled surface.
 */
const RESERVED = [
  'ownerId',
  'userId',
  'uid',
  'isAdmin',
  'admin',
  'role',
  'roles',
  'permissions',
  'entitlements',
  'plan',
  'claims',
  'isVerified',
  'emailVerified',
  'createdBy',
] as const;

/** What an attacker would actually put there, rather than a placeholder. */
const HOSTILE: Record<(typeof RESERVED)[number], unknown> = {
  ownerId: BOB,
  userId: BOB,
  uid: BOB,
  isAdmin: true,
  admin: true,
  role: 'admin',
  roles: ['admin', 'owner'],
  permissions: ['*'],
  entitlements: ['pro'],
  plan: 'enterprise',
  claims: { admin: true },
  isVerified: true,
  emailVerified: true,
  createdBy: BOB,
};

describe('reserved security fields', () => {
  describe('domain records', () => {
    it.each(RESERVED)('denies "%s" on create', async (field) => {
      const db = verified(env, ALICE).firestore();
      await assertFails(
        setDoc(doc(db, `users/${ALICE}/assets/a1`), {
          ...record('a1', { [field]: HOSTILE[field] }),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it.each(RESERVED)('denies "%s" on update', async (field) => {
      await seedRecord(ALICE, 'assets', 'a1');
      const db = verified(env, ALICE).firestore();
      await assertFails(
        setDoc(doc(db, `users/${ALICE}/assets/a1`), {
          ...record('a1', { revision: 2, [field]: HOSTILE[field] }),
          updatedAt: serverTimestamp(),
        }),
      );
    });
  });

  describe('devices', () => {
    it.each(RESERVED)('denies "%s" on create', async (field) => {
      const db = verified(env, ALICE).firestore();
      await assertFails(
        setDoc(doc(db, `users/${ALICE}/devices/d1`), {
          name: 'Pixel 8',
          [field]: HOSTILE[field],
        }),
      );
    });

    it.each(RESERVED)('denies "%s" on update', async (field) => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), `users/${ALICE}/devices/d1`), { name: 'Pixel 8' });
      });
      const db = verified(env, ALICE).firestore();
      await assertFails(
        setDoc(doc(db, `users/${ALICE}/devices/d1`), {
          name: 'Pixel 8',
          [field]: HOSTILE[field],
        }),
      );
    });
  });

  describe('settings', () => {
    it.each(RESERVED)('denies "%s" on create', async (field) => {
      const db = verified(env, ALICE).firestore();
      await assertFails(
        setDoc(doc(db, `users/${ALICE}/settings/app`), {
          theme: 'dark',
          [field]: HOSTILE[field],
        }),
      );
    });

    it.each(RESERVED)('denies "%s" on update', async (field) => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), `users/${ALICE}/settings/app`), { theme: 'dark' });
      });
      const db = verified(env, ALICE).firestore();
      await assertFails(
        setDoc(doc(db, `users/${ALICE}/settings/app`), {
          theme: 'dark',
          [field]: HOSTILE[field],
        }),
      );
    });
  });

  // No deny-rule is complete without a positive test. Two things have to stay
  // true: the ordinary write still works, and the match is on the whole key —
  // a denylist that caught substrings would break every legitimate field whose
  // name merely contains one of these words.
  describe('legitimate writes still succeed', () => {
    it('allows an ordinary record on create and update', async () => {
      // After X-2 an ordinary record is metadata plus a sealed payload; the
      // domain fields this used to carry now live inside `enc`.
      const db = verified(env, ALICE).firestore();
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}/assets/a1`), {
          ...record('a1'),
          updatedAt: serverTimestamp(),
        }),
      );
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}/assets/a1`), {
          ...record('a1', { revision: 2, enc: envelope({ ct: 'BBBBBBBBBBBBBBBBBBBB' }) }),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it('still allows names merely containing a reserved word where a denylist applies', async () => {
      // Record collections now use an allowlist, so this case moved to the
      // paths that still use `hasNoReservedFields` as their only field check.
      // The denylist must keep matching whole keys rather than substrings.
      const db = verified(env, ALICE).firestore();
      for (const path of [`users/${ALICE}/devices/d1`, `users/${ALICE}/settings/s1`]) {
        await assertSucceeds(
          setDoc(doc(db, path), {
            userIdentifier: 'not-a-uid',
            planName: 'Retirement plan',
            roleDescription: 'primary residence',
            adminNotes: 'reviewed',
            permissionsNote: 'n/a',
          }),
        );
      }
    });

    it('allows an ordinary device document and still allows deleting it', async () => {
      const db = verified(env, ALICE).firestore();
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}/devices/d1`), { name: 'Pixel 8', lastSeenAt: 1 }),
      );
      await assertSucceeds(deleteDoc(doc(db, `users/${ALICE}/devices/d1`)));
    });

    it('allows an ordinary settings document and still allows deleting it', async () => {
      const db = verified(env, ALICE).firestore();
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}/settings/app`), { theme: 'dark', currency: 'INR' }),
      );
      await assertSucceeds(deleteDoc(doc(db, `users/${ALICE}/settings/app`)));
    });

    it('still lets the owner read devices and settings', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), `users/${ALICE}/devices/d1`), { name: 'Pixel 8' });
        await setDoc(doc(context.firestore(), `users/${ALICE}/settings/app`), { theme: 'dark' });
      });
      const db = verified(env, ALICE).firestore();
      await assertSucceeds(getDoc(doc(db, `users/${ALICE}/devices/d1`)));
      await assertSucceeds(getDoc(doc(db, `users/${ALICE}/settings/app`)));
    });
  });

  // The new field check must not become the only thing standing between Bob
  // and Alice's data: a clean document from the wrong user is still refused.
  describe('ownership is still enforced independently', () => {
    it('denies Bob a reserved-field-free write to Alice devices and settings', async () => {
      const db = verified(env, BOB).firestore();
      await assertFails(setDoc(doc(db, `users/${ALICE}/devices/d1`), { name: 'Planted' }));
      await assertFails(setDoc(doc(db, `users/${ALICE}/settings/app`), { theme: 'dark' }));
      await assertFails(
        setDoc(doc(db, `users/${ALICE}/assets/a1`), {
          ...record('a1', { name: 'Planted' }),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it('denies an unverified owner a reserved-field-free record write', async () => {
      const db = unverified(env, ALICE).firestore();
      await assertFails(
        setDoc(doc(db, `users/${ALICE}/assets/a1`), {
          ...record('a1', { name: 'Savings' }),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it('still denies collection group queries over every user-controlled path', async () => {
      const db = verified(env, ALICE).firestore();
      await assertFails(getDocs(collectionGroup(db, 'assets')));
      await assertFails(getDocs(collectionGroup(db, 'devices')));
      await assertFails(getDocs(collectionGroup(db, 'settings')));
    });
  });
});

/**
 * Gate 4: the pairing relay.
 *
 * The relay carries public material and one ciphertext. The rules enforce the
 * state machine as append-only fields, which is what makes replay and rewrite
 * impossible rather than merely discouraged — and there is no verdict field for
 * a client to forge, because on Spark no server could adjudicate one.
 */
describe('pairing relay', () => {
  const SID = 'session-abc123';
  const PATH = `users/${ALICE}/pairing/${SID}`;
  const TTL = 5 * 60 * 1000;

  function offer(extra: Record<string, unknown> = {}) {
    return {
      id: SID,
      version: 1,
      appName: 'networth',
      commitment: 'Y29tbWl0bWVudA==',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      expiresAt: Date.now() + TTL,
      ...extra,
    };
  }

  /** A session already on the relay, written past the rules. */
  async function seed(extra: Record<string, unknown> = {}, expiresAt = Date.now() + TTL) {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), PATH), {
        id: SID, version: 1, appName: 'networth', commitment: 'Y29tbWl0bWVudA==',
        createdAt: new Date(0), updatedAt: new Date(0), expiresAt, ...extra,
      });
    });
  }

  const WRAPPED = { v: 1, alg: 'AES-GCM', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAA' };

  describe('owner', () => {
    it('creates, reads and abandons a session', async () => {
      const db = verified(env, ALICE).firestore();
      await assertSucceeds(setDoc(doc(db, PATH), offer()));
      await assertSucceeds(getDoc(doc(db, PATH)));
      await assertSucceeds(deleteDoc(doc(db, PATH)));
    });

    it('walks the whole protocol', async () => {
      await seed();
      const db = verified(env, ALICE).firestore();
      // Responder publishes its key. Exactly what FirebasePairingRelay sends:
      // the new field and the server clock, never the immutable core.
      await assertSucceeds(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), responderPublicKey: 'cmVzcG9uZGVy',
      }, { merge: true }));
      // Initiator opens the commitment.
      await assertSucceeds(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), initiatorPublicKey: 'aW5pdGlhdG9y',
      }, { merge: true }));
      // Initiator publishes the wrapped key.
      await assertSucceeds(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), wrapped: WRAPPED,
      }, { merge: true }));
      // Responder marks it spent.
      await assertSucceeds(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), consumedAt: serverTimestamp(),
      }, { merge: true }));
    });

    it('denies listing pairing sessions', async () => {
      await seed();
      const db = verified(env, ALICE).firestore();
      await assertFails(getDocs(collection(db, `users/${ALICE}/pairing`)));
      await assertFails(getDocs(collectionGroup(db, 'pairing')));
    });
  });

  describe('non-owner', () => {
    it('denies Bob everything', async () => {
      await seed();
      const db = verified(env, BOB).firestore();
      await assertFails(getDoc(doc(db, PATH)));
      await assertFails(setDoc(doc(db, PATH), offer()));
      await assertFails(deleteDoc(doc(db, PATH)));
      await assertFails(setDoc(doc(db, `users/${ALICE}/pairing/other`), offer({ id: 'other' })));
    });

    it('denies an unauthenticated client', async () => {
      await seed();
      const db = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, PATH)));
      await assertFails(setDoc(doc(db, PATH), offer()));
    });
  });

  describe('the offer', () => {
    it('denies a mismatched id, wrong version or client clock', async () => {
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, `users/${ALICE}/pairing/other`), offer()));
      await assertFails(setDoc(doc(db, PATH), offer({ version: 2 })));
      await assertFails(setDoc(doc(db, PATH), offer({ createdAt: new Date(0) })));
    });

    it('denies an expiry that is absent, past, or unboundedly far away', async () => {
      const db = verified(env, ALICE).firestore();
      const bad: Array<Record<string, unknown>> = [
        { expiresAt: Date.now() - 1000 },
        { expiresAt: Date.now() + 24 * 60 * 60 * 1000 },
        { expiresAt: '5 minutes' },
      ];
      for (const extra of bad) {
        await assertFails(setDoc(doc(db, PATH), offer(extra)), JSON.stringify(extra));
      }
      const partial = offer();
      delete (partial as Record<string, unknown>).expiresAt;
      await assertFails(setDoc(doc(db, PATH), partial));
    });

    it('denies publishing a public key in the offer itself', async () => {
      // The commitment must come first; a key in the offer defeats it.
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), offer({ initiatorPublicKey: 'aW5pdA==' })));
    });

    it('denies any extra field, including a verdict', async () => {
      const db = verified(env, ALICE).firestore();
      for (const extra of [
        { verified: true }, { status: 'verified' }, { trusted: true },
        { dek: 'AAAA' }, { transportKey: 'AAAA' }, { note: 'hi' },
      ]) {
        await assertFails(setDoc(doc(db, PATH), offer(extra)), JSON.stringify(extra));
      }
    });

    it('denies reserved authorization fields', async () => {
      const db = verified(env, ALICE).firestore();
      for (const reserved of [{ uid: ALICE }, { role: 'admin' }, { isAdmin: true }]) {
        await assertFails(setDoc(doc(db, PATH), offer(reserved)));
      }
    });
  });

  describe('append-only progression', () => {
    it('denies rewriting a public key once published', async () => {
      await seed({ responderPublicKey: 'cmVzcG9uZGVy', initiatorPublicKey: 'aW5pdGlhdG9y' });
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), responderPublicKey: 'ZGlmZmVyZW50',
      }, { merge: true }));
      await assertFails(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), initiatorPublicKey: 'ZGlmZmVyZW50',
      }, { merge: true }));
    });

    it('denies rewriting the commitment, which is the MITM detection', async () => {
      await seed();
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), commitment: 'ZGlmZmVyZW50',
      }, { merge: true }));
    });

    it('denies rewriting the wrapped key, or extending the expiry', async () => {
      await seed({ wrapped: WRAPPED });
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), wrapped: { ...WRAPPED, ct: 'QkJCQkJCQkJCQkJC' },
      }, { merge: true }));
      await assertFails(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), expiresAt: Date.now() + 60 * 60 * 1000,
      }, { merge: true }));
    });

    it('denies a malformed wrapped payload', async () => {
      await seed();
      const db = verified(env, ALICE).firestore();
      const bad: unknown[] = [
        { v: 2, alg: 'AES-GCM', iv: 'AA', ct: 'AA' },
        { v: 1, alg: 'AES-CBC', iv: 'AA', ct: 'AA' },
        { v: 1, alg: 'AES-GCM', iv: 42, ct: 'AA' },
        { v: 1, alg: 'AES-GCM', iv: 'AA' },
        { v: 1, alg: 'AES-GCM', iv: 'AA', ct: 'AA', digest: 'abc' },
        'a string',
      ];
      for (const wrapped of bad) {
        await assertFails(
          setDoc(doc(db, PATH), { updatedAt: serverTimestamp(), wrapped }, { merge: true }),
          JSON.stringify(wrapped),
        );
      }
    });
  });

  describe('expiry and single use', () => {
    it('denies advancing an expired session from any state', async () => {
      const db = verified(env, ALICE).firestore();
      for (const extra of [{}, { responderPublicKey: 'cmVzcA==' }, { wrapped: WRAPPED }]) {
        await seed(extra, Date.now() - 1000);
        await assertFails(setDoc(doc(db, PATH), {
          updatedAt: serverTimestamp(), initiatorPublicKey: 'aW5pdA==',
        }, { merge: true }), JSON.stringify(extra));
      }
    });

    it('denies every write once the session is consumed', async () => {
      await seed({ wrapped: WRAPPED, consumedAt: new Date() });
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), initiatorPublicKey: 'aW5pdA==',
      }, { merge: true }));
      await assertFails(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), consumedAt: serverTimestamp(),
      }, { merge: true }));
    });

    it('denies a client-chosen consumption time', async () => {
      await seed({ wrapped: WRAPPED });
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), {
        updatedAt: serverTimestamp(), consumedAt: new Date(0),
      }, { merge: true }));
    });
  });

  it('never accepts a verdict field on update either', async () => {
    await seed({ responderPublicKey: 'cmVzcA==' });
    const db = verified(env, ALICE).firestore();
    for (const extra of [{ verified: true }, { status: 'confirmed' }, { approved: true }]) {
      await assertFails(
        setDoc(doc(db, PATH), { updatedAt: serverTimestamp(), ...extra }, { merge: true }),
        JSON.stringify(extra),
      );
    }
  });
});

/**
 * X-2: record documents must carry the encrypted envelope.
 *
 * This is the tightening `hasNoReservedFields` deferred until the envelope
 * existed. A plaintext domain field is no longer a reserved name to be listed
 * and denied — it simply is not one of the fields a record may have.
 */
describe('encrypted record envelope', () => {
  const PATH = `users/${ALICE}/assets/a1`;

  it('rejects a record with no envelope at all', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, PATH), {
        id: 'a1', revision: 1, deletedAt: null, updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a plaintext domain record, which is the whole point', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, PATH), {
        id: 'a1', revision: 1, deletedAt: null, updatedAt: serverTimestamp(),
        name: 'Savings', amount: 1000,
      }),
    );
  });

  it('rejects a domain field smuggled alongside a valid envelope', async () => {
    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, PATH), {
        ...record('a1', { name: 'Savings' }), updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, PATH), {
        ...record('a1', { amount: 1000 }), updatedAt: serverTimestamp(),
      }),
    );
  });

  it('rejects a malformed envelope', async () => {
    const db = verified(env, ALICE).firestore();
    const bad: Array<Record<string, unknown>> = [
      { v: 2, alg: 'AES-GCM', iv: 'AA', ct: 'AA' },
      { v: 1, alg: 'AES-CBC', iv: 'AA', ct: 'AA' },
      { v: 1, alg: 'AES-GCM', iv: 42, ct: 'AA' },
      { v: 1, alg: 'AES-GCM', iv: 'AA', ct: null },
      { v: 1, alg: 'AES-GCM', iv: 'AA' },
      { v: 1, alg: 'AES-GCM', ct: 'AA' },
      // No room for anything that could verify a guess or leak a hint.
      { v: 1, alg: 'AES-GCM', iv: 'AA', ct: 'AA', digest: 'abc' },
      { v: 1, alg: 'AES-GCM', iv: 'AA', ct: 'AA', hint: 'my cat' },
    ];
    for (const enc of bad) {
      await assertFails(
        setDoc(doc(db, PATH), { ...record('a1'), enc, updatedAt: serverTimestamp() }),
        JSON.stringify(enc),
      );
    }
  });

  it('rejects an envelope that is not a map', async () => {
    const db = verified(env, ALICE).firestore();
    for (const enc of ['a string', 42, null, ['a']]) {
      await assertFails(
        setDoc(doc(db, PATH), { ...record('a1'), enc, updatedAt: serverTimestamp() }),
        String(enc),
      );
    }
  });

  it('rejects an update that strips the envelope from a sealed record', async () => {
    const db = verified(env, ALICE).firestore();
    await assertSucceeds(
      setDoc(doc(db, PATH), { ...record('a1'), updatedAt: serverTimestamp() }),
    );
    await assertFails(
      setDoc(doc(db, PATH), {
        id: 'a1', revision: 2, deletedAt: null, updatedAt: serverTimestamp(),
      }),
    );
  });

  it('still enforces every protection it had before', async () => {
    // The envelope requirement is additive. Ownership, verification, the
    // server clock, the revision floor and the reserved names all still hold.
    const bob = verified(env, BOB).firestore();
    await assertFails(
      setDoc(doc(bob, PATH), { ...record('a1'), updatedAt: serverTimestamp() }),
    );

    const unverifiedAlice = unverified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(unverifiedAlice, PATH), { ...record('a1'), updatedAt: serverTimestamp() }),
    );

    const db = verified(env, ALICE).firestore();
    await assertFails(
      setDoc(doc(db, PATH), { ...record('a1'), updatedAt: new Date(0) }),
    );
    await assertFails(
      setDoc(doc(db, PATH), { ...record('a1', { role: 'admin' }), updatedAt: serverTimestamp() }),
    );
    await assertFails(
      setDoc(doc(db, PATH), { ...record('a1', { revision: 0 }), updatedAt: serverTimestamp() }),
    );
  });
});

/**
 * Gate 3 recovery escrow.
 *
 * The escrow document is ciphertext plus the metadata needed to open it. It is
 * readable by its owner precisely because it is not a credential: a wrong
 * recovery code fails an authentication tag, not an authorization check, so
 * handing the owner their own wrapped key gives away nothing. That is the whole
 * reason this path can be open while `recoveryCodes`, which holds hashes a
 * client could compare against, stays closed.
 */
describe('recovery escrow', () => {
  const ID = 'current';
  const PATH = `users/${ALICE}/recoveryEscrow/${ID}`;

  /** A well-formed escrow document as the client writes it. */
  function escrow(extra: Record<string, unknown> = {}) {
    return {
      id: ID,
      version: 1,
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: 210_000,
      salt: 'c2FsdA==',
      iv: 'aXZpdml2aXZpdg==',
      wrappedKey: 'd3JhcHBlZA==',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...extra,
    };
  }

  async function seedEscrow() {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), PATH), {
        ...escrow(),
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
    });
  }

  describe('owner', () => {
    it('allows creating, reading and deleting their own escrow', async () => {
      const db = verified(env, ALICE).firestore();
      await assertSucceeds(setDoc(doc(db, PATH), escrow()));
      await assertSucceeds(getDoc(doc(db, PATH)));
      await assertSucceeds(deleteDoc(doc(db, PATH)));
    });

    it('allows re-escrowing under a new recovery code', async () => {
      await seedEscrow();
      const db = verified(env, ALICE).firestore();
      await assertSucceeds(
        setDoc(doc(db, PATH), {
          ...escrow({ wrappedKey: 'ZGlmZmVyZW50', salt: 'bmV3c2FsdA==' }),
          createdAt: new Date(0),
        }),
      );
    });

    it('is allowed even without a verified email, because recovery precedes it', async () => {
      // A user recovering an account may not be able to reach their mail. The
      // escrow is theirs and is not a financial write.
      const db = unverified(env, ALICE).firestore();
      await assertSucceeds(setDoc(doc(db, PATH), escrow()));
    });

    it('denies rewriting createdAt on update', async () => {
      await seedEscrow();
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), escrow()));
    });

    it('denies a client-chosen updatedAt', async () => {
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), escrow({ updatedAt: new Date(0) })));
    });

    it('denies listing the escrow collection', async () => {
      await seedEscrow();
      const db = verified(env, ALICE).firestore();
      await assertFails(getDocs(collection(db, `users/${ALICE}/recoveryEscrow`)));
    });

    it('denies a collection group query across every user escrow', async () => {
      await seedEscrow();
      const db = verified(env, ALICE).firestore();
      await assertFails(getDocs(collectionGroup(db, 'recoveryEscrow')));
    });
  });

  describe('non-owner', () => {
    it('denies Bob reading, writing or deleting Alice escrow', async () => {
      await seedEscrow();
      const db = verified(env, BOB).firestore();
      await assertFails(getDoc(doc(db, PATH)));
      await assertFails(setDoc(doc(db, PATH), escrow()));
      await assertFails(deleteDoc(doc(db, PATH)));
    });

    it('denies an unauthenticated client entirely', async () => {
      await seedEscrow();
      const db = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, PATH)));
      await assertFails(setDoc(doc(db, PATH), escrow()));
    });
  });

  describe('schema', () => {
    it('denies a document id that does not match the field', async () => {
      const db = verified(env, ALICE).firestore();
      await assertFails(
        setDoc(doc(db, `users/${ALICE}/recoveryEscrow/other`), escrow()),
      );
    });

    it('denies a missing required field', async () => {
      const db = verified(env, ALICE).firestore();
      for (const field of ['id', 'version', 'algorithm', 'kdf', 'iterations',
                           'salt', 'iv', 'wrappedKey', 'updatedAt']) {
        const partial = escrow();
        delete (partial as Record<string, unknown>)[field];
        await assertFails(setDoc(doc(db, PATH), partial));
      }
    });

    it('denies a wrong version or algorithm', async () => {
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), escrow({ version: 2 })));
      await assertFails(setDoc(doc(db, PATH), escrow({ algorithm: 'AES-CBC' })));
      await assertFails(setDoc(doc(db, PATH), escrow({ kdf: 'scrypt' })));
    });

    it('denies a KDF cost the client would later refuse to read', async () => {
      const db = verified(env, ALICE).firestore();
      for (const iterations of [0, 1, 99_999, 1_000_001]) {
        await assertFails(setDoc(doc(db, PATH), escrow({ iterations })));
      }
      await assertSucceeds(setDoc(doc(db, PATH), escrow({ iterations: 100_000 })));
    });

    it('denies wrongly typed fields', async () => {
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), escrow({ iterations: '210000' })));
      await assertFails(setDoc(doc(db, PATH), escrow({ salt: 42 })));
      await assertFails(setDoc(doc(db, PATH), escrow({ wrappedKey: null })));
      await assertFails(setDoc(doc(db, PATH), escrow({ iv: ['a'] })));
    });

    it('denies an oversized wrapped key', async () => {
      const db = verified(env, ALICE).firestore();
      await assertFails(setDoc(doc(db, PATH), escrow({ wrappedKey: 'A'.repeat(4097) })));
    });

    it('denies any extra field, which is where a verification oracle would arrive', async () => {
      // The specific danger: a digest of the key or the code would let anyone
      // holding this document test candidate codes without paying for a key
      // derivation. An allowlist refuses the whole category, not one name.
      const db = verified(env, ALICE).firestore();
      for (const extra of [
        { dekHash: 'abc' },
        { checksum: 'abc' },
        { recoveryCode: 'K7QM-2XPD-9RTF' },
        { verifier: 'abc' },
        { hint: 'my cat' },
      ]) {
        await assertFails(setDoc(doc(db, PATH), escrow(extra)));
      }
    });

    it('denies reserved authorization fields', async () => {
      const db = verified(env, ALICE).firestore();
      for (const reserved of [{ uid: ALICE }, { role: 'admin' }, { isAdmin: true }]) {
        await assertFails(setDoc(doc(db, PATH), escrow(reserved)));
      }
    });
  });

  it('accepts exactly the document the lifecycle writes, and its update', async () => {
    // The shape FirebaseRecoveryEscrowStore sends: the flattened escrow from
    // toRecoveryEscrowDocument plus the two server timestamps it adds. If the
    // rule and the writer ever disagree, first-time setup fails at the last
    // step and the user is left with no recovery path.
    const db = verified(env, ALICE).firestore();
    const written = {
      id: ID,
      version: 1,
      algorithm: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: 210_000,
      salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
      iv: 'AAAAAAAAAAAAAAAA',
      wrappedKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(db, PATH), written));

    // Re-escrowing under a new code: createdAt carried back unchanged, as the
    // store does by reading the stored value first.
    let storedCreatedAt: unknown;
    await env.withSecurityRulesDisabled(async (context) => {
      storedCreatedAt = (await getDoc(doc(context.firestore(), PATH))).data()?.createdAt;
    });
    expect(storedCreatedAt).toBeDefined();
    await assertSucceeds(
      setDoc(doc(db, PATH), {
        ...written,
        wrappedKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        createdAt: storedCreatedAt,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('leaves the recovery-code hash path closed to its own owner', async () => {
    // Gate 3 did not open this. It is the authentication form, and it still
    // needs a trusted server that Spark does not provide.
    const db = verified(env, ALICE).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}/recoveryCodes/c1`)));
    await assertFails(setDoc(doc(db, `users/${ALICE}/recoveryCodes/c1`), { hash: 'x' }));
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/recoveryCodes/c1`)));
  });
});
