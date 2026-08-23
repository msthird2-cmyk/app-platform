import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { AuthService } from '@platform/auth';
import type { AccountService } from '@platform/account';
import type { BackupService } from '@platform/backup';
import type { Repository } from '@platform/data';
import type { CryptoService, SecureStorage } from '@platform/security';
import type { AppConfig } from './config';

export interface PlatformServices {
  config: AppConfig;
  authService: AuthService;
  accountService: AccountService;
  backupService: BackupService;
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

export function useBackupService(): BackupService {
  return useServices().backupService;
}

export function useRepository(): Repository {
  return useServices().repository;
}

export function useCryptoService(): CryptoService {
  return useServices().cryptoService;
}
