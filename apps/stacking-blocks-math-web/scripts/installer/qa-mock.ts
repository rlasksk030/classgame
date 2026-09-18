import { fakeBundle, createFakeInstallerBackend } from "./fake-backend.ts";
import { runInstaller, type InstallerPlan } from "./orchestrator.ts";

const target = { environment: "TEST" as const, projectRef: "local-test-project", projectUrl: "https://local-test-project.supabase.co", publishableKey: "test-publishable-key", release: "spatial-math-v1" };
const plan: InstallerPlan = {
  migrations: [{ name: "202609110001_initial.sql", query: "-- fake migration" }, { name: "202609130017_phase5_persistence.sql", query: "-- fake migration" }],
  functions: [fakeBundle("student-auth"), fakeBundle("student-api")],
  appVersion: "1.0.0",
  schemaVersion: "202609130017",
  productionRef: "stacking-blocks-math",
};

const backend = createFakeInstallerBackend({ migrations: ["202609110001_initial.sql"], secrets: [] });
const result = await runInstaller({ target, plan, backend });
console.log(JSON.stringify({ status: result.status, appliedMigrations: result.appliedMigrations, secretConfigured: result.secretConfigured, functions: result.functions.map(({ slug, hash, status }) => ({ slug, hash, status })) }, null, 2));
