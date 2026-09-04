export { type AppConfig, isFeatureEnabled } from './config';
export {
  ServicesProvider,
  useServices,
  useAppConfig,
  useAccountService,
  useBackupTransport,
  useRepository,
  useCryptoService,
  type PlatformServices,
  type ServicesProviderProps,
} from './ServicesProvider';
export { AppCore, type AppCoreProps } from './AppCore';
export {
  DataKeyGate,
  type DataKeyGateProps,
  type DataKeyGateLabels,
} from './DataKeyGate';
export { dataKeyStep, type DataKeyStep } from './dataKeyStep';
export {
  resolveRouteTable,
  SETTINGS_TAB,
  SETTINGS_PROFILE,
  SETTINGS_BACKUP,
  SETTINGS_DELETE,
  type AppDestination,
  type AppDetailDestination,
  type AppRouteTable,
  type ShellCapabilities,
  type ResolvedRouteTable,
  type SettingsRowId,
} from './routes';
export { signOutPlan, type SignOutPlan, type SignOutStep } from './signOutPlan';
export { repositoryForConsumer, isEncryptedRepository } from './repositoryAccess';
export {
  pairingStep,
  pairingFailureMessage,
  pairingStartLabel,
  type PairingUiStep,
} from './pairingStep';
export { PairingFlow, type PairingFlowProps, type PairingFlowLabels } from './PairingFlow';
export {
  PairDeviceProvider,
  PairNewDeviceButton,
  usePairDevice,
  type PairDevice,
  type PairNewDeviceButtonProps,
} from './PairDeviceContext';
export { BackupControls, type BackupControlsProps } from './BackupControls';
export {
  PassphraseProvider,
  PassphraseControls,
  useDataKeyPassphrase,
  type DataKeyPassphrase,
  type PassphraseControlsProps,
} from './PassphraseContext';
export {
  EncryptedRepositoryProvider,
  type EncryptedRepositoryProviderProps,
} from './EncryptedRepositoryProvider';
