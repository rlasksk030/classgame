import fs from "node:fs";
import path from "node:path";

type Env = Record<string, string>;

const root = process.cwd();
const envFile = process.env.SUPABASE_TEST_ENV_FILE ?? path.join(root, ".env.test.local");

function readEnvFile(file: string): Env {
  if (!fs.existsSync(file)) return {};
  const result: Env = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const fileEnv = readEnvFile(envFile);
const value = (name: string): string => process.env[name] ?? fileEnv[name] ?? "";

function fail(code: string, message: string): never {
  console.error(`${code}: ${message}`);
  process.exitCode = 1;
  throw new Error(code);
}

function linkedProductionRef(): string {
  const file = path.join(root, "supabase", ".temp", "linked-project.json");
  if (!fs.existsSync(file)) fail("PRODUCTION_LINK_MISSING", "운영 프로젝트 식별 정보가 없어 안전하게 중단했습니다.");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { ref?: unknown };
    if (typeof parsed.ref !== "string" || !parsed.ref.trim()) throw new Error("missing ref");
    return parsed.ref.trim();
  } catch {
    fail("PRODUCTION_LINK_INVALID", "운영 프로젝트 식별 정보를 읽을 수 없어 안전하게 중단했습니다.");
  }
}

async function main(): Promise<void> {
  if (value("TARGET_ENV") !== "TEST") {
    fail("TEST_FLAG_REQUIRED", "TARGET_ENV=TEST인 경우에만 TEST 연결 확인을 실행할 수 있습니다.");
  }

  const projectRef = value("SUPABASE_TEST_PROJECT_REF").trim();
  const supabaseUrl = value("SUPABASE_TEST_URL").trim().replace(/\/+$/, "");
  const publishableKey = value("SUPABASE_TEST_PUBLISHABLE_KEY").trim();
  if (!/^[a-z0-9-]{1,80}$/.test(projectRef)) fail("TEST_PROJECT_REF_MISSING", "TEST project ref가 없거나 형식이 올바르지 않습니다.");
  if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(supabaseUrl)) fail("TEST_URL_INVALID", "TEST URL은 https://<project-ref>.supabase.co 형식이어야 합니다.");
  if (publishableKey.length < 8) fail("TEST_KEY_MISSING", "TEST publishable/anon key가 없습니다.");
  const lowered = publishableKey.toLowerCase();
  if (lowered.includes("service_role") || lowered.includes("secret") || lowered.includes("password")) {
    fail("TEST_KEY_IS_SECRET", "service_role/secret 값은 publishable key 위치에 사용할 수 없습니다.");
  }

  const productionRef = linkedProductionRef();
  if (projectRef === productionRef) fail("PRODUCTION_TARGET_BLOCKED", "TEST ref가 운영 프로젝트와 같아 안전하게 중단했습니다.");
  const expectedHost = `${projectRef}.supabase.co`.toLowerCase();
  if (new URL(supabaseUrl).host.toLowerCase() !== expectedHost) {
    fail("TEST_REF_URL_MISMATCH", "TEST project ref와 URL이 일치하지 않습니다.");
  }

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: publishableKey } });
  } catch {
    fail("TEST_NETWORK_ERROR", "TEST Supabase에 연결하지 못했습니다.");
  }
  if (!response.ok) fail("TEST_CONNECTION_FAILED", `TEST Supabase 연결 확인이 HTTP ${response.status}로 거부되었습니다.`);

  console.log("TEST Supabase connectivity: PASS (target is explicitly TEST and differs from production)");
}

main().catch(() => {
  // fail() already emitted a safe, non-secret error and set a non-zero exit code.
});
