import { join } from "node:path";

import { readMigrationPlan, type InstallerPlan } from "./orchestrator.ts";
import { MATH_INSTALLER_MANIFEST } from "./math-manifest.ts";
import { collectFunctionBundleFiles, hashFunctionBundle } from "./function-bundle.ts";
import type { FunctionBundle } from "./contract.ts";

/** Builds the server-side release plan from the checked-in math sources. */
export async function readMathInstallerPlan(root: string): Promise<InstallerPlan> {
  const migrations = await readMigrationPlan(join(root, "supabase", "migrations"));
  if (!migrations.length) throw new Error("INSTALLER_MIGRATIONS_MISSING");
  const functions = await Promise.all(MATH_INSTALLER_MANIFEST.functions.map(async (slug) => {
    const entrypointPath = `supabase/functions/${slug}/index.ts`;
    const files = await collectFunctionBundleFiles(root, join(root, "supabase", "functions", slug, "index.ts"));
    const hash = hashFunctionBundle(files);
    // The remote hash (ezbr_sha256) is computed by Supabase's own bundler and
    // can't be replicated locally, so "name" carries our own content hash as
    // a self-controlled marker: listFunctions() reads it back to detect a
    // real match instead of comparing against an unreproducible remote hash.
    const bundle: FunctionBundle = { slug, files, metadata: { entrypoint_path: entrypointPath, verify_jwt: false, name: hash }, hash };
    return bundle;
  }));
  return { migrations, functions, appVersion: MATH_INSTALLER_MANIFEST.release, schemaVersion: migrations.at(-1)!.name.split("_")[0], productionRef: process.env.INSTALLER_PRODUCTION_REF ?? "stacking-blocks-math" };
}
