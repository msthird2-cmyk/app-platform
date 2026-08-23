import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
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
