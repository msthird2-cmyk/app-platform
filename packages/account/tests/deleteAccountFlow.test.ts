import { describe, expect, it, vi } from 'vitest';
import {
  deleteAccountFlow,
  deleteUserDataFlow,
  isDeletionOrderValid,
} from '../src/services/deleteAccountFlow';
import { AccountErrorCode } from '../src/errors';
import type { AccountService, DeletionStep } from '../src/types/account';

/** Records the order in which the service was called. */
function trackingService(overrides: Partial<AccountService> = {}) {
  const calls: string[] = [];
  const service: AccountService = {
    getProfile: async () => ({ id: 'u1', email: 'a@b.co', displayName: null, createdAt: 0 }),
    updateProfile: async () => ({ id: 'u1', email: 'a@b.co', displayName: null, createdAt: 0 }),
    beginDeletion: async () => void calls.push('beginDeletion'),
    hasPendingDeletion: async () => calls.includes('beginDeletion'),
    deleteUserData: async () => void calls.push('deleteUserData'),
    deleteSecondaryRecords: async () => void calls.push('deleteSecondaryRecords'),
    deleteAccount: async () => void calls.push('deleteAccount'),
    exportUserData: async () => ({}),
    ...overrides,
  };
  return { service, calls };
}

describe('deleteAccountFlow', () => {
  it('deletes the authentication account last, so no data is orphaned', async () => {
    const { service, calls } = trackingService();
    const steps = await deleteAccountFlow(
      service,
      { reauthenticate: async () => undefined, clearLocalState: async () => undefined, onSignedOut: () => undefined },
      { confirmed: true },
    );

    expect(calls).toEqual([
      'beginDeletion',
      'deleteUserData',
      'deleteSecondaryRecords',
      'deleteAccount',
    ]);
    expect(calls.indexOf('deleteAccount')).toBe(calls.length - 1);
    expect(steps).toEqual([
      'confirm',
      'reauthenticate',
      'journal',
      'delete-user-data',
      'delete-secondary-records',
      'delete-account',
      'clear-local-state',
      'signed-out',
    ] satisfies DeletionStep[]);
    expect(isDeletionOrderValid(steps)).toBe(true);
  });

  it('refuses to run without explicit confirmation', async () => {
    const { service, calls } = trackingService();
    await expect(
      deleteAccountFlow(
        service,
        { reauthenticate: async () => undefined, clearLocalState: async () => undefined, onSignedOut: () => undefined },
        { confirmed: false },
      ),
    ).rejects.toMatchObject({ code: AccountErrorCode.CONFIRMATION_REQUIRED });
    expect(calls).toEqual([]);
  });

  it('re-authenticates by default, before touching any data', async () => {
    const { service, calls } = trackingService();
    const reauthenticate = vi.fn(async () => void calls.push('reauthenticate'));
    await deleteAccountFlow(
      service,
      { reauthenticate, clearLocalState: async () => undefined, onSignedOut: () => undefined },
      { confirmed: true },
    );
    expect(reauthenticate).toHaveBeenCalledOnce();
    expect(calls[0]).toBe('reauthenticate');
  });

  // Firebase refuses deleteUser without a recent login. Discovering that at the
  // final step would mean the data was already destroyed, so the flow refuses
  // to start rather than failing at the end.
  it('refuses to start when no re-authentication callback is supplied', async () => {
    const { service, calls } = trackingService();
    await expect(
      deleteAccountFlow(
        service,
        { clearLocalState: async () => undefined, onSignedOut: () => undefined },
        { confirmed: true },
      ),
    ).rejects.toMatchObject({ code: AccountErrorCode.REAUTHENTICATION_REQUIRED });
    expect(calls).toEqual([]);
  });

  it('writes the deletion journal before the first destructive call', async () => {
    const { service, calls } = trackingService();
    await deleteAccountFlow(
      service,
      {
        reauthenticate: async () => undefined,
        clearLocalState: async () => undefined,
        onSignedOut: () => undefined,
      },
      { confirmed: true },
    );
    expect(calls[0]).toBe('beginDeletion');
    await expect(service.hasPendingDeletion()).resolves.toBe(true);
  });

  it('keeps the account when data deletion fails', async () => {
    const { service, calls } = trackingService({
      deleteUserData: async () => {
        throw new Error('network');
      },
    });
    await expect(
      deleteAccountFlow(
        service,
        { reauthenticate: async () => undefined, clearLocalState: async () => undefined, onSignedOut: () => undefined },
        { confirmed: true },
      ),
    ).rejects.toMatchObject({ code: AccountErrorCode.DATA_DELETION_FAILED });
    expect(calls).not.toContain('deleteAccount');
  });

  it('does not sign the user out when account deletion fails', async () => {
    const onSignedOut = vi.fn();
    const { service } = trackingService({
      deleteAccount: async () => {
        throw new Error('requires-recent-login');
      },
    });
    await expect(
      deleteAccountFlow(service, { reauthenticate: async () => undefined, clearLocalState: async () => undefined, onSignedOut }, { confirmed: true }),
    ).rejects.toMatchObject({ code: AccountErrorCode.ACCOUNT_DELETION_FAILED });
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('reports every step through the progress callback', async () => {
    const seen: DeletionStep[] = [];
    const { service } = trackingService();
    await deleteAccountFlow(
      service,
      {
        reauthenticate: async () => undefined,
        clearLocalState: async () => undefined,
        onSignedOut: () => undefined,
        onProgress: (step) => seen.push(step),
      },
      { confirmed: true },
    );
    expect(seen.at(-1)).toBe('signed-out');
  });
});

describe('deleteUserDataFlow', () => {
  it('removes data but keeps the account', async () => {
    const { service, calls } = trackingService();
    const steps = await deleteUserDataFlow(service, {}, { confirmed: true });
    expect(calls).toEqual(['deleteUserData']);
    expect(steps).not.toContain('delete-account');
  });

  it('requires confirmation', async () => {
    const { service, calls } = trackingService();
    await expect(deleteUserDataFlow(service, {}, { confirmed: false })).rejects.toMatchObject({
      code: AccountErrorCode.CONFIRMATION_REQUIRED,
    });
    expect(calls).toEqual([]);
  });
});
