export const INSTALLER_RELEASE = "spatial-math-v1";

/** App-specific payload consumed by the shared Easy Setup installer engine. */
export interface InstallerManifest {
  appId: string;
  displayName: string;
  release: string;
  schemaVersion: string;
  migrations: string[];
  functions: Array<"student-auth" | "student-api">;
  secrets: string[];
  probes: Array<"student-auth" | "student-api">;
  optionalCapabilities: string[];
}

export type InstallerStage =
  | "target"
  | "migrations"
  | "secret"
  | "functions"
  | "probe"
  | "complete";

export type InstallerStatus =
  | "NEW"
  | "ALREADY_INSTALLED"
  | "PARTIAL_MIGRATION"
  | "FUNCTION_MISSING"
  | "SECRET_MISSING"
  | "UPDATE_REQUIRED"
  | "RECOVERABLE"
  | "FAILED"
  | "COMPLETE";

export interface InstallerTarget {
  environment: "TEST" | "STAGING" | "PRODUCTION";
  projectRef: string;
  projectUrl: string;
  publishableKey?: string;
  release: string;
}

export interface RemoteProject {
  ref: string;
  name?: string;
  region?: string;
  status?: string;
}

export interface FunctionDeployment {
  slug: "student-auth" | "student-api";
  version?: number;
  hash?: string;
  status?: string;
}

export interface InstallState {
  target: InstallerTarget;
  status: InstallerStatus;
  completedStages: InstallerStage[];
  appliedMigrations: string[];
  missingMigrations: string[];
  functions: FunctionDeployment[];
  requiredFunctions: Array<FunctionDeployment["slug"]>;
  secretConfigured: boolean;
  appVersion: string;
  schemaVersion: string;
  lastError?: { code: string; stage: InstallerStage };
}

export interface MigrationInput {
  name: string;
  query: string;
}

export interface FunctionBundle {
  slug: FunctionDeployment["slug"];
  files: string[];
  metadata: Record<string, unknown>;
  hash: string;
}

export interface InstallerBackend {
  inspectProject(target: InstallerTarget): Promise<RemoteProject>;
  listAppliedMigrations(target: InstallerTarget): Promise<string[]>;
  applyMigration(target: InstallerTarget, migration: MigrationInput): Promise<void>;
  listSecrets(target: InstallerTarget): Promise<string[]>;
  setSecrets(target: InstallerTarget, values: Record<string, string>): Promise<void>;
  listFunctions(target: InstallerTarget): Promise<FunctionDeployment[]>;
  deployFunction(target: InstallerTarget, bundle: FunctionBundle): Promise<FunctionDeployment>;
  probeFunction(target: InstallerTarget, slug: FunctionDeployment["slug"]): Promise<void>;
}

export class InstallerError extends Error {
  readonly code: string;
  readonly stage: InstallerStage;

  constructor(code: string, stage: InstallerStage, message: string) {
    super(message);
    this.code = code;
    this.stage = stage;
    this.name = "InstallerError";
  }
}

export function safeInstallerError(error: unknown): { code: string; stage: InstallerStage; message: string } {
  if (error instanceof InstallerError) {
    return { code: error.code, stage: error.stage, message: error.message };
  }
  return { code: "INSTALLER_SERVER_ERROR", stage: "target", message: "설치 실행부에서 오류가 발생했습니다." };
}
