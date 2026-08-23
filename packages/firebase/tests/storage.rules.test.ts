import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { getBytes, ref, uploadString, deleteObject, listAll } from 'firebase/storage';
import { ALICE, BOB, createTestEnvironment, verified } from './helpers';

let env: RulesTestEnvironment;

const JSON_META = { contentType: 'application/json' };
const BUNDLE = JSON.stringify({ schemaVersion: 1, payload: { ciphertext: 'x' } });

beforeAll(async () => {
  env = await createTestEnvironment();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearStorage();
});

async function seedBackup(uid: string, name: string) {
  await env.withSecurityRulesDisabled(async (context) => {
    await uploadString(ref(context.storage(), `users/${uid}/backups/${name}`), BUNDLE, 'raw', JSON_META);
  });
}

describe('owner access', () => {
  it('allows upload, download and delete of a well-formed backup', async () => {
    const storage = verified(env, ALICE).storage();
    const target = ref(storage, `users/${ALICE}/backups/abc123.json`);
    await assertSucceeds(uploadString(target, BUNDLE, 'raw', JSON_META));
    await assertSucceeds(getBytes(target));
    await assertSucceeds(deleteObject(target));
  });

  // Account deletion enumerates this prefix before removing each object. A
  // rule that denies the owner here strands every backup in Storage, and a
  // suite made only of cross-user denials cannot tell that apart from a
  // correct rule — so these assert the allow side explicitly.
  it('allows the owner to list their own backup prefix', async () => {
    await seedBackup(ALICE, 'abc123.json');
    const storage = verified(env, ALICE).storage();
    await assertSucceeds(listAll(ref(storage, `users/${ALICE}/backups`)));
  });

  it('allows the owner to enumerate their own backups', async () => {
    await seedBackup(ALICE, 'one.json');
    await seedBackup(ALICE, 'two.json');
    const storage = verified(env, ALICE).storage();
    const listing = await listAll(ref(storage, `users/${ALICE}/backups`));
    const names = listing.items.map((item) => item.name);
    // Containment rather than equality: the assertion is that enumeration
    // returns the owner's objects, not that the emulator started empty.
    expect(names).toEqual(expect.arrayContaining(['one.json', 'two.json']));
  });

  it('allows the owner to delete a backup they enumerated', async () => {
    await seedBackup(ALICE, 'abc123.json');
    const storage = verified(env, ALICE).storage();
    const listing = await listAll(ref(storage, `users/${ALICE}/backups`));
    for (const item of listing.items) {
      await assertSucceeds(deleteObject(item));
    }
    const after = await listAll(ref(storage, `users/${ALICE}/backups`));
    expect(after.items).toEqual([]);
  });

  it('denies the owner listing one level above their backup prefix', async () => {
    const storage = verified(env, ALICE).storage();
    await assertFails(listAll(ref(storage, `users/${ALICE}`)));
  });
});

describe('cross-user access', () => {
  beforeEach(async () => {
    await seedBackup(ALICE, 'abc123.json');
  });

  it('denies Bob downloading an Alice backup', async () => {
    const storage = verified(env, BOB).storage();
    await assertFails(getBytes(ref(storage, `users/${ALICE}/backups/abc123.json`)));
  });

  it('denies Bob overwriting an Alice backup', async () => {
    const storage = verified(env, BOB).storage();
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/backups/abc123.json`), BUNDLE, 'raw', JSON_META),
    );
  });

  it('denies Bob deleting an Alice backup', async () => {
    const storage = verified(env, BOB).storage();
    await assertFails(deleteObject(ref(storage, `users/${ALICE}/backups/abc123.json`)));
  });

  it('denies Bob listing the Alice backup prefix', async () => {
    const storage = verified(env, BOB).storage();
    await assertFails(listAll(ref(storage, `users/${ALICE}/backups`)));
  });

  it('denies an unauthenticated caller entirely', async () => {
    const storage = env.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(storage, `users/${ALICE}/backups/abc123.json`)));
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/backups/x.json`), BUNDLE, 'raw', JSON_META),
    );
  });

  it('denies an unauthenticated caller listing the backup prefix', async () => {
    const storage = env.unauthenticatedContext().storage();
    await assertFails(listAll(ref(storage, `users/${ALICE}/backups`)));
  });

  it('denies Bob uploading into the Alice backup prefix', async () => {
    const storage = verified(env, BOB).storage();
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/backups/planted.json`), BUNDLE, 'raw', JSON_META),
    );
  });
});

describe('upload constraints', () => {
  it('rejects a filename outside the safe pattern', async () => {
    const storage = verified(env, ALICE).storage();
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/backups/has spaces.json`), BUNDLE, 'raw', JSON_META),
    );
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/backups/nested/deep.json`), BUNDLE, 'raw', JSON_META),
    );
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/backups/notjson.txt`), BUNDLE, 'raw', JSON_META),
    );
  });

  it('rejects a wrong content type', async () => {
    const storage = verified(env, ALICE).storage();
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/backups/abc123.json`), BUNDLE, 'raw', {
        contentType: 'text/html',
      }),
    );
  });

  it('rejects an oversized upload', async () => {
    const storage = verified(env, ALICE).storage();
    const huge = 'a'.repeat(26 * 1024 * 1024);
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/backups/abc123.json`), huge, 'raw', JSON_META),
    );
  });

  it('refuses to overwrite an existing backup', async () => {
    await seedBackup(ALICE, 'abc123.json');
    const storage = verified(env, ALICE).storage();
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/backups/abc123.json`), BUNDLE, 'raw', JSON_META),
    );
  });
});

describe('paths outside the backup prefix', () => {
  it('are closed even to the owner', async () => {
    const storage = verified(env, ALICE).storage();
    await assertFails(
      uploadString(ref(storage, `users/${ALICE}/other/abc123.json`), BUNDLE, 'raw', JSON_META),
    );
    await assertFails(uploadString(ref(storage, 'public/abc123.json'), BUNDLE, 'raw', JSON_META));
  });
});
