import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
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
import { ALICE, BOB, createTestEnvironment, record, unverified, verified } from './helpers';

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
    it('allows an ordinary domain record on create and update', async () => {
      const db = verified(env, ALICE).firestore();
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}/assets/a1`), {
          ...record('a1', { name: 'Savings', amount: 1000 }),
          updatedAt: serverTimestamp(),
        }),
      );
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}/assets/a1`), {
          ...record('a1', { revision: 2, name: 'Savings', amount: 2000 }),
          updatedAt: serverTimestamp(),
        }),
      );
    });

    it('allows domain fields whose names merely contain a reserved word', async () => {
      const db = verified(env, ALICE).firestore();
      await assertSucceeds(
        setDoc(doc(db, `users/${ALICE}/assets/a2`), {
          ...record('a2', {
            userIdentifier: 'not-a-uid',
            planName: 'Retirement plan',
            roleDescription: 'primary residence',
            adminNotes: 'reviewed',
            permissionsNote: 'n/a',
          }),
          updatedAt: serverTimestamp(),
        }),
      );
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

  it('leaves the recovery-code hash path closed to its own owner', async () => {
    // Gate 3 did not open this. It is the authentication form, and it still
    // needs a trusted server that Spark does not provide.
    const db = verified(env, ALICE).firestore();
    await assertFails(getDoc(doc(db, `users/${ALICE}/recoveryCodes/c1`)));
    await assertFails(setDoc(doc(db, `users/${ALICE}/recoveryCodes/c1`), { hash: 'x' }));
    await assertFails(deleteDoc(doc(db, `users/${ALICE}/recoveryCodes/c1`)));
  });
});
