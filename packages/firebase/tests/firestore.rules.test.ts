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
