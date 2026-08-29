import { createId } from '@platform/utils';
import { createRecord, type EncryptedRepository, type SyncableRecord } from '@platform/data';
import type { Asset, Liability } from '../domain/assets';

/**
 * Net Worth's records, read and written through the encryption boundary.
 *
 * Every function here takes an `EncryptedRepository`, not a `Repository`. That
 * is the whole point of the type: this is application code handling domain
 * objects — names, values, what somebody owns — and there is no argument it
 * could be given that would send those fields to persistence in the clear.
 *
 * It also knows nothing about Firestore. The same functions run against the
 * in-memory repository in a preview and against `FirebaseRepository` in
 * production, because both sit *below* the same boundary.
 */

export const ASSETS = 'assets';
export const LIABILITIES = 'liabilities';

/** Tombstones are the sync engine's business, not the dashboard's. */
function live<T extends object>(records: readonly SyncableRecord<T>[]): SyncableRecord<T>[] {
  return records.filter((record) => record.deletedAt === null);
}

/**
 * The repository is generic over an open record shape; these collections hold
 * one known shape each. The conversion is asserted rather than inferred because
 * what comes back has been through a cipher — its runtime shape is whatever was
 * sealed, and the domain types are this application's claim about that. The
 * mappers below then read only the fields they name, so a document carrying
 * something unexpected produces `undefined` in one field rather than leaking an
 * unknown one onward.
 */
function asShape<T extends object>(records: readonly SyncableRecord[]): SyncableRecord<T>[] {
  return records as unknown as SyncableRecord<T>[];
}

function asStored<T extends object>(record: SyncableRecord<T>): SyncableRecord {
  return record as unknown as SyncableRecord;
}

export async function listAssets(repository: EncryptedRepository): Promise<Asset[]> {
  const records = await repository.list(ASSETS);
  return live(asShape<Asset>(records)).map(toAsset);
}

export async function listLiabilities(repository: EncryptedRepository): Promise<Liability[]> {
  const records = await repository.list(LIABILITIES);
  return live(asShape<Liability>(records)).map(toLiability);
}

/**
 * Drops the sync metadata on the way out.
 *
 * The domain types have no `updatedAt` or `revision`, and passing the stored
 * record through unchanged would quietly widen them — which is how a metadata
 * field ends up inside an encrypted payload on the next write.
 */
function toAsset(record: SyncableRecord<Asset>): Asset {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    value: record.value,
    includeInNetWorth: record.includeInNetWorth,
  };
}

function toLiability(record: SyncableRecord<Liability>): Liability {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    outstanding: record.outstanding,
  };
}

export async function saveAsset(
  repository: EncryptedRepository,
  asset: Omit<Asset, 'id'> & { id?: string },
  now: number,
): Promise<Asset> {
  const id = asset.id ?? createId(20);
  const existing = await repository.get(ASSETS, id);
  const payload: Asset = {
    id,
    name: asset.name,
    category: asset.category,
    value: asset.value,
    includeInNetWorth: asset.includeInNetWorth,
  };
  // A new record starts at revision 1; an existing one advances by exactly
  // one, which is what the Security Rules check on the way in.
  const record: SyncableRecord<Asset> =
    existing === null
      ? createRecord(id, payload, now)
      : { ...payload, id, updatedAt: now, revision: existing.revision + 1, deletedAt: null };
  const stored = await repository.put(ASSETS, asStored(record));
  return toAsset(asShape<Asset>([stored])[0] as SyncableRecord<Asset>);
}

export async function saveLiability(
  repository: EncryptedRepository,
  liability: Omit<Liability, 'id'> & { id?: string },
  now: number,
): Promise<Liability> {
  const id = liability.id ?? createId(20);
  const existing = await repository.get(LIABILITIES, id);
  const payload: Liability = {
    id,
    name: liability.name,
    category: liability.category,
    outstanding: liability.outstanding,
  };
  const record: SyncableRecord<Liability> =
    existing === null
      ? createRecord(id, payload, now)
      : { ...payload, id, updatedAt: now, revision: existing.revision + 1, deletedAt: null };
  const stored = await repository.put(LIABILITIES, asStored(record));
  return toLiability(asShape<Liability>([stored])[0] as SyncableRecord<Liability>);
}
