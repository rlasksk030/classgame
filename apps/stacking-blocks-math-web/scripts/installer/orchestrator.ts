import { readFile, readdir } from "node:fs/promises";
import { generateFunctionSecret, assertSafeTarget, assertTargetBinding } from "./security.ts";
import { InstallerError, type FunctionBundle, type InstallState, type InstallerBackend, type InstallerTarget, type MigrationInput } from "./contract.ts";

export interface InstallerPlan {
  migrations: MigrationInput[];
  functions: FunctionBundle[];
  appVersion: string;
  schemaVersion: string;
  productionRef: string;
}

export interface InstallerRunOptions {
  target: InstallerTarget;
  plan: InstallerPlan;
  backend: InstallerBackend;
  previous?: InstallState;
  onState?: (state: InstallState) => Promise<void> | void;
}

function stateFor(target: InstallerTarget, plan: InstallerPlan, previous?: InstallState): InstallState {
  return previous ?? {
    target,
    status: "NEW",
    completedStages: [],
    appliedMigrations: [],
    missingMigrations: [],
    functions: [],
    requiredFunctions: plan.functions.map((bundle) => bundle.slug),
    secretConfigured: false,
    appVersion: plan.appVersion,
    schemaVersion: plan.schemaVersion,
  };
}

async function save(state: InstallState, onState?: InstallerRunOptions["onState"]): Promise<void> {
  await onState?.({ ...state, completedStages: [...state.completedStages], appliedMigrations: [...state.appliedMigrations], missingMigrations: [...state.missingMigrations], functions: [...state.functions] });
}

export async function runInstaller(options: InstallerRunOptions): Promise<InstallState> {
  const { target, plan, onState } = options;
  assertSafeTarget(target, plan.productionRef);
  assertTargetBinding(target);
  const state = stateFor(target, plan, options.previous);
  delete state.lastError;
  try {
    const project = await options.backend.inspectProject(target);
    if (project.ref !== target.projectRef) throw new InstallerError("INSTALLER_TARGET_MISMATCH", "target", "설치 대상 프로젝트가 일치하지 않습니다.");
    mark(state, "target");
    await save(state, onState);

    const applied = new Set(await options.backend.listAppliedMigrations(target));
    state.appliedMigrations = plan.migrations.filter((migration) => applied.has(migration.name)).map((migration) => migration.name);
    state.missingMigrations = plan.migrations.filter((migration) => !applied.has(migration.name)).map((migration) => migration.name);
    state.status = state.missingMigrations.length ? "PARTIAL_MIGRATION" : "ALREADY_INSTALLED";
    await save(state, onState);
    for (const migration of plan.migrations) {
      if (applied.has(migration.name)) continue;
      await options.backend.applyMigration(target, migration);
      applied.add(migration.name);
      state.appliedMigrations.push(migration.name);
      state.missingMigrations = state.missingMigrations.filter((name) => name !== migration.name);
      await save(state, onState);
    }
    mark(state, "migrations");
    await save(state, onState);

    const secrets = new Set(await options.backend.listSecrets(target));
    state.secretConfigured = secrets.has("APP_SESSION_SECRET");
    if (!state.secretConfigured) {
      const secret = generateFunctionSecret();
      await options.backend.setSecrets(target, { APP_SESSION_SECRET: secret });
      state.secretConfigured = true;
    }
    mark(state, "secret");
    await save(state, onState);

    const deployed = await options.backend.listFunctions(target);
    state.functions = [];
    for (const bundle of plan.functions) {
      const existing = deployed.find((item) => item.slug === bundle.slug && item.hash === bundle.hash);
      const result = existing ?? await options.backend.deployFunction(target, bundle);
      state.functions.push(result);
      await save(state, onState);
    }
    mark(state, "functions");
    await save(state, onState);

    for (const bundle of plan.functions) await options.backend.probeFunction(target, bundle.slug);
    mark(state, "probe");
    state.status = "COMPLETE";
    mark(state, "complete");
    await save(state, onState);
    return state;
  } catch (error) {
    const detail = error instanceof InstallerError ? error : new InstallerError("INSTALLER_RUN_FAILED", "target", "설치 실행에 실패했습니다.");
    state.status = detail.code === "INSTALLER_MANAGEMENT_NETWORK" ? "RECOVERABLE" : "FAILED";
    state.lastError = { code: detail.code, stage: detail.stage };
    await save(state, onState);
    throw detail;
  }
}

function mark(state: InstallState, stage: InstallState["completedStages"][number]): void {
  if (!state.completedStages.includes(stage)) state.completedStages.push(stage);
}

export async function readMigrationPlan(directory: string): Promise<MigrationInput[]> {
  const files = (await readdir(directory)).filter((name) => /^202\d+_.+\.sql$/.test(name)).sort();
  return Promise.all(files.map(async (name) => ({ name, query: await readFile(`${directory}/${name}`, "utf8") })));
}
