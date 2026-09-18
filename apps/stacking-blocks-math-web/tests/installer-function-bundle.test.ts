import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectFunctionBundleFiles, hashFunctionBundle } from "../scripts/installer/function-bundle.ts";

/**
 * Mirrors the real repo layout just enough to exercise: a sibling `_shared/`
 * import, a multi-level `../../../shared/` import, a nested import two hops
 * deep, a shared module reached from two different files (must dedup), a
 * bare `npm:` specifier (must be ignored, not walked), and a type-only
 * `import("...")` expression alongside a `export ... from` re-export.
 */
async function writeFixtureProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "installer-bundle-test-"));
  await mkdir(join(root, "supabase", "functions", "demo"), { recursive: true });
  await mkdir(join(root, "supabase", "functions", "_shared"), { recursive: true });
  await mkdir(join(root, "shared"), { recursive: true });

  await writeFile(
    join(root, "supabase", "functions", "demo", "index.ts"),
    [
      'import { helper } from "../_shared/helper.ts";',
      'import { widget } from "../../../shared/widget.ts";',
      'export { localThing } from "./local.ts";',
      'import "npm:@supabase/supabase-js@^2.45.4";',
      'type Extra = import("../../../shared/widget.ts").WidgetType;',
      "Deno.serve(() => new Response(String(helper() + widget() + Extra)));",
    ].join("\n"),
  );
  await writeFile(join(root, "supabase", "functions", "demo", "local.ts"), 'export const localThing = "local";');
  // _shared/helper.ts also reaches shared/widget.ts, so widget.ts must be
  // visited only once despite two independent paths to it.
  await writeFile(join(root, "supabase", "functions", "_shared", "helper.ts"), 'import { widget } from "../../../shared/widget.ts";\nexport function helper() { return widget(); }');
  await writeFile(join(root, "shared", "widget.ts"), 'import { deepest } from "./nested/deep.ts";\nexport function widget() { return deepest(); }\nexport type WidgetType = string;');
  await mkdir(join(root, "shared", "nested"), { recursive: true });
  await writeFile(join(root, "shared", "nested", "deep.ts"), "export function deepest() { return 1; }");
  return root;
}

test("function bundler walks sibling, multi-level, and nested relative imports exactly once each", async () => {
  const root = await writeFixtureProject();
  try {
    const files = await collectFunctionBundleFiles(root, join(root, "supabase", "functions", "demo", "index.ts"));
    const paths = files.map((f) => f.path).sort();
    assert.deepEqual(paths, [
      "shared/nested/deep.ts",
      "shared/widget.ts",
      "supabase/functions/_shared/helper.ts",
      "supabase/functions/demo/index.ts",
      "supabase/functions/demo/local.ts",
    ]);
    // entrypoint-first order
    assert.equal(files[0].path, "supabase/functions/demo/index.ts");
    // no duplicate visit of the doubly-reachable shared/widget.ts
    assert.equal(paths.filter((p) => p === "shared/widget.ts").length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("function bundler ignores bare/npm specifiers instead of trying to walk them as files", async () => {
  const root = await writeFixtureProject();
  try {
    const files = await collectFunctionBundleFiles(root, join(root, "supabase", "functions", "demo", "index.ts"));
    assert.ok(files.every((f) => !f.path.includes("npm:") && !f.path.includes("supabase-js")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("function bundle hash is deterministic regardless of file discovery order", async () => {
  const root = await writeFixtureProject();
  try {
    const files = await collectFunctionBundleFiles(root, join(root, "supabase", "functions", "demo", "index.ts"));
    const shuffled = [...files].reverse();
    assert.equal(hashFunctionBundle(files), hashFunctionBundle(shuffled));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("function bundle hash changes when any file in the closure changes, including a deeply nested one", async () => {
  const root = await writeFixtureProject();
  try {
    const before = hashFunctionBundle(await collectFunctionBundleFiles(root, join(root, "supabase", "functions", "demo", "index.ts")));
    await writeFile(join(root, "shared", "nested", "deep.ts"), "export function deepest() { return 2; }");
    const after = hashFunctionBundle(await collectFunctionBundleFiles(root, join(root, "supabase", "functions", "demo", "index.ts")));
    assert.notEqual(before, after);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
