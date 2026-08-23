import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

export const ALICE = 'alice-uid';
export const BOB = 'bob-uid';

/** A verified account — financial writes require one. */
export function verified(env: RulesTestEnvironment, uid: string) {
  return env.authenticatedContext(uid, { email_verified: true });
}

/** Signed in but with an unverified address. */
export function unverified(env: RulesTestEnvironment, uid: string) {
  return env.authenticatedContext(uid, { email_verified: false });
}

export async function createTestEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'app-platform-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8181,
    },
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
}

/** A record as the repository writes it, with a server timestamp placeholder. */
export function record(id: string, extra: Record<string, unknown> = {}) {
  return { id, revision: 1, deletedAt: null, ...extra };
}
