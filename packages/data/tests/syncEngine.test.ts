import { describe, expect, it } from 'vitest';
import { planSync, runSync } from '../src/sync/syncEngine';
import { InMemoryRepository } from '../src/services/InMemoryRepository';
import type { SyncableRecord } from '../src/types/record';

function record(id: string, overrides: Partial<SyncableRecord> = {}): SyncableRecord {
  return { id, updatedAt: 1000, revision: 1, deletedAt: null, ...overrides };
}

describe('planSync', () => {
  it('pushes records the remote has never seen', () => {
    const plan = planSync([record('a')], []);
    expect(plan.push.map((r) => r.id)).toEqual(['a']);
    expect(plan.pull).toEqual([]);
  });

  it('pulls records missing locally', () => {
    const plan = planSync([], [record('b')]);
    expect(plan.pull.map((r) => r.id)).toEqual(['b']);
  });

  it('counts untouched records as unchanged', () => {
    expect(planSync([record('a')], [record('a')]).unchanged).toBe(1);
  });

  it('resolves each side independently', () => {
    const plan = planSync(
      [record('a', { revision: 2 }), record('b')],
      [record('a'), record('b', { revision: 5 }), record('c')],
    );
    expect(plan.push.map((r) => r.id)).toEqual(['a']);
    expect(plan.pull.map((r) => r.id).sort()).toEqual(['b', 'c']);
  });
});

describe('runSync', () => {
  it('converges both repositories', async () => {
    const local = new InMemoryRepository();
    const remote = new InMemoryRepository();
    await local.put('assets', record('only-local'));
    await remote.put('assets', record('only-remote'));

    const result = await runSync('assets', local, remote);
    expect(result).toEqual({ pushed: 1, pulled: 1, unchanged: 0 });

    const localIds = (await local.list('assets')).map((r) => r.id).sort();
    const remoteIds = (await remote.list('assets')).map((r) => r.id).sort();
    expect(localIds).toEqual(['only-local', 'only-remote']);
    expect(remoteIds).toEqual(localIds);
  });

  it('propagates a tombstone rather than restoring the record', async () => {
    const local = new InMemoryRepository();
    const remote = new InMemoryRepository();
    await local.put('assets', record('a'));
    await remote.put('assets', record('a'));
    await local.delete('assets', 'a', 5000);

    await runSync('assets', local, remote);
    const remoteRecord = await remote.get('assets', 'a');
    expect(remoteRecord?.deletedAt).toBe(5000);
    expect(await remote.list('assets')).toEqual([]);
  });
});
