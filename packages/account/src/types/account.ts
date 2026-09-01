export interface UserProfile {
  id: string;
  displayName: string | null;
  email: string;
  createdAt: number;
}

/**
 * The account boundary. Each step of deletion is a separate call so the
 * orchestrator can guarantee ordering and never orphan encrypted data.
 */
export interface AccountService {
  getProfile(): Promise<UserProfile>;
  updateProfile(changes: { displayName?: string }): Promise<UserProfile>;
  /**
   * Records that a deletion has begun, before anything is destroyed. If the
   * client dies part-way through, the next signed-in session can detect the
   * incomplete deletion and finish it rather than leaving data stranded.
   */
  beginDeletion(): Promise<void>;
  /** True when a previous deletion started and did not finish. */
  hasPendingDeletion(): Promise<boolean>;
  /** Step 3 — encrypted user data. */
  deleteUserData(): Promise<void>;
  /**
   * Step 4 — secondary records such as devices, settings, audit entries.
   *
   * There is no backup step. Backups are encrypted files the person exported
   * and keeps themselves, so the application has nothing to delete and could
   * not reach them if it did — see `docs/ARCHITECTURE.md`, "Backup and restore
   * security". A step that deleted nothing would imply otherwise.
   */
  deleteSecondaryRecords(): Promise<void>;
  /** Step 5 — the authentication account itself. Always last. */
  deleteAccount(): Promise<void>;
  exportUserData(): Promise<unknown>;
}

export interface DeletionCallbacks {
  /** Step 2 — resolves when the user has re-authenticated. */
  reauthenticate?: () => Promise<void>;
  /** Step 7 — clear local session, caches and in-memory state. */
  clearLocalState: () => Promise<void>;
  /** Step 8 — navigate to the signed-out state. */
  onSignedOut: () => void;
  onProgress?: (step: DeletionStep) => void;
}

export type DeletionStep =
  | 'confirm'
  | 'journal'
  | 'reauthenticate'
  | 'delete-user-data'
  | 'delete-secondary-records'
  | 'delete-account'
  | 'clear-local-state'
  | 'signed-out';

export const DELETION_STEPS: readonly DeletionStep[] = [
  'confirm',
  'reauthenticate',
  'journal',
  'delete-user-data',
  'delete-secondary-records',
  'delete-account',
  'clear-local-state',
  'signed-out',
];
