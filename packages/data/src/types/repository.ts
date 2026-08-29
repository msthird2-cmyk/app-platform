import { DataError, DataErrorCode } from '../errors';
import type { QueryOptions, SyncableRecord } from './record';

/**
 * The persistence boundary. Applications inject a concrete implementation
 * (Firestore in production, in-memory in tests) — no component ever knows
 * which one it is talking to.
 */
export interface Repository<T extends object = Record<string, unknown>> {
  get(collection: string, id: string): Promise<SyncableRecord<T> | null>;
  list(collection: string, options?: QueryOptions): Promise<SyncableRecord<T>[]>;
  /**
   * Writes a record and returns it as stored. A remote implementation stamps
   * `updatedAt` with the server clock, so the caller must use the returned
   * record rather than the one it sent, or the two copies never converge.
   */
  put(collection: string, record: SyncableRecord<T>): Promise<SyncableRecord<T>>;
  delete(collection: string, id: string, deletedAt: number): Promise<void>;
  /** Hard-removes every record the signed-in user owns. */
  purgeAll(): Promise<void>;
}

/**
 * The marker that says a repository seals payloads before they are persisted.
 *
 * A `Repository` is an interface, and an interface cannot say *when* the
 * encryption boundary was crossed — `FirebaseRepository` and
 * `EncryptingRepository` satisfy it identically. That is not an academic
 * distinction: handing the raw one to code that thinks it is holding domain
 * objects writes plaintext, and handing it to `runRestore` writes plaintext
 * straight at Firestore. The Security Rules refuse such a document, so the
 * failure is closed rather than silent — but "the server catches it" is not
 * where an architecture should place its only defence.
 *
 * So the boundary becomes a type. Only `EncryptingRepository` carries the
 * marker, callers that must have sealed data ask for `EncryptedRepository`,
 * and the unsafe wiring stops compiling. `Symbol.for` rather than a private
 * symbol so the check still works across two copies of this package in a
 * pnpm workspace.
 */
export const ENCRYPTION_BOUNDARY = Symbol.for('platform.data.encryptionBoundary');

export interface EncryptedRepository<T extends object = Record<string, unknown>>
  extends Repository<T> {
  readonly [ENCRYPTION_BOUNDARY]: true;
}

export function isEncryptedRepository<T extends object = Record<string, unknown>>(
  value: Repository<T>,
): value is EncryptedRepository<T> {
  return (value as Partial<EncryptedRepository<T>>)[ENCRYPTION_BOUNDARY] === true;
}

/**
 * The runtime half of the same rule.
 *
 * The type alone is not enough: a cast, an `any` at a module boundary or a
 * plain JavaScript caller all get past it, and this is the check that would
 * have to hold on the day one of those happens.
 */
export function assertEncryptedRepository<T extends object = Record<string, unknown>>(
  value: Repository<T>,
): asserts value is EncryptedRepository<T> {
  if (!isEncryptedRepository(value)) {
    throw new DataError(DataErrorCode.REPOSITORY_NOT_ENCRYPTING);
  }
}
