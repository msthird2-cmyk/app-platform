/**
 * Applications provide configuration; packages never hard-code it.
 */
export interface AppConfig {
  appName: string;
  /** Collections this application syncs and backs up. */
  collections: readonly string[];
  featureFlags?: Readonly<Record<string, boolean>>;
}

export function isFeatureEnabled(config: AppConfig, flag: string): boolean {
  return config.featureFlags?.[flag] === true;
}
