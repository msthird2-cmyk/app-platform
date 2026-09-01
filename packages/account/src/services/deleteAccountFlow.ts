import { createLogger } from '@platform/utils';
import { AccountError, AccountErrorCode } from '../errors';
import {
  DELETION_STEPS,
  type AccountService,
  type DeletionCallbacks,
  type DeletionStep,
} from '../types/account';

const log = createLogger({ scope: 'account:delete' });

export interface DeleteAccountOptions {
  /** The user has explicitly confirmed. Deletion never runs without it. */
  confirmed: boolean;
  /**
   * Defaults to **true**. Firebase refuses `deleteUser` without a recent
   * login, and discovering that at the final step would mean the data was
   * already destroyed while the account survived. Re-authenticating first
   * makes the failure happen while everything is still recoverable.
   */
  requiresReauthentication?: boolean;
}

/**
 * Deleting the authentication account first orphans encrypted data that can no
 * longer be authenticated for removal, so the account is always deleted last.
 * The order here is the order in CLAUDE.md and is covered by a regression test.
 */
export async function deleteAccountFlow(
  service: AccountService,
  callbacks: DeletionCallbacks,
  options: DeleteAccountOptions,
): Promise<DeletionStep[]> {
  if (!options.confirmed) throw new AccountError(AccountErrorCode.CONFIRMATION_REQUIRED);

  const completed: DeletionStep[] = [];
  const step = (name: DeletionStep): void => {
    completed.push(name);
    callbacks.onProgress?.(name);
  };

  step('confirm');

  if (options.requiresReauthentication ?? true) {
    if (!callbacks.reauthenticate) throw new AccountError(AccountErrorCode.REAUTHENTICATION_REQUIRED);
    await callbacks.reauthenticate();
    step('reauthenticate');
  }

  // Written before anything is destroyed, so an interrupted deletion is
  // detectable and resumable rather than silently half-done.
  try {
    await service.beginDeletion();
    step('journal');
  } catch (cause) {
    throw new AccountError(AccountErrorCode.DATA_DELETION_FAILED, cause);
  }

  try {
    await service.deleteUserData();
    step('delete-user-data');
  } catch (cause) {
    throw new AccountError(AccountErrorCode.DATA_DELETION_FAILED, cause);
  }

  try {
    await service.deleteSecondaryRecords();
    step('delete-secondary-records');
  } catch (cause) {
    throw new AccountError(AccountErrorCode.DATA_DELETION_FAILED, cause);
  }

  try {
    await service.deleteAccount();
    step('delete-account');
  } catch (cause) {
    throw new AccountError(AccountErrorCode.ACCOUNT_DELETION_FAILED, cause);
  }

  await callbacks.clearLocalState();
  step('clear-local-state');

  callbacks.onSignedOut();
  step('signed-out');

  // Step names only; nothing identifying is logged.
  log.info('account deleted', { steps: completed.length });
  return completed;
}

/** Deleting data keeps the account: the same ordering minus the final step. */
export async function deleteUserDataFlow(
  service: AccountService,
  callbacks: Pick<DeletionCallbacks, 'onProgress'>,
  options: { confirmed: boolean },
): Promise<DeletionStep[]> {
  if (!options.confirmed) throw new AccountError(AccountErrorCode.CONFIRMATION_REQUIRED);
  const completed: DeletionStep[] = ['confirm'];
  callbacks.onProgress?.('confirm');

  try {
    await service.deleteUserData();
    completed.push('delete-user-data');
    callbacks.onProgress?.('delete-user-data');
  } catch (cause) {
    throw new AccountError(AccountErrorCode.DATA_DELETION_FAILED, cause);
  }

  return completed;
}

export function isDeletionOrderValid(steps: readonly DeletionStep[]): boolean {
  const expected = DELETION_STEPS.filter((candidate) => steps.includes(candidate));
  return expected.every((name, index) => steps[index] === name);
}
