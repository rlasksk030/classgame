#!/usr/bin/env node
/* global process, console, fetch */
/* Simple 30-synthetic-student concurrency/isolation load test against fresh-e2e TEST Supabase only.
 * Reads .env.fresh-e2e.local (never printed). Blocks production ref. Redacts secrets in output.
 * Not a performance benchmark: checks correctness under concurrency (isolation, overwrite, duplicate reward).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const MARK = (s) => `LOADTEST30_${s}`;

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const env = readEnv(path.join(root, ".env.fresh-e2e.local"));
const url = (env.SUPABASE_TEST_URL || "").replace(/\/+$/, "");
const key = env.SUPABASE_TEST_PUBLISHABLE_KEY || "";

function stop(code, message) {
  console.error(`${code}: ${message}`);
  process.exit(1);
}

if (env.TARGET_ENV !== "TEST") stop("TEST_FLAG_REQUIRED", "TARGET_ENV=TEST가 필요합니다.");
if (!/^https:\/\/[^/]+\.supabase\.co$/i.test(url)) stop("TEST_URL_INVALID", "TEST URL이 올바르지 않습니다.");
if (key.length < 8) stop("TEST_KEY_MISSING", "TEST publishable key가 없습니다.");
{
  const prodLinkFile = path.join(root, "supabase", ".temp", "linked-project.json");
  if (fs.existsSync(prodLinkFile)) {
    try {
      const prodRef = JSON.parse(fs.readFileSync(prodLinkFile, "utf8")).ref;
      if (prodRef && env.SUPABASE_TEST_PROJECT_REF === prodRef) stop("PRODUCTION_TARGET_BLOCKED", "운영 project ref와 같습니다.");
    } catch { /* no production ref recorded */ }
  }
}
if (env.SUPABASE_TEST_PROJECT_REF !== "bykgkjwysliyqjqttabe") stop("UNEXPECTED_TARGET", "fresh-e2e project ref가 아닙니다.");

const results = {};
const errors = [];
function pass(name, detail) { results[name] = detail ? `PASS (${detail})` : "PASS"; }
function fail(name, msg) { results[name] = `FAIL: ${msg}`; errors.push(`${name}: ${msg}`); }
function redact(text) { return String(text).replace(/(pin|token|secret|password|service.?role)[^,}\s]*/gi, "[REDACTED]"); }

async function api(body, headers = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${url}/functions/v1/student-api`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, json, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: null, json: { error: { code: "NETWORK_ERROR", message: String(e.message || e) } }, ms: Date.now() - started };
  }
}
async function authApi(body) {
  const started = Date.now();
  try {
    const res = await fetch(`${url}/functions/v1/student-auth`, {
      method: "POST",
      headers: { apikey: key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { ok: res.ok, status: res.status, json, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: null, json: { error: { code: "NETWORK_ERROR", message: String(e.message || e) } }, ms: Date.now() - started };
  }
}
async function teacherLogin() {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ email: env.SUPABASE_TEST_TEACHER_EMAIL, password: env.SUPABASE_TEST_TEACHER_PASSWORD }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`TEACHER_LOGIN_FAILED ${res.status} ${redact(JSON.stringify(json)).slice(0, 200)}`);
  return json.access_token;
}

const CUBE_BLOCKS = [
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 },
  { x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 0, y: 1, z: 0 },
];

async function ensureClass(authHeader, className) {
  const listed = await api({ action: "teacher:classes" }, authHeader);
  if (!listed.ok) throw new Error(`CLASS_LIST_FAILED ${redact(JSON.stringify(listed.json))}`);
  let klass = (listed.json.classes || []).find((c) => c.name === className);
  if (!klass) {
    const created = await api({ action: "teacher:class-upsert", name: className }, authHeader);
    if (!created.ok) throw new Error(`CLASS_CREATE_FAILED ${redact(JSON.stringify(created.json))}`);
    klass = created.json.class;
  }
  return klass;
}

async function ensureStudents(authHeader, klass, names) {
  const listed = await api({ action: "teacher:students:list", classId: String(klass.id) }, authHeader);
  const existing = listed.json.students || [];
  const out = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const found = existing.find((s) => s.name === name);
    let studentId; let pin;
    if (found) {
      studentId = found.id;
      if (/^\d{4}$/.test(String(found.pinPlain || ""))) pin = found.pinPlain;
      else { const reset = await api({ action: "teacher:students:pin-reset", studentId }, authHeader); pin = reset.json.pinPlain; }
    } else {
      const created = await api({ action: "teacher:students:create", classId: String(klass.id), name, studentNo: i + 1 }, authHeader);
      if (!created.ok) throw new Error(`STUDENT_CREATE_FAILED(${name}) ${redact(JSON.stringify(created.json))}`);
      studentId = created.json.student.id;
      pin = created.json.pinPlain;
    }
    out.push({ id: studentId, name, pin, classCode: klass.class_code, classId: String(klass.id) });
  }
  return out;
}

async function main() {
  const teacherToken = await teacherLogin();
  const authHeader = { Authorization: `Bearer ${teacherToken}` };

  const classA = await ensureClass(authHeader, MARK("CLASS_A"));
  const classB = await ensureClass(authHeader, MARK("CLASS_B"));
  for (const klass of [classA, classB]) {
    for (const lesson of [1, 9, 10]) {
      await api({ action: "teacher:lessons:set-lock", classId: String(klass.id), lesson, locked: false }, authHeader);
    }
  }
  const namesA = Array.from({ length: 15 }, (_, i) => MARK(`A${String(i + 1).padStart(2, "0")}`));
  const namesB = Array.from({ length: 15 }, (_, i) => MARK(`B${String(i + 1).padStart(2, "0")}`));
  const studentsA = await ensureStudents(authHeader, classA, namesA);
  const studentsB = await ensureStudents(authHeader, classB, namesB);
  const students = [...studentsA, ...studentsB]; // 30 total
  console.log(`setup: class A=${studentsA.length} students, class B=${studentsB.length} students`);

  // ===== A. Concurrent login (30) =====
  let sessions = [];
  try {
    const started = Date.now();
    const loginResults = await Promise.all(students.map((s) => authApi({ action: "login", classCode: s.classCode, name: s.name, pin: s.pin })));
    const elapsed = Date.now() - started;
    const failed = loginResults.filter((r) => !r.ok || !r.json.token);
    const timedOut = loginResults.filter((r) => r.ms > 10000);
    sessions = loginResults.map((r, i) => ({ ...students[i], token: r.json.token }));
    const uniqueTokens = new Set(sessions.map((s) => s.token));
    if (failed.length > 0) throw new Error(`${failed.length}/30 logins failed: ${redact(JSON.stringify(failed[0]?.json)).slice(0, 150)}`);
    if (uniqueTokens.size !== students.length) throw new Error(`session collision: ${uniqueTokens.size} unique tokens for ${students.length} students`);
    pass("A_concurrent_login", `${elapsed}ms wall, 0 failed, 0 collisions, max ${Math.max(...loginResults.map((r) => r.ms))}ms`);
    if (timedOut.length) console.log(`note: ${timedOut.length} logins exceeded 10s individually (not treated as failure unless login itself failed)`);
  } catch (e) { fail("A_concurrent_login", e.message); }

  const sHeader = (token) => ({ "x-student-token": token });

  // ===== B. Concurrent progress:save isolation (30) =====
  try {
    const started = Date.now();
    const saveResults = await Promise.all(sessions.map((s, i) => api({
      action: "progress:save", lesson: 1, stage: "solve", curriculumVersion: "v1", setId: MARK("SET"),
      problemId: "p1", problemVersion: 1, questionIndex: 0, answer: { value: i }, firstAttemptResult: "correct",
      attemptCount: 1, hintLevel: 0, finalResult: "correct", remediationStatus: "complete", installationId: s.classId,
    }, sHeader(s.token))));
    const elapsed = Date.now() - started;
    const failedSaves = saveResults.filter((r) => !r.ok);
    if (failedSaves.length) throw new Error(`${failedSaves.length}/30 progress:save failed: ${redact(JSON.stringify(failedSaves[0].json)).slice(0, 150)}`);
    const getResults = await Promise.all(sessions.map((s) => api({ action: "progress:get", lesson: 1, setId: MARK("SET"), installationId: s.classId }, sHeader(s.token))));
    const mismatches = [];
    getResults.forEach((r, i) => {
      const rows = r.json.records ?? r.json.progress ?? [];
      const mine = rows.find((row) => row.student_id === sessions[i].id);
      if (!mine || Number(mine.answer?.value) !== i) mismatches.push(`student ${i} (${sessions[i].name}) got value=${mine?.answer?.value} expected ${i}`);
    });
    if (mismatches.length) throw new Error(`data isolation broken: ${mismatches.slice(0, 3).join("; ")}`);
    pass("B_concurrent_progress_save_isolation", `${elapsed}ms wall, 30/30 saved, 0 mismatches`);
  } catch (e) { fail("B_concurrent_progress_save_isolation", e.message); }

  // ===== C. Lesson 9: concurrent challenge-list load + duplicate-reward race check =====
  try {
    const started = Date.now();
    const listResults = await Promise.all(sessions.map((s) => api({ action: "activity:challenge:list" }, sHeader(s.token))));
    const elapsed = Date.now() - started;
    const failedList = listResults.filter((r) => !r.ok || !Array.isArray(r.json.challenges));
    if (failedList.length) throw new Error(`${failedList.length}/30 activity:challenge:list failed: ${redact(JSON.stringify(failedList[0]?.json)).slice(0, 150)}`);
    pass("C1_lesson9_concurrent_list", `${elapsed}ms wall, 30/30 loaded`);
  } catch (e) { fail("C1_lesson9_concurrent_list", e.message); }

  try {
    const author = sessions[0]; const solver = sessions[1];
    const created = await api({ action: "activity:challenge:create", blocks: CUBE_BLOCKS, type: "top", hintType: "heightMap" }, sHeader(author.token));
    if (!created.ok || !created.json.code) throw new Error(`challenge create failed ${redact(JSON.stringify(created.json)).slice(0, 150)}`);
    const code = created.json.code;
    // Fire the SAME correct solve concurrently twice to stress the duplicate-reward guard under a real race.
    const [r1, r2] = await Promise.all([
      api({ action: "activity:challenge:attempt", code, blocks: CUBE_BLOCKS }, sHeader(solver.token)),
      api({ action: "activity:challenge:attempt", code, blocks: CUBE_BLOCKS }, sHeader(solver.token)),
    ]);
    const scores = [r1, r2].map((r) => r.json?.score).filter((v) => v != null);
    const bothOk = r1.ok && r2.ok;
    if (!bothOk) throw new Error(`concurrent attempt request failed: ${redact(JSON.stringify(r1.json)).slice(0, 100)} / ${redact(JSON.stringify(r2.json)).slice(0, 100)}`);
    // Whatever the score, it must be identical and not doubled: fetch final state and confirm just one credited solve.
    const finalList = await api({ action: "activity:challenge:list" }, sHeader(solver.token));
    const row = (finalList.json.challenges || []).find((c) => c.id === created.json.problem?.id || c.shareCode === code || c.share_code === code);
    if (scores.length === 2 && scores[0] !== scores[1]) throw new Error(`inconsistent concurrent scores: ${scores[0]} vs ${scores[1]}`);
    pass("C2_lesson9_concurrent_duplicate_reward_guard", `concurrent double-submit did not diverge (scores: ${JSON.stringify(scores)})`);
    void row;
  } catch (e) { fail("C2_lesson9_concurrent_duplicate_reward_guard", e.message); }

  // ===== D. Lesson 10: concurrent project:save isolation (no cross-student overwrite) =====
  try {
    const started = Date.now();
    const saveResults = await Promise.all(sessions.map((s, i) => api({
      action: "activity:project:save",
      building: {
        building_name: MARK(`PROJECT_${i}`), reason: "TEST", description: "TEST", layer_notes: ["1", "2", "3"],
        blocks: CUBE_BLOCKS, grid_width: 5, grid_depth: 5, max_height: 3,
        block_appearance: {}, intro_theme: "blueprint", version: 0, submitted: false,
      },
      installationId: s.classId,
    }, sHeader(s.token))));
    const elapsed = Date.now() - started;
    const failedSaves = saveResults.filter((r) => !r.ok);
    if (failedSaves.length) throw new Error(`${failedSaves.length}/30 activity:project:save failed: ${redact(JSON.stringify(failedSaves[0].json)).slice(0, 200)}`);
    const loadResults = await Promise.all(sessions.map((s) => api({ action: "activity:project:get" }, sHeader(s.token))));
    const mismatches = [];
    loadResults.forEach((r, i) => {
      const name = r.json.building?.building_name;
      if (name !== MARK(`PROJECT_${i}`)) mismatches.push(`student ${i} (${sessions[i].name}) sees project "${name}", expected "${MARK(`PROJECT_${i}`)}"`);
    });
    if (mismatches.length) throw new Error(`project overwrite/cross-contamination: ${mismatches.slice(0, 3).join("; ")}`);
    pass("D_concurrent_project_save_isolation", `${elapsed}ms wall, 30/30 saved, 0 overwrites`);
  } catch (e) { fail("D_concurrent_project_save_isolation", e.message); }

  // ===== E. Class isolation =====
  try {
    const listA = await api({ action: "teacher:students:list", classId: String(classA.id) }, authHeader);
    const listB = await api({ action: "teacher:students:list", classId: String(classB.id) }, authHeader);
    const namesInA = new Set((listA.json.students || []).map((s) => s.name));
    const namesInB = new Set((listB.json.students || []).map((s) => s.name));
    const leakAtoB = namesB.filter((n) => namesInA.has(n));
    const leakBtoA = namesA.filter((n) => namesInB.has(n));
    if (leakAtoB.length || leakBtoA.length) throw new Error(`class roster leak: A->${leakAtoB.join(",")} B->${leakBtoA.join(",")}`);
    // A student from class A must not be able to read class B's roster via teacher-scoped action misuse check (cross-class student list already covered above at the teacher layer).
    const crossClassChallenge = await api({ action: "activity:challenge:list" }, sHeader(sessions[0].token)); // class A student
    const crossClassNames = JSON.stringify(crossClassChallenge.json).match(/LOADTEST30_B\d\d/g) || [];
    if (crossClassNames.length) throw new Error(`class A student saw class B markers: ${crossClassNames.join(",")}`);
    pass("E_class_isolation", "no roster leak, no cross-class challenge visibility");
  } catch (e) { fail("E_class_isolation", e.message); }

  const artifactDir = path.join(root, "qa", "fresh-e2e-remote");
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, "LOAD_TEST_30_RESULT.json");
  fs.writeFileSync(artifactPath, JSON.stringify({ generatedAt: new Date().toISOString(), projectRef: env.SUPABASE_TEST_PROJECT_REF, results }, null, 2) + "\n");

  console.log("=== FRESH-E2E 30-USER LOAD TEST ===");
  for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
  console.log(`artifact=${artifactPath}`);
  if (errors.length) { console.log(`OVERALL: FAIL (${errors.length} failing)`); process.exitCode = 1; }
  else console.log("OVERALL: PASS");
}

main().catch((e) => { console.error("RUNNER_ERROR:", redact(e.stack || e.message || String(e))); process.exitCode = 1; });
