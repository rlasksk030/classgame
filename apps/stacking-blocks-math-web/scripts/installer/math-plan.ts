import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readMigrationPlan, type InstallerPlan } from "./orchestrator.ts";
import { MATH_INSTALLER_MANIFEST } from "./math-manifest.ts";
import type { FunctionBundle } from "./contract.ts";

/** Builds the server-side release plan from the checked-in math sources. */
export async function readMathInstallerPlan(root: string): Promise<InstallerPlan> {
  const migrations = await readMigrationPlan(join(root, "supabase", "migrations"));
  const functions = await Promise.all(MATH_INSTALLER_MANIFEST.functions.map(async (slug) => {
    const source = await readFile(join(root, "supabase", "functions", slug, "index.ts"), "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    const bundle: FunctionBundle = { slug, files: [source], metadata: { entrypoint_path: "index.ts", verify_jwt: false, app_version: MATH_INSTALLER_MANIFEST.release }, hash };
    return bundle;
  }));
  return { migrations, functions, appVersion: MATH_INSTALLER_MANIFEST.release, schemaVersion: MATH_INSTALLER_MANIFEST.schemaVersion, productionRef: process.env.INSTALLER_PRODUCTION_REF ?? "stacking-blocks-math" };
}
