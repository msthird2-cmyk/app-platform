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
  });
}

/**
 * A sealed record envelope, shaped exactly as `EncryptingRepository` writes it.
 * The values are obviously fake; the rules only check shape.
 */
export function envelope(extra: Record<string, unknown> = {}) {
  return { v: 1, alg: 'AES-GCM', iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAA', ...extra };
}

/**
 * A record as the repository writes it after X-2: sync metadata and a sealed
 * payload, with a server timestamp placeholder. Domain fields do not appear
 * because they are inside `enc`.
 */
export function record(id: string, extra: Record<string, unknown> = {}) {
  return { id, revision: 1, deletedAt: null, enc: envelope(), ...extra };
}
