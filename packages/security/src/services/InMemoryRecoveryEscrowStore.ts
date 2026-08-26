import { SecurityError, SecurityErrorCode } from '../errors';
import type { RecoveryEscrowStore } from '../dataKeyLifecycle';
import type { RecoveryEscrowDocument } from '../recoveryEscrow';

/**
 * A recovery escrow that lives in this process, for previews and tests.
 *
 * Safe to hold ciphertext in memory in a way it would never be safe to hold a
 * key: what is stored here is exactly what would go to Firestore, and it is
 * useless without the recovery code. It is still not a production store —
 * nothing survives a restart, so a preview app rebuilds its key each launch.
 */
export class InMemoryRecoveryEscrowStore implements RecoveryEscrowStore {
  private document: RecoveryEscrowDocument | null = null;

  constructor(private readonly escrowId = 'current') {}

  async load(): Promise<unknown | null> {
    return this.document === null ? null : { ...this.document };
  }

  async save(document: RecoveryEscrowDocument): Promise<void> {
    if (document.id !== this.escrowId) {
      throw new SecurityError(SecurityErrorCode.RECOVERY_ESCROW_INVALID);
    }
    this.document = { ...document };
  }
}
