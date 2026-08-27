import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DataErrorCode,
  EncryptingRepository,
  InMemoryRepository,
  type Repository,
} from '@platform/data';
import { PortableRecordCipher } from '@platform/security';
import { repositoryForConsumer } from '../src/repositoryAccess';

/**
 * What `useRepository()` is allowed to hand a domain screen.
 *
 * The hook itself cannot be asserted here — this package has no component-test
 * infrastructure, which is the same reason `dataKeyStep` and `pairingStep` are
 * plain functions. What matters is the decision, and the decision is this: a
 * screen either receives the encryption boundary or receives an error. It never
 * receives the store underneath, because a screen holding that writes a user's
 * records in the clear and finds out when Firestore refuses the document.
 */
const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));

function encrypting(): Repository {
  return new EncryptingRepository({
    inner: new InMemoryRepository(),
    cipher: new PortableRecordCipher(randomBytes),
    dataKey: async () => Uint8Array.from({ length: 32 }, (_, i) => i + 1),
    userId: 'alice-uid',
    appName: 'networth',
  });
}

describe('repositoryForConsumer', () => {
  it('hands back the repository that seals payloads', () => {
    const repository = encrypting();
    expect(repositoryForConsumer(repository)).toBe(repository);
  });

  it('refuses the raw store rather than returning it', () => {
    expect(() => repositoryForConsumer(new InMemoryRepository())).toThrowError(
      expect.objectContaining({ code: DataErrorCode.REPOSITORY_NOT_ENCRYPTING }),
    );
  });

  it('refuses anything that merely looks like a repository', () => {
    // The shape a composition root would produce by wiring FirebaseRepository
    // straight into the service container and forgetting the cipher.
    const raw = {
      get: async () => null,
      list: async () => [],
      put: async (_c: string, r: never) => r,
      delete: async () => undefined,
      purgeAll: async () => undefined,
    } as unknown as Repository;
    expect(() => repositoryForConsumer(raw)).toThrowError(
      expect.objectContaining({ code: DataErrorCode.REPOSITORY_NOT_ENCRYPTING }),
    );
  });
});
