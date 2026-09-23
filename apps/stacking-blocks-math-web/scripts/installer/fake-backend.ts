import { createHash } from "node:crypto";
import type { FunctionBundle, FunctionDeployment, InstallerBackend, InstallerTarget, MigrationInput, RemoteProject } from "./contract.ts";
import { InstallerError } from "./contract.ts";
import type { InstallerManagementExtras } from "./http-server.ts";
import type { TeacherAccountResult } from "./teacher-account.ts";

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
    async probeFunction(target, slug: FunctionDeployment["slug"]) {
      calls.push(`probeFunction:${slug}`);
      maybeFail("probe");
      // Mirrors the real SupabaseManagementBackend's guard: without this,
      // a test target's publishableKey never actually gets exercised, and a
      // regression that stops session.target from being updated with an
      // OAuth-fetched key (INSTALLER_PUBLIC_CONFIG_MISSING in production)
      // would pass here silently.
      if (!target.publishableKey) throw new InstallerError("INSTALLER_PUBLIC_CONFIG_MISSING", "probe", "함수 확인에 필요한 공개 연결 설정이 없습니다.");
    },
  };
}

export function fakeBundle(slug: FunctionDeployment["slug"]): FunctionBundle {
  const hash = createHash("sha256").update(slug).digest("hex");
  return { slug, files: [{ path: `supabase/functions/${slug}/index.ts`, content: `${slug}:bundle` }], metadata: { entrypoint_path: `supabase/functions/${slug}/index.ts`, verify_jwt: false, name: hash }, hash };
}

export interface FakeManagementExtrasSeed {
  accessibleProjects?: RemoteProject[];
  existingTeacherEmails?: string[];
  rejectCreateTeacherAccount?: boolean;
  publishableKeys?: Record<string, string>;
}

/** In-memory stand-in for InstallerManagementExtras, mirroring fake-backend's
 * approach: no network calls, records enough to assert on in tests. */
export function createFakeManagementExtras(seed: FakeManagementExtrasSeed = {}): InstallerManagementExtras & { calls: string[] } {
  const calls: string[] = [];
  const existingEmails = new Set((seed.existingTeacherEmails ?? []).map((email) => email.toLowerCase()));
  return {
    calls,
    async listAccessibleProjects(): Promise<RemoteProject[]> {
      calls.push("listAccessibleProjects");
      return seed.accessibleProjects ?? [];
    },
    async createTeacherAccount(_target: InstallerTarget, email: string, password: string): Promise<TeacherAccountResult> {
      calls.push(`createTeacherAccount:${email}`);
      if (seed.rejectCreateTeacherAccount) throw new InstallerError("FAKE_TEACHER_ACCOUNT_FAILED", "target", "fake failure");
      if (password.length < 8) throw new InstallerError("INSTALLER_TEACHER_ACCOUNT_PASSWORD_WEAK", "target", "비밀번호는 8자 이상이어야 합니다.");
      if (existingEmails.has(email.toLowerCase())) return { created: false, alreadyExists: true };
      existingEmails.add(email.toLowerCase());
      return { created: true, alreadyExists: false };
    },
    async getPublishableKey(target: InstallerTarget): Promise<string | undefined> {
      calls.push(`getPublishableKey:${target.projectRef}`);
      return seed.publishableKeys?.[target.projectRef];
    },
  };
}
