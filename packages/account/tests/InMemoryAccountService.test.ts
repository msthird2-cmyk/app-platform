import { describe, expect, it } from 'vitest';
import { InMemoryAccountService } from '../src/services/InMemoryAccountService';
import { deleteAccountFlow } from '../src/services/deleteAccountFlow';
import { AccountErrorCode } from '../src/errors';
import type { UserProfile } from '../src/types/account';

const PROFILE: UserProfile = { id: 'u1', email: 'you@example.com', displayName: 'You', createdAt: 0 };

function callbacks() {
  return {
    reauthenticate: async () => undefined,
    clearLocalState: async () => undefined,
    onSignedOut: () => undefined,
  };
}

describe('deleteAccountFlow against a working service', () => {
  it('leaves nothing behind', async () => {
    const service = new InMemoryAccountService({
      profile: PROFILE,
      data: { assets: [{ id: 'a1' }], liabilities: [{ id: 'l1' }] },
    });

    await deleteAccountFlow(service, callbacks(), { confirmed: true });

    expect(service.remaining).toEqual({ collections: 0, backups: 0, secondary: 0, account: false });
    expect(service.destructiveCalls).toEqual([
      'deleteUserData',
      'deleteBackups',
      'deleteSecondaryRecords',
      'deleteAccount',
    ]);
  });

  it('orphans nothing when the account deletion itself fails', async () => {
    const service = new InMemoryAccountService({
      profile: PROFILE,
      data: { assets: [{ id: 'a1' }] },
      failOn: 'deleteAccount',
    });

    await expect(deleteAccountFlow(service, callbacks(), { confirmed: true })).rejects.toMatchObject({
      code: AccountErrorCode.ACCOUNT_DELETION_FAILED,
    });

    // The data is already gone and the account survives — recoverable, not orphaned.
    expect(service.remaining).toMatchObject({ collections: 0, backups: 0, account: true });
  });

  it('keeps the data when the first step fails, so a retry is safe', async () => {
    const service = new InMemoryAccountService({
      profile: PROFILE,
      data: { assets: [{ id: 'a1' }] },
      failOn: 'deleteUserData',
    });

    await expect(deleteAccountFlow(service, callbacks(), { confirmed: true })).rejects.toMatchObject({
      code: AccountErrorCode.DATA_DELETION_FAILED,
    });
    expect(service.remaining).toMatchObject({ collections: 1, account: true });
    expect(service.destructiveCalls).toEqual(['deleteUserData']);
  });

  it('exports the profile alongside the records', async () => {
    const service = new InMemoryAccountService({ profile: PROFILE, data: { assets: [{ id: 'a1' }] } });
    await expect(service.exportUserData()).resolves.toMatchObject({
      profile: PROFILE,
      assets: [{ id: 'a1' }],
    });
  });
});
