import { APP_VERSION, SCHEMA_VERSION, getAppConfig } from "./config.ts";

export type InstallationStage =
  | "NOT_CONFIGURED"
  | "SUPABASE_CONNECTED"
  | "DB_READY"
  | "FUNCTIONS_READY"
  | "STORAGE_READY"
  | "ADMIN_READY"
  | "CLASS_READY"
  | "READY";

export interface InstallationStatus {
  stage: InstallationStage;
  appVersion: string;
  schemaVersion: string;
  supabaseConnected: boolean;
  migrationsReady: boolean;
  edgeFunctionsReady: boolean;
  storageReady: boolean;
  adminReady: boolean;
  classReady: boolean;
  studentLoginVerified: boolean;
  activitySaved: boolean;
  activityRestored: boolean;
}

/** 설정값만 검사하는 안전한 초기 상태 계산기. 네트워크나 권한 검사를 가장하지 않는다. */
export function getInstallationStatus(overrides: Partial<Omit<InstallationStatus, "stage" | "appVersion" | "schemaVersion">> = {}): InstallationStatus {
  const status = {
    supabaseConnected: false,
    migrationsReady: false,
    edgeFunctionsReady: false,
    storageReady: false,
    adminReady: false,
    classReady: false,
    studentLoginVerified: false,
    activitySaved: false,
    activityRestored: false,
    ...overrides,
  };
  let stage: InstallationStage = "NOT_CONFIGURED";
  if (status.supabaseConnected) stage = "SUPABASE_CONNECTED";
  if (stage === "SUPABASE_CONNECTED" && status.migrationsReady) stage = "DB_READY";
  if (stage === "DB_READY" && status.edgeFunctionsReady) stage = "FUNCTIONS_READY";
  if (stage === "FUNCTIONS_READY" && status.storageReady) stage = "STORAGE_READY";
  if (stage === "STORAGE_READY" && status.adminReady) stage = "ADMIN_READY";
  if (stage === "ADMIN_READY" && status.classReady) stage = "CLASS_READY";
  if (stage === "CLASS_READY" && status.studentLoginVerified && status.activitySaved && status.activityRestored) {
    stage = "READY";
  }
  return { stage, appVersion: APP_VERSION, schemaVersion: SCHEMA_VERSION, ...status };
}

export interface UpdateManifest {
  version: string;
  minimumVersion?: string;
  releasedAt?: string;
  title?: string;
  notes?: string[];
  requiresDatabaseMigration?: boolean;
  requiresFunctionUpdate?: boolean;
  requiresStorageUpdate?: boolean;
}

export interface VersionState {
  currentAppVersion: string;
  requiredSchemaVersion: string;
  installedSchemaVersion?: string;
  updateRequired: boolean;
}

export function getVersionState(installedSchemaVersion?: string, requiredSchemaVersion = SCHEMA_VERSION): VersionState {
  return {
    currentAppVersion: APP_VERSION,
    requiredSchemaVersion,
    installedSchemaVersion,
    updateRequired: !installedSchemaVersion || installedSchemaVersion < requiredSchemaVersion,
  };
}

export type UpdateState = "IDLE" | "CHECKING" | "AVAILABLE" | "UPDATING" | "SUCCESS" | "FAILED";

export interface VersionService {
  getCurrentVersion(): string;
  getVersionState(installedSchemaVersion?: string, requiredSchemaVersion?: string): VersionState;
  getLatestVersion(): Promise<UpdateManifest | null>;
  checkForUpdates(): Promise<UpdateManifest | null>;
  getReleaseNotes(manifest: UpdateManifest): string[];
}

/** 원격 manifest를 아직 연결하지 않은 배포판 기본 구현. 업데이트 완료를 가장하지 않는다. */
export class LocalVersionService implements VersionService {
  getCurrentVersion(): string { return APP_VERSION; }
  getVersionState(installedSchemaVersion?: string, requiredSchemaVersion?: string): VersionState { return getVersionState(installedSchemaVersion, requiredSchemaVersion); }
  async getLatestVersion(): Promise<UpdateManifest | null> { return null; }
  async checkForUpdates(): Promise<UpdateManifest | null> { return this.getLatestVersion(); }
  getReleaseNotes(manifest: UpdateManifest): string[] { return manifest.notes ?? []; }
}

export interface DiagnosticInfo {
  appVersion: string;
  schemaVersion: string;
  environment: string;
  installationId?: string;
  browser: string;
}

export function getDiagnosticInfo(): DiagnosticInfo {
  const config = getAppConfig();
  return {
    appVersion: APP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    environment: config.environment,
    installationId: config.installationId,
    browser: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
  };
}
