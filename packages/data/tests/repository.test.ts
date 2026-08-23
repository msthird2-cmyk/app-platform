import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from '../src/services/InMemoryRepository';
import { createRecord, isSyncableRecord } from '../src/validation';
import { DataErrorCode } from '../src/errors';

describe('InMemoryRepository', () => {
  it('hides soft-deleted records by default', async () => {
    const repo = new InMemoryRepository();
    await repo.put('assets', createRecord('a', {}, 1000));
    await repo.delete('assets', 'a', 2000);
    expect(await repo.list('assets')).toEqual([]);
    expect(await repo.list('assets', { includeDeleted: true })).toHaveLength(1);
  });

  it('filters by updatedAfter', async () => {
    const repo = new InMemoryRepository();
    await repo.put('assets', createRecord('old', {}, 1000));
    await repo.put('assets', createRecord('new', {}, 3000));
    expect((await repo.list('assets', { updatedAfter: 2000 })).map((r) => r.id)).toEqual(['new']);
  });

  it('reports a missing record on delete', async () => {
    const repo = new InMemoryRepository();
    await expect(repo.delete('assets', 'nope', 1)).rejects.toMatchObject({
      code: DataErrorCode.RECORD_NOT_FOUND,
    });
  });

  it('purges every collection', async () => {
    const repo = new InMemoryRepository();
    await repo.put('assets', createRecord('a', {}, 1));
    await repo.put('liabilities', createRecord('l', {}, 1));
    await repo.purgeAll();
    expect(await repo.list('assets')).toEqual([]);
    expect(await repo.list('liabilities')).toEqual([]);
  });
});

describe('record validation', () => {
  it('requires the sync metadata', () => {
    expect(isSyncableRecord({ id: 'a', updatedAt: 1, revision: 1, deletedAt: null })).toBe(true);
    expect(isSyncableRecord({ id: 'a', updatedAt: 1 })).toBe(false);
    expect(isSyncableRecord(null)).toBe(false);
  });
});
