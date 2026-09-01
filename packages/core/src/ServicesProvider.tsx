import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AuthService } from '@platform/auth';
import type { AccountService } from '@platform/account';
import type { BackupTransport } from '@platform/backup';
import type { EncryptedRepository, Repository } from '@platform/data';
import type { CryptoService, SecureStorage } from '@platform/security';
import type { AppConfig } from './config';
import { repositoryForConsumer } from './repositoryAccess';

export interface PlatformServices {
  config: AppConfig;
  authService: AuthService;
  accountService: AccountService;
  /**
   * Where an exported backup goes, and where an imported one comes from.
   *
   * Optional, and offered nowhere without it — the same arrangement as
   * `pairingRelay`. A backup needs a share sheet or a browser download, so a
   * composition that has no way to hand the person a file simply does not
   * present backup, rather than presenting one that silently goes nowhere.
   */
  backupTransport?: BackupTransport | undefined;
  repository: Repository;
  cryptoService: CryptoService;
  secureStorage: SecureStorage;
}

const ServicesContext = createContext<PlatformServices | null>(null);

export interface ServicesProviderProps extends PlatformServices {
  children: ReactNode;
}

export function ServicesProvider({ children, ...services }: ServicesProviderProps) {
  const value = useMemo<PlatformServices>(() => services, Object.values(services));
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): PlatformServices {
  const context = useContext(ServicesContext);
  if (!context) throw new Error('SERVICES_PROVIDER_MISSING');
  return context;
}

export function useAppConfig(): AppConfig {
  return useServices().config;
}

export function useAccountService(): AccountService {
  return useServices().accountService;
}

/** `undefined` where no transport was injected; screens hide backup then. */
export function useBackupTransport(): BackupTransport | undefined {
  return useServices().backupTransport;
}

/**
 * The repository a domain screen may use, which is never the raw one.
 *
 * Throws `REPOSITORY_NOT_ENCRYPTING` rather than returning the unwrapped
 * repository, because the alternative is a screen writing a user's records in
 * the clear and finding out only when Firestore refuses the document. Inside
 * `EncryptedRepositoryProvider` this always succeeds; outside it, nothing that
 * touches domain data should be rendering at all.
 *
 * `EncryptedRepositoryProvider` deliberately reads `useServices().repository`
 * instead — it is the one caller whose job is to wrap the raw one.
 */
export function useRepository(): EncryptedRepository {
  return repositoryForConsumer(useServices().repository);
}

export function useCryptoService(): CryptoService {
  return useServices().cryptoService;
}
