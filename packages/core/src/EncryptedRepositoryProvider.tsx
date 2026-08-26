import { useMemo, type ReactNode } from 'react';
import { EncryptingRepository } from '@platform/data';
import type { DataKeyLifecycle, RecordCipher } from '@platform/security';
import { ServicesProvider, useServices } from './ServicesProvider';

/**
 * Swaps the injected repository for one that encrypts, once there is a user.
 *
 * It has to happen here rather than in the composition root because the
 * ciphertext is bound to the user id, and that does not exist until somebody
 * has signed in — the same reason the data-key lifecycle is built inside the
 * auth gate.
 *
 * Re-providing the whole service container with one field replaced means every
 * consumer of `useRepository()` gets the encrypting one without knowing it
 * exists. Nothing downstream can reach the plain repository: this provider is
 * the innermost one, and React context resolves to the nearest.
 */
export interface EncryptedRepositoryProviderProps {
  userId: string;
  lifecycle: DataKeyLifecycle;
  cipher: RecordCipher;
  children: ReactNode;
}

export function EncryptedRepositoryProvider({
  userId,
  lifecycle,
  cipher,
  children,
}: EncryptedRepositoryProviderProps) {
  const services = useServices();

  const repository = useMemo(
    () =>
      new EncryptingRepository({
        inner: services.repository,
        cipher,
        // Asked for on every operation rather than captured once: a keystore
        // key can be invalidated between two writes, and the read must fail
        // rather than reuse a stale copy.
        dataKey: () => lifecycle.load(),
        userId,
        appName: services.config.appName,
      }),
    [services, cipher, lifecycle, userId],
  );

  return (
    <ServicesProvider {...services} repository={repository}>
      {children}
    </ServicesProvider>
  );
}
