import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PortableRecordCipher } from '@platform/security';
import { DataErrorCode } from '../src/errors';
import { EncryptingRepository } from '../src/services/EncryptingRepository';
import { InMemoryRepository } from '../src/services/InMemoryRepository';
import {
  ENCRYPTION_BOUNDARY,
  assertEncryptedRepository,
  isEncryptedRepository,
  type Repository,
} from '../src/types/repository';

/**
 * The boundary as a checkable fact rather than a convention.
 *
 * `Repository` cannot express when payloads were sealed — `FirebaseRepository`
 * and `EncryptingRepository` satisfy it identically — so code that must have
 * sealed data has, until now, had no way to insist. These tests are about the
 * marker that gives it one, and about the runtime check behind it, which is
 * what still holds when a cast or an `any` gets past the compiler.
 */

const randomBytes = (length: number): Uint8Array =>
  webcrypto.getRandomValues(new Uint8Array(length));
const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 5 + 3) % 256);

function encrypting(inner: Repository = new InMemoryRepository()) {
  return new EncryptingRepository({
    inner,
    cipher: new PortableRecordCipher(randomBytes),
    dataKey: async () => KEY,
    userId: 'alice-uid',
    appName: 'networth',
  });
}

describe('the encryption boundary marker', () => {
  it('is carried by the repository that encrypts', () => {
    expect(isEncryptedRepository(encrypting())).toBe(true);
    expect(encrypting()[ENCRYPTION_BOUNDARY]).toBe(true);
  });

  it('is absent from every repository that does not', () => {
    // The two that would write plaintext if handed to domain code.
    expect(isEncryptedRepository(new InMemoryRepository())).toBe(false);
    // A structural impostor: same methods, no marker.
    const impostor = {
      get: async () => null,
      list: async () => [],
      put: async (_c: string, r: never) => r,
      delete: async () => undefined,
      purgeAll: async () => undefined,
    } as unknown as Repository;
    expect(isEncryptedRepository(impostor)).toBe(false);
  });

  it('cannot be faked by a plain truthy field', () => {
    const forged = { ...new InMemoryRepository(), encrypted: true } as unknown as Repository;
    expect(isEncryptedRepository(forged)).toBe(false);
  });

  it('survives the assertion when present and refuses when absent', () => {
    expect(() => assertEncryptedRepository(encrypting())).not.toThrow();
    expect(() => assertEncryptedRepository(new InMemoryRepository())).toThrowError(
      expect.objectContaining({ code: DataErrorCode.REPOSITORY_NOT_ENCRYPTING }),
    );
  });

  it('still marks a repository stacked on another one', () => {
    // Wrapping twice is not a supported configuration, but the marker must
    // follow the outermost object rather than the innermost.
    expect(isEncryptedRepository(encrypting(encrypting()))).toBe(true);
  });
});
