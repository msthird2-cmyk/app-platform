import { createLogger } from '@platform/utils';
import { resolveConflict } from './conflict';
import type { SyncableRecord } from '../types/record';
import type { Repository } from '../types/repository';

const log = createLogger({ scope: 'sync' });

export interface SyncPlan<T extends object> {
  /** Records to write to the remote because the local copy won. */
  push: SyncableRecord<T>[];
  /** Records to write locally because the remote copy won. */
  pull: SyncableRecord<T>[];
  unchanged: number;
}

export function planSync<T extends object>(
  local: readonly SyncableRecord<T>[],
  remote: readonly SyncableRecord<T>[],
): SyncPlan<T> {
  const remoteById = new Map(remote.map((record) => [record.id, record]));
  const localById = new Map(local.map((record) => [record.id, record]));
  const plan: SyncPlan<T> = { push: [], pull: [], unchanged: 0 };

  for (const localRecord of local) {
    const remoteRecord = remoteById.get(localRecord.id);
    if (!remoteRecord) {
      plan.push.push(localRecord);
      continue;
    }
    const resolution = resolveConflict(localRecord, remoteRecord);
    if (resolution.outcome === 'local') plan.push.push(resolution.record);
    else if (resolution.outcome === 'remote') plan.pull.push(resolution.record);
    else plan.unchanged += 1;
  }

  for (const remoteRecord of remote) {
    if (!localById.has(remoteRecord.id)) plan.pull.push(remoteRecord);
  }

  return plan;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  unchanged: number;
}

export async function runSync<T extends object>(
  collection: string,
  localRepo: Repository<T>,
  remoteRepo: Repository<T>,
): Promise<SyncResult> {
  const [local, remote] = await Promise.all([
    localRepo.list(collection, { includeDeleted: true }),
    remoteRepo.list(collection, { includeDeleted: true }),
  ]);

  const plan = planSync(local, remote);
  await Promise.all(plan.push.map((record) => remoteRepo.put(collection, record)));
  await Promise.all(plan.pull.map((record) => localRepo.put(collection, record)));

  // Counts only — record contents never reach the log.
  log.info('sync complete', {
    collection,
    pushed: plan.push.length,
    pulled: plan.pull.length,
    unchanged: plan.unchanged,
  });

  return { pushed: plan.push.length, pulled: plan.pull.length, unchanged: plan.unchanged };
}
