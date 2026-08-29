import {
  assertEncryptedRepository,
  isEncryptedRepository,
  type EncryptedRepository,
  type Repository,
} from '@platform/data';

/**
 * What a domain screen is allowed to be handed.
 *
 * `ServicesProvider` legitimately carries the raw repository for a moment:
 * `EncryptedRepositoryProvider` has to read it in order to wrap it. Everything
 * *after* that point is domain code, and domain code must never receive the
 * unwrapped one — so the check lives on the accessor domain code uses rather
 * than on the container.
 *
 * Pure and exported so it can be asserted directly. `packages/core` has no
 * component-test infrastructure, and a control this consequential should not be
 * tested only through a hook.
 */
export function repositoryForConsumer(repository: Repository): EncryptedRepository {
  assertEncryptedRepository(repository);
  return repository;
}

/** Non-throwing form, for a caller that wants to branch rather than fail. */
export { isEncryptedRepository };
