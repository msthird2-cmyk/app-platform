import {
  assertRecordEnvelope,
  decryptRecordPayload,
  encryptRecordPayload,
  SecurityError,
  SecurityErrorCode,
  type RecordCipher,
  type RecordEnvelope,
} from '@platform/security';
import { ENCRYPTION_BOUNDARY, type EncryptedRepository, type Repository } from '../types/repository';
import type { QueryOptions, SyncableRecord } from '../types/record';

/**
 * The encryption boundary.
 *
 * A `Repository` that wraps another one and seals the domain payload on the way
 * down, opening it on the way back. Everything below this object sees
 * ciphertext and sync metadata; everything above it sees ordinary records. The
 * concrete repositories — Firestore, in-memory — are untouched and know nothing
 * about encryption, which is what keeps a plaintext field from reaching a
 * persistence call by accident: there is no code path from a domain object to
 * `FirebaseRepository.put` that does not pass through here.
 *
 * A decorator rather than changes inside `FirebaseRepository` for three
 * reasons: the in-memory repository gets the same guarantees in tests, the
 * Firebase package keeps its "types only" import rule from `@platform/security`,
 * and a later sync engine wraps the same boundary without touching the format.
 */

/** The metadata the sync engine and the Security Rules read, which stays clear. */
const METADATA_KEYS = ['id', 'updatedAt', 'revision', 'deletedAt'] as const;

/** Where the sealed payload lives on the stored document. */
export const ENCRYPTED_FIELD = 'enc';

interface StoredShape {
  id: string;
  updatedAt: number;
  revision: number;
  deletedAt: number | null;
  [ENCRYPTED_FIELD]: RecordEnvelope;
}

/**
 * Supplies the data encryption key for the signed-in user.
 *
 * Deliberately a function rather than a key: the key can become unavailable
 * between one operation and the next — a keystore invalidated by a lock-screen
 * change is the case Gate 2 exists for — and every operation must find that out
 * rather than reuse a copy captured at construction.
 */
export type DataKeySource = () => Promise<Uint8Array | null>;

export interface EncryptingRepositoryOptions {
  inner: Repository;
  cipher: RecordCipher;
  dataKey: DataKeySource;
  userId: string;
  appName: string;
}

function splitMetadata(record: SyncableRecord): {
  metadata: Omit<StoredShape, typeof ENCRYPTED_FIELD>;
  payload: Record<string, unknown>;
} {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!(METADATA_KEYS as readonly string[]).includes(key)) payload[key] = value;
  }
  return {
    metadata: {
      id: record.id,
      updatedAt: record.updatedAt,
      revision: record.revision,
      deletedAt: record.deletedAt,
    },
    payload,
  };
}

export class EncryptingRepository<T extends object = Record<string, unknown>>
  implements EncryptedRepository<T>
{
  /**
   * The marker that distinguishes this from the repository it wraps.
   *
   * Declared on the class rather than attached afterwards, so there is no
   * moment at which an instance exists without it and no way to forge one
   * except by writing the symbol deliberately.
   */
  readonly [ENCRYPTION_BOUNDARY] = true as const;

  constructor(private readonly options: EncryptingRepositoryOptions) {}

  private async key(): Promise<Uint8Array> {
    const dataKey = await this.options.dataKey();
    // Fails closed. Nothing here creates a key, and nothing here writes or
    // reads a record without one — a repository that quietly stored plaintext
    // when the key was missing would make the whole scheme decorative.
    if (dataKey === null) throw new SecurityError(SecurityErrorCode.DATA_KEY_UNAVAILABLE);
    return dataKey;
  }

  private context(collection: string, recordId: string) {
    return {
      userId: this.options.userId,
      appName: this.options.appName,
      collection,
      recordId,
    };
  }

  private async seal(collection: string, record: SyncableRecord<T>): Promise<StoredShape> {
    const { metadata, payload } = splitMetadata(record as SyncableRecord);
    const envelope = await encryptRecordPayload(
      payload,
      await this.key(),
      this.context(collection, record.id),
      this.options.cipher,
    );
    return { ...metadata, [ENCRYPTED_FIELD]: envelope };
  }

  private async open(collection: string, stored: SyncableRecord): Promise<SyncableRecord<T>> {
    const envelope = (stored as unknown as Partial<StoredShape>)[ENCRYPTED_FIELD];
    if (envelope === undefined || envelope === null) {
      // Not "an old plaintext record we should pass through". There is no
      // plaintext read path, by design: a document without an envelope is
      // either from before encryption or from somebody else, and neither is
      // something to hand back as if it were the user's data.
      throw new SecurityError(SecurityErrorCode.RECORD_NOT_ENCRYPTED);
    }
    assertRecordEnvelope(envelope);
    const payload = await decryptRecordPayload(
      envelope,
      await this.key(),
      this.context(collection, stored.id),
      this.options.cipher,
    );
    return {
      ...(payload as T),
      id: stored.id,
      updatedAt: stored.updatedAt,
      revision: stored.revision,
      deletedAt: stored.deletedAt,
    } as SyncableRecord<T>;
  }

  async get(collection: string, id: string): Promise<SyncableRecord<T> | null> {
    const stored = await this.options.inner.get(collection, id);
    return stored === null ? null : this.open(collection, stored);
  }

  /**
   * One unreadable record fails the whole read.
   *
   * The alternative — dropping it and returning the rest — would make a
   * tampered or key-mismatched record look like a deleted one, and a user
   * would see a shorter list with no indication anything was wrong.
   */
  async list(collection: string, options?: QueryOptions): Promise<SyncableRecord<T>[]> {
    const stored = await this.options.inner.list(collection, options);
    const opened: SyncableRecord<T>[] = [];
    for (const record of stored) opened.push(await this.open(collection, record));
    return opened;
  }

  async put(collection: string, record: SyncableRecord<T>): Promise<SyncableRecord<T>> {
    const sealed = await this.seal(collection, record);
    const stored = await this.options.inner.put(
      collection,
      sealed as unknown as SyncableRecord,
    );
    // The inner repository returns what the server actually stored, including
    // its own clock. Reopening keeps the caller converged on that rather than
    // on what it sent.
    return this.open(collection, stored);
  }

  /** A tombstone touches no payload, so it passes straight through. */
  async delete(collection: string, id: string, deletedAt: number): Promise<void> {
    await this.options.inner.delete(collection, id, deletedAt);
  }

  async purgeAll(): Promise<void> {
    await this.options.inner.purgeAll();
  }
}
