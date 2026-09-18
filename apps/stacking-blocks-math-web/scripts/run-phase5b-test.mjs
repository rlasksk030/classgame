#!/usr/bin/env node
/* global process, console, URL, fetch */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const migrationDir = path.join(root, "supabase", "migrations");
const candidateMigration = path.join(migrationDir, "202609130017_phase5_persistence.sql");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run");
const mode = args.has("--schema-only") ? "schema" : args.has("--functions-only") ? "functions" : args.has("--fixtures-only") ? "fixtures" : args.has("--e2e-only") ? "e2e" : "full";

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

const fileEnv = readEnvFile(process.env.SUPABASE_TEST_ENV_FILE ?? path.join(root, ".env.test.local"));
const env = (name) => process.env[name] ?? fileEnv[name] ?? "";

function stop(code, message) {
  console.error(`${code}: ${message}`);
  process.exitCode = 1;
  throw new Error(code);
}

function productionRef() {
  const file = path.join(root, "supabase", ".temp", "linked-project.json");
  if (!fs.existsSync(file)) stop("PRODUCTION_LINK_MISSING", "운영 project ref를 확인할 수 없어 중단했습니다.");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed.ref !== "string" || !parsed.ref.trim()) throw new Error("ref missing");
    return parsed.ref.trim();
  } catch {
    stop("PRODUCTION_LINK_INVALID", "운영 project ref 정보가 올바르지 않아 중단했습니다.");
  }
}

function target() {
  if (env("TARGET_ENV") !== "TEST") stop("TEST_FLAG_REQUIRED", "TARGET_ENV=TEST인 경우에만 실행할 수 있습니다.");
  const ref = env("SUPABASE_TEST_PROJECT_REF").trim();
  const url = env("SUPABASE_TEST_URL").trim().replace(/\/+$/, "");
  const key = env("SUPABASE_TEST_PUBLISHABLE_KEY").trim();
  if (!/^[a-z0-9-]{1,80}$/.test(ref)) stop("TEST_PROJECT_REF_MISSING", "TEST project ref가 없거나 형식이 올바르지 않습니다.");
  if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(url)) stop("TEST_URL_INVALID", "TEST URL 형식이 올바르지 않습니다.");
  if (key.length < 8) stop("TEST_KEY_MISSING", "TEST publishable/anon key가 없습니다.");
  const lower = key.toLowerCase();
  if (lower.includes("service_role") || lower.includes("secret") || lower.includes("password")) stop("TEST_KEY_IS_SECRET", "publishable key 자리에 service role/secret을 넣을 수 없습니다.");
  const prod = productionRef();
  if (ref === prod) stop("PRODUCTION_TARGET_BLOCKED", "TEST ref가 운영 ref와 같아 중단했습니다.");
  if (new URL(url).host.toLowerCase() !== `${ref}.supabase.co`.toLowerCase()) stop("TEST_REF_URL_MISMATCH", "TEST ref와 URL이 일치하지 않습니다.");
  return { ref, url, key, prod };
}

async function connectivity(t) {
  let response;
  try {
    response = await fetch(`${t.url}/auth/v1/settings`, { headers: { apikey: t.key } });
  } catch {
    stop("TEST_NETWORK_ERROR", "TEST Supabase에 연결하지 못했습니다.");
  }
  if (!response.ok) stop("TEST_CONNECTION_FAILED", `TEST Supabase 연결이 HTTP ${response.status}로 거부되었습니다.`);
}

function staticMigrationCheck() {
  if (!fs.existsSync(candidateMigration)) stop("PHASE5_MIGRATION_MISSING", "Phase 5 migration 후보가 없습니다.");
  const sql = fs.readFileSync(candidateMigration, "utf8");
  if (/drop\s+(table|column)|truncate\s+table|delete\s+from/i.test(sql)) stop("PHASE5_MIGRATION_UNSAFE", "후보 migration에 destructive SQL이 있어 중단했습니다.");
  for (const required of ["begin;", "commit;", "enable row level security", "revoke all on public.sb_student_created_problems from anon", "hidden_validation_json", "unique (installation_id, idempotency_key)"]) {
    if (!sql.toLowerCase().includes(required.toLowerCase())) stop("PHASE5_MIGRATION_CONTRACT", `후보 migration 계약 누락: ${required}`);
  }
  const files = fs.readdirSync(migrationDir).filter((name) => /^202\d+_.+\.sql$/.test(name)).sort();
  if (!files.includes(path.basename(candidateMigration))) stop("PHASE5_MIGRATION_ORDER", "후보 migration이 migration 목록에 없습니다.");
  return files;
}

let resolvedCli;
function resolveCli() {
  if (resolvedCli) return resolvedCli;
  const local = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "supabase.cmd" : "supabase");
  if (fs.existsSync(local)) return (resolvedCli = { command: local, prefix: [], source: "project" });
  // --no-install is intentional: a runner must never download an unpinned package.
  const npxProbe = spawnSync("npx", ["--no-install", "supabase", "--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!npxProbe.error && npxProbe.status === 0) return (resolvedCli = { command: "npx", prefix: ["--no-install", "supabase"], source: "npx" });
  const globalProbe = spawnSync("supabase", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (!globalProbe.error && globalProbe.status === 0) return (resolvedCli = { command: "supabase", prefix: [], source: "global" });
  stop("SUPABASE_CLI_MISSING", "프로젝트·npx --no-install·전역 Supabase CLI를 찾지 못했습니다.");
}

function runCli(args, options = {}) {
  const cli = resolveCli();
  return spawnSync(cli.command, [...cli.prefix, ...args], options);
}

function cliVersion() {
  const result = runCli(["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) stop("SUPABASE_CLI_MISSING", "Supabase CLI가 없습니다. Mac에서 CLI 설치·로그인 후 다시 실행하세요.");
  return `${result.stdout ?? ""}`.trim().split(/\s+/).pop() ?? "unknown";
}

function cliSupports(group, command, flag) {
  const result = runCli([group, command, "--help"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0 || !output.includes(flag)) stop("SUPABASE_CLI_FLAG_UNAVAILABLE", `Supabase CLI가 ${group} ${command}의 ${flag} 옵션을 제공하지 않습니다.`);
}

function sourceActionGaps() {
  const source = fs.readFileSync(path.join(root, "supabase", "functions", "student-api", "index.ts"), "utf8");
  const required = [
    "peer-problem:publish", "peer-problem:list", "peer-problem:get", "peer-problem:hint", "peer-problem:submit",
    "peer-problem:attempts", "teacher:peer-problem:list", "teacher:peer-problem:hide", "project:save", "project:load",
    "progress:save", "progress:get", "attempt:save", "practice-set:get-or-create", "reflection:save", "reflection:get",
  ];
  return required.filter((action) => !source.includes(`"${action}"`) && !source.includes(`'${action}'`));
}

function functionFiles() {
  const required = [
    path.join(root, "supabase", "functions", "student-auth", "index.ts"),
    path.join(root, "supabase", "functions", "student-api", "index.ts"),
  ];
  return required.filter((file) => !fs.existsSync(file));
}

function runnerFiles() {
  const file = path.join(root, "scripts", "phase5b-runner.ts");
  return fs.existsSync(file) ? [] : [file];
}

async function confirmation(cli) {
  if (!apply) {
    console.log(`DRY RUN: TARGET=TEST | PROJECT=TEST Supabase | PRODUCTION TARGET=NO | CLI=${cli}`);
    console.log("원격 변경을 하려면 Mac 터미널에서 -- --apply를 붙여 다시 실행하세요.");
    return false;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) stop("INTERACTIVE_CONFIRMATION_REQUIRED", "비대화형 환경에서는 원격 write를 허용하지 않습니다.");
  console.log("TARGET: TEST");
  console.log("PROJECT: TEST Supabase");
  console.log("PRODUCTION TARGET: NO");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Type APPLY_TO_TEST to continue: ");
  rl.close();
  if (answer.trim() !== "APPLY_TO_TEST") stop("CONFIRMATION_NOT_RECEIVED", "확인 문자열이 일치하지 않아 원격 변경을 취소했습니다.");
  return true;
}

function tempSupabaseRoot(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stacking-phase5b-"));
  const supabaseDir = path.join(dir, "supabase");
  fs.mkdirSync(supabaseDir, { recursive: true });
  fs.cpSync(path.join(root, "supabase", "migrations"), path.join(supabaseDir, "migrations"), { recursive: true });
  const config = fs.readFileSync(path.join(root, "supabase", "config.toml"), "utf8").replace(/^project_id\s*=.*$/m, `project_id = "${ref}"`);
  fs.writeFileSync(path.join(supabaseDir, "config.toml"), config);
  return dir;
}

function run(command, args, cwd) {
  const result = command === "supabase" ? runCli(args, { cwd, stdio: "inherit" }) : spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error || result.status !== 0) stop("REMOTE_COMMAND_FAILED", `${command} 실행이 실패했습니다 (단계: ${args.slice(0, 2).join(" ")}).`);
}

function productionLinkSnapshot() {
  const file = path.join(root, "supabase", ".temp", "linked-project.json");
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function linkTestWorkspace(ref, cwd) {
  const result = runCli(["link", "--project-ref", ref], { cwd, stdio: "inherit" });
  if (result.error || result.status !== 0) stop("TEST_LINK_FAILED", "TEST 임시 workspace link에 실패했습니다. db push는 실행하지 않았습니다.");
}

async function main() {
  if (dryRun) {
    target();
    const migrations = staticMigrationCheck();
    const gaps = sourceActionGaps();
    const missingFunctions = functionFiles();
    const missingRunner = runnerFiles();
    if (gaps.length) stop("PHASE5_API_NOT_READY", `student-api에 Phase 5 action ${gaps.length}개가 없어 원격 작업을 시작하지 않았습니다.`);
    if (missingFunctions.length) stop("PHASE5_FUNCTION_MISSING", "필수 Edge Function 파일이 없어 원격 작업을 시작하지 않았습니다.");
    if (missingRunner.length) stop("PHASE5_RUNNER_MISSING", "TEST fixture/E2E runner 파일이 없어 원격 작업을 시작하지 않았습니다.");
    console.log("TEST LINK PLAN: READY | TARGET: TEST | PRODUCTION TARGET: NO | remote=NO | writes=NO");
    console.log(`DRY RUN: TARGET=TEST | ref/url guard=PASS | actions=PASS | migrations=${migrations.length} | functions=PASS | runner=PASS | remote=NO | writes=NO`);
    return;
  }
  const t = target();
  await connectivity(t);
  const migrations = staticMigrationCheck();
  const cli = cliVersion();
  console.log(`TARGET CHECK: PASS | migration files=${migrations.length} | CLI=${cli}`);

  if (mode !== "schema") {
    const gaps = sourceActionGaps();
    if (gaps.length) stop("PHASE5_API_NOT_READY", `student-api에 Phase 5 action ${gaps.length}개가 없어 원격 작업을 시작하지 않았습니다.`);
  }

  if (mode === "fixtures" || mode === "e2e") {
    if (!apply) stop("REMOTE_APPLY_REQUIRED", "TEST fixture/E2E 원격 쓰기는 -- --apply 확인 후 실행합니다.");
    if (!(await confirmation(cli))) return;
    const runnerArgs = mode === "fixtures" ? ["--experimental-strip-types", path.join(root, "scripts", "phase5b-runner.ts"), "--fixtures", "--apply"] : ["--experimental-strip-types", path.join(root, "scripts", "phase5b-runner.ts"), "--e2e", "--apply"];
    const runner = spawnSync(process.execPath, runnerArgs, { cwd: root, stdio: "inherit" });
    if (runner.error || runner.status !== 0) stop("PHASE5_RUNNER_FAILED", "TEST fixture/E2E runner가 실패했습니다.");
    return;
  }
  if (mode === "functions" || mode === "full") cliSupports("functions", "deploy", "--project-ref");
  if (mode === "schema" || mode === "full") cliSupports("db", "push", "--project-ref");

  if (!(await confirmation(cli))) return;
  if (mode === "schema" || mode === "full") {
    const productionBefore = productionLinkSnapshot();
    const temp = tempSupabaseRoot(t.ref);
    try {
      // IPv4-capable link metadata is written only inside the TEST temp workspace.
      linkTestWorkspace(t.ref, temp);
      run("supabase", ["db", "push", "--project-ref", t.ref], temp);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
      const productionAfter = productionLinkSnapshot();
      if (productionBefore?.toString("base64") !== productionAfter?.toString("base64")) stop("PRODUCTION_LINK_CHANGED", "운영 Supabase link metadata가 변경되어 중단했습니다.");
    }
  }
  if (mode === "functions" || mode === "full") {
    run("supabase", ["functions", "deploy", "student-auth", "--project-ref", t.ref], root);
    run("supabase", ["functions", "deploy", "student-api", "--project-ref", t.ref], root);
  }
  console.log("TEST REMOTE PREPARATION: PASS");
}

main().catch(() => {
  // stop() emits a safe message and sets a non-zero exit code.
});
