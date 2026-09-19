import { readdir } from "node:fs/promises";
import { INSTALLER_RELEASE, type InstallerManifest } from "./contract.ts";

export const MATH_INSTALLER_MANIFEST: InstallerManifest = {
  appId: "stacking-blocks-math",
  displayName: "공간과 입체",
  release: INSTALLER_RELEASE,
  schemaVersion: "202609130017",
  migrations: [],
  functions: ["student-auth", "student-api"],
  secrets: ["APP_SESSION_SECRET"],
  probes: ["student-auth", "student-api"],
  optionalCapabilities: [],
};

/** Reads the repository migration names without loading SQL into a browser bundle. */
export async function readMathManifest(migrationsDirectory: string): Promise<InstallerManifest> {
  const names = (await readdir(migrationsDirectory)).filter((name) => /^202\d+_.+\.sql$/.test(name)).sort();
  if (!names.length) throw new Error("INSTALLER_MIGRATIONS_MISSING");
  return { ...MATH_INSTALLER_MANIFEST, schemaVersion: names.at(-1)!.split("_")[0], migrations: names };
}
