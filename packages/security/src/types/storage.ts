export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface BiometricsService {
  isAvailable(): Promise<boolean>;
  authenticate(reason: string): Promise<boolean>;
}
