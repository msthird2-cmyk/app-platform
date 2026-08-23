import { describe, expect, it } from 'vitest';
import { resolveConflict, touch } from '../src/sync/conflict';
import type { SyncableRecord } from '../src/types/record';

function record(overrides: Partial<SyncableRecord> = {}): SyncableRecord {
  return { id: 'r1', updatedAt: 1000, revision: 1, deletedAt: null, ...overrides };
}

describe('resolveConflict', () => {
  it('prefers the higher revision', () => {
    const local = record({ revision: 3, updatedAt: 500 });
    const remote = record({ revision: 2, updatedAt: 9000 });
    expect(resolveConflict(local, remote)).toEqual({ outcome: 'local', record: local });
  });

  it('falls back to the later timestamp at equal revisions', () => {
    const local = record({ updatedAt: 500 });
    const remote = record({ updatedAt: 900 });
    expect(resolveConflict(local, remote).outcome).toBe('remote');
  });

  it('reports identical records', () => {
    expect(resolveConflict(record(), record()).outcome).toBe('identical');
  });

  it('never resurrects a tombstone at the same revision and time', () => {
    const deleted = record({ deletedAt: 1000 });
    const alive = record();
    expect(resolveConflict(deleted, alive)).toEqual({ outcome: 'local', record: deleted });
    expect(resolveConflict(alive, deleted)).toEqual({ outcome: 'remote', record: deleted });
  });

  it('bumps metadata on a local edit so it can win later', () => {
    const bumped = touch(record(), 2000);
    expect(bumped.revision).toBe(2);
    expect(bumped.updatedAt).toBe(2000);
    expect(resolveConflict(bumped, record()).outcome).toBe('local');
  });
});
