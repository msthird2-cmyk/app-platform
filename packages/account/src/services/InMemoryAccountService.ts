import { AccountError, AccountErrorCode } from '../errors';
import type { AccountService, UserProfile } from '../types/account';

export interface InMemoryAccountOptions {
  profile: UserProfile;
  /** Records the service is holding, so a deletion can be observed. */
  data?: Record<string, unknown[]>;
  failOn?: 'deleteUserData' | 'deleteSecondaryRecords' | 'deleteAccount';
}

/**
 * A working AccountService with no backend. It tracks which deletion steps have
 * run, so a preview — or a test — can see the ordering the flow guarantees.
 */
export class InMemoryAccountService implements AccountService {
  readonly calls: string[] = [];
  private profile: UserProfile;
  private data: Record<string, unknown[]>;
  private secondary: unknown[] = [{ id: 'seed-device' }];
  private accountExists = true;
  private deletionStarted = false;

  constructor(private readonly options: InMemoryAccountOptions) {
    this.profile = options.profile;
    this.data = { ...(options.data ?? {}) };
  }

  private record(step: NonNullable<InMemoryAccountOptions['failOn']>): void {
    this.calls.push(step);
    if (this.options.failOn === step) throw new Error(`${step} failed`);
  }

  async getProfile(): Promise<UserProfile> {
    if (!this.accountExists) throw new AccountError(AccountErrorCode.REAUTHENTICATION_REQUIRED);
    return this.profile;
  }

  async updateProfile(changes: { displayName?: string }): Promise<UserProfile> {
    this.profile = { ...this.profile, ...changes };
    return this.profile;
  }

  async beginDeletion(): Promise<void> {
    this.calls.push('beginDeletion');
    this.deletionStarted = true;
  }

  async hasPendingDeletion(): Promise<boolean> {
    return this.deletionStarted;
  }

  async deleteUserData(): Promise<void> {
    this.record('deleteUserData');
    this.data = {};
  }


  async deleteSecondaryRecords(): Promise<void> {
    this.record('deleteSecondaryRecords');
    this.secondary = [];
  }

  async deleteAccount(): Promise<void> {
    this.record('deleteAccount');
    this.accountExists = false;
  }

  async exportUserData(): Promise<unknown> {
    return { profile: this.profile, ...this.data };
  }

  /** What is still stored — used to assert that nothing was orphaned. */
  get remaining(): { collections: number; secondary: number; account: boolean } {
    return {
      collections: Object.keys(this.data).length,
      secondary: this.secondary.length,
      account: this.accountExists,
    };
  }

  /** Service calls that actually destroy something, in the order they ran. */
  get destructiveCalls(): string[] {
    return this.calls.filter((call) => call !== 'beginDeletion');
  }
}
