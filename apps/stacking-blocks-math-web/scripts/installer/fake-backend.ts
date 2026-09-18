import { createHash } from "node:crypto";
import type { FunctionBundle, FunctionDeployment, InstallerBackend, InstallerTarget, MigrationInput, RemoteProject } from "./contract.ts";
import { InstallerError } from "./contract.ts";

export interface FakeInstallerSeed {
  project?: RemoteProject;
  migrations?: string[];
  secrets?: string[];
  functions?: FunctionDeployment[];
  rejectStage?: "target" | "migrations" | "secret" | "functions" | "probe";
}

export function createFakeInstallerBackend(seed: FakeInstallerSeed = {}): InstallerBackend & { calls: string[]; secretValues: Record<string, string>; migrations: string[] } {
  const calls: string[] = [];
  const migrations = [...(seed.migrations ?? [])];
  const secrets = new Set(seed.secrets ?? []);
  const functions = [...(seed.functions ?? [])];
  const secretValues: Record<string, string> = {};
  const maybeFail = (stage: FakeInstallerSeed["rejectStage"]) => { if (seed.rejectStage === stage) throw new InstallerError("FAKE_" + stage.toUpperCase() + "_FAILED", stage, "fake failure"); };
  return {
    calls,
    secretValues,
    migrations,
    async inspectProject(target) { calls.push("inspectProject"); maybeFail("target"); return seed.project ?? { ref: target.projectRef, name: "TEST", status: "ACTIVE" }; },
    async listAppliedMigrations() { calls.push("listAppliedMigrations"); maybeFail("migrations"); return [...migrations]; },
    async applyMigration(_target: InstallerTarget, migration: MigrationInput) { calls.push(`applyMigration:${migration.name}`); maybeFail("migrations"); if (!migrations.includes(migration.name)) migrations.push(migration.name); },
    async listSecrets() { calls.push("listSecrets"); maybeFail("secret"); return [...secrets]; },
    async setSecrets(_target, values) { calls.push("setSecrets"); maybeFail("secret"); for (const [name, value] of Object.entries(values)) { secrets.add(name); secretValues[name] = value; } },
    async listFunctions() { calls.push("listFunctions"); maybeFail("functions"); return [...functions]; },
    async deployFunction(_target, bundle: FunctionBundle) { calls.push(`deployFunction:${bundle.slug}`); maybeFail("functions"); const result = { slug: bundle.slug, version: 1, hash: bundle.hash, status: "ACTIVE" } as FunctionDeployment; const index = functions.findIndex((item) => item.slug === bundle.slug); if (index >= 0) functions[index] = result; else functions.push(result); return result; },
    async probeFunction(_target, slug: FunctionDeployment["slug"]) { calls.push(`probeFunction:${slug}`); maybeFail("probe"); },
  };
}

export function fakeBundle(slug: FunctionDeployment["slug"]): FunctionBundle {
  const hash = createHash("sha256").update(slug).digest("hex");
  return { slug, files: [`${slug}:bundle`], metadata: { entrypoint_path: "index.ts", verify_jwt: false }, hash };
}
