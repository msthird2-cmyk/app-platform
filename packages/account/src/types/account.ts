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
  /** Step 3 — encrypted user data. */
  deleteUserData(): Promise<void>;
  /** Step 4 — backups and file storage. */
  deleteBackups(): Promise<void>;
  /** Step 5 — secondary records such as devices, settings, audit entries. */
  deleteSecondaryRecords(): Promise<void>;
  /** Step 6 — the authentication account itself. Always last. */
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
  | 'reauthenticate'
  | 'delete-user-data'
  | 'delete-backups'
  | 'delete-secondary-records'
  | 'delete-account'
  | 'clear-local-state'
  | 'signed-out';

export const DELETION_STEPS: readonly DeletionStep[] = [
  'confirm',
  'reauthenticate',
  'delete-user-data',
  'delete-backups',
  'delete-secondary-records',
  'delete-account',
  'clear-local-state',
  'signed-out',
];
