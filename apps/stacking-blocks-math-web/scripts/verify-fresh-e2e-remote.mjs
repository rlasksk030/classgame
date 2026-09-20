#!/usr/bin/env node
/* Real remote verification against the fresh-e2e TEST Supabase project only.
 * Reads .env.fresh-e2e.local (never printed). Blocks production ref. Redacts secrets in output.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const MARK = (s) => `VERIFY_FRESH_E2E_${s}`;

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
    } catch { /* ignore, no production ref recorded */ }
  }
}
if (env.SUPABASE_TEST_PROJECT_REF !== "bykgkjwysliyqjqttabe") stop("UNEXPECTED_TARGET", "fresh-e2e project ref가 아닙니다.");

const results = {};
const errors = [];
function pass(name) { results[name] = "PASS"; }
function fail(name, msg) { results[name] = `FAIL: ${msg}`; errors.push(`${name}: ${msg}`); }

function redact(text) {
  return String(text).replace(/(pin|token|secret|password|service.?role)[^,}\s]*/gi, "[REDACTED]");
}

async function api(body, headers = {}) {
  const res = await fetch(`${url}/functions/v1/student-api`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}
async function authApi(body) {
  const res = await fetch(`${url}/functions/v1/student-auth`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
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

const LEAK_KEY_PATTERN = /^(answer|hidden_validation_json|hiddenvalidation|solution|correctanswer|answerblocks|targetblocks|correct_index|correctindex|pin_plain|pinplain)$/i;
function scanForLeaks(obj) {
  const hits = [];
  function walk(v, p) {
    if (v && typeof v === "object") {
      if (Array.isArray(v)) { v.forEach((item, i) => walk(item, `${p}[${i}]`)); return; }
      for (const k of Object.keys(v)) {
        if (LEAK_KEY_PATTERN.test(k)) hits.push(`${p}.${k}`);
        walk(v[k], `${p}.${k}`);
      }
    }
  }
  walk(obj, "root");
  return hits;
}

const CUBE_BLOCKS = [
  { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 1 },
  { x: 0, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 0, y: 1, z: 0 },
];

async function ensureFixtureClassAndStudents(authHeader) {
  const classesRes = await api({ action: "teacher:classes" }, authHeader);
  if (!classesRes.ok) throw new Error(`CLASS_LIST_FAILED ${redact(JSON.stringify(classesRes.json))}`);
  let klass = (classesRes.json.classes || []).find((c) => c.name === MARK("CLASS"));
  if (!klass) {
    const created = await api({ action: "teacher:class-upsert", name: MARK("CLASS") }, authHeader);
    if (!created.ok) throw new Error(`CLASS_CREATE_FAILED ${redact(JSON.stringify(created.json))}`);
    klass = created.json.class;
  }
  const listed = await api({ action: "teacher:students:list", classId: String(klass.id) }, authHeader);
  const existingStudents = listed.json.students || [];
  const students = [];
  for (let i = 0; i < 3; i += 1) {
    const name = MARK(`STUDENT_${i + 1}`);
    const existing = existingStudents.find((s) => s.name === name);
    let studentId; let pin;
    if (existing) {
      studentId = existing.id;
      if (/^\d{4}$/.test(String(existing.pinPlain || ""))) {
        pin = existing.pinPlain;
      } else {
        const reset = await api({ action: "teacher:students:pin-reset", studentId }, authHeader);
        pin = reset.json.pinPlain;
      }
    } else {
      const created = await api({ action: "teacher:students:create", classId: String(klass.id), name, studentNo: i + 1 }, authHeader);
      if (!created.ok) throw new Error(`STUDENT_CREATE_FAILED ${redact(JSON.stringify(created.json))}`);
      studentId = created.json.student.id;
      pin = created.json.pinPlain;
    }
    const login = await authApi({ action: "login", classCode: klass.class_code, name, pin });
    if (!login.ok || !login.json.token) throw new Error(`STUDENT_LOGIN_FAILED ${redact(JSON.stringify(login.json))}`);
    students.push({ id: studentId, name, pin, token: login.json.token, classCode: klass.class_code });
  }
  return { klass, students };
}

async function main() {
  const teacherToken = await teacherLogin();
  const authHeader = { Authorization: `Bearer ${teacherToken}` };
  const { klass, students } = await ensureFixtureClassAndStudents(authHeader);
  const s0 = students[0];
  const studentHeader = (token) => ({ "x-student-token": token });

  // --- Setup: unlock lessons 1, 9, 12 for this class (idempotent) ---
  for (const lesson of [1, 5, 9, 12]) {
    await api({ action: "teacher:lessons:set-lock", classId: String(klass.id), lesson, locked: false }, authHeader);
  }

  // ===== A. Lesson progression: real correct-answer submit -> completion -> unlock contract =====
  // L1-01 is a fixed-migration seed problem (id/answer are identical across every TEST/PROD install).
  const L1_01_ID = "48d7823d-6c0b-4d24-8d32-abe6cdefc745";
  try {
    const before = await api({ action: "problem", problemId: L1_01_ID, lesson: 1 }, studentHeader(s0.token));
    if (!before.ok) throw new Error(`problem fetch failed ${redact(JSON.stringify(before.json)).slice(0, 200)}`);
    const submit = await api({ action: "attempt", problemId: L1_01_ID, submission: { kind: "count", value: 3 } }, studentHeader(s0.token));
    if (!submit.ok || submit.json.grade?.correct !== true) throw new Error(`correct-answer submit not graded correct ${redact(JSON.stringify(submit.json)).slice(0, 200)}`);
    const after = await api({ action: "problem", problemId: L1_01_ID, lesson: 1 }, studentHeader(s0.token));
    if (!after.json.attempt?.completed) throw new Error("problem not marked completed after correct submission");
    const posSave = await api({ action: "position", problemId: L1_01_ID, lesson: 1 }, studentHeader(s0.token));
    if (!posSave.ok || !posSave.json.ok) throw new Error(`position save failed ${redact(JSON.stringify(posSave.json)).slice(0, 200)}`);
    const lp2 = await api({ action: "lessonProblems", lesson: 1 }, studentHeader(s0.token));
    if (lp2.json.currentProblemId !== L1_01_ID) throw new Error("saved position did not restore on reload");
    // relogin (fresh token) and confirm both completion and position persisted server-side, not client memory
    const relogin = await authApi({ action: "login", classCode: s0.classCode, name: s0.name, pin: s0.pin });
    if (!relogin.ok || !relogin.json.token) throw new Error(`relogin failed ${redact(JSON.stringify(relogin.json)).slice(0, 200)}`);
    const afterRelogin = await api({ action: "problem", problemId: L1_01_ID, lesson: 1 }, studentHeader(relogin.json.token));
    if (!afterRelogin.json.attempt?.completed) throw new Error("completion lost after relogin");
    const lp3 = await api({ action: "lessonProblems", lesson: 1 }, studentHeader(relogin.json.token));
    if (lp3.json.currentProblemId !== L1_01_ID) throw new Error("position lost after relogin");
    pass("A_lesson_progression_real_correct_submit_unlocks_and_persists");
  } catch (e) { fail("A_lesson_progression_real_correct_submit_unlocks_and_persists", e.message); }

  // ===== B. Lesson 12 self-evaluation (reflection) restore: refresh + relogin =====
  try {
    const saved = await api({ action: "reflection:save", lesson: 12, curriculumVersion: "v1", confidence: 5, favoriteConcept: MARK("CONCEPT"), selfPraise: MARK("PRAISE"), installationId: String(klass.id) }, studentHeader(s0.token));
    if (!saved.ok) throw new Error(`reflection:save failed ${redact(JSON.stringify(saved.json)).slice(0, 200)}`);
    const gotSameSession = await api({ action: "reflection:get", lesson: 12, curriculumVersion: "v1", installationId: String(klass.id) }, studentHeader(s0.token));
    if (gotSameSession.json.reflection?.favorite_concept !== MARK("CONCEPT")) throw new Error("reflection did not restore within same session (refresh-equivalent)");
    const relogin = await authApi({ action: "login", classCode: s0.classCode, name: s0.name, pin: s0.pin });
    if (!relogin.ok || !relogin.json.token) throw new Error(`relogin failed ${redact(JSON.stringify(relogin.json)).slice(0, 200)}`);
    const gotAfterRelogin = await api({ action: "reflection:get", lesson: 12, curriculumVersion: "v1", installationId: String(klass.id) }, studentHeader(relogin.json.token));
    if (gotAfterRelogin.json.reflection?.favorite_concept !== MARK("CONCEPT")) throw new Error("reflection did not restore after relogin");
    if (gotAfterRelogin.json.reflection?.self_praise !== MARK("PRAISE")) throw new Error("reflection self_praise field did not restore after relogin");
    pass("B_lesson12_reflection_restore");
  } catch (e) { fail("B_lesson12_reflection_restore", e.message); }

  // ===== C. Lesson 9 answer-leakage check: system default + student-created (friend) problem =====
  try {
    const lp9 = await api({ action: "lessonProblems", lesson: 9 }, studentHeader(s0.token));
    if (!lp9.ok) throw new Error(`lesson9 lessonProblems failed ${redact(JSON.stringify(lp9.json)).slice(0, 200)}`);
    const defaultLeaks = scanForLeaks(lp9.json);
    if (defaultLeaks.length) throw new Error(`default-problem leak keys: ${defaultLeaks.join(",")}`);
    pass("C_lesson9_default_no_leak");
  } catch (e) { fail("C_lesson9_default_no_leak", e.message); }

  try {
    const s1 = students[1];
    const published = await api({ action: "peer-problem:publish", title: MARK("PEER9"), blocks: CUBE_BLOCKS, cardType: "top", hintType: "heightMap", installationId: String(klass.id) }, studentHeader(s0.token));
    if (!published.ok) throw new Error(`peer-problem:publish failed ${redact(JSON.stringify(published.json)).slice(0, 200)}`);
    const publishLeaks = scanForLeaks(published.json);
    if (publishLeaks.length) throw new Error(`publish response leak keys: ${publishLeaks.join(",")}`);
    const list = await api({ action: "peer-problem:list", installationId: String(klass.id) }, studentHeader(s1.token));
    if (!list.ok) throw new Error(`peer-problem:list failed ${redact(JSON.stringify(list.json)).slice(0, 200)}`);
    const listLeaks = scanForLeaks(list.json);
    if (listLeaks.length) throw new Error(`friend-problem list leak keys: ${listLeaks.join(",")}`);
    const problemId = published.json.problem?.problemId ?? published.json.problemId;
    const version = published.json.problem?.version ?? published.json.version;
    const got = await api({ action: "peer-problem:get", problemId, version, installationId: String(klass.id) }, studentHeader(s1.token));
    if (!got.ok) throw new Error(`peer-problem:get failed ${redact(JSON.stringify(got.json)).slice(0, 200)}`);
    const getLeaks = scanForLeaks(got.json);
    if (getLeaks.length) throw new Error(`friend-problem get leak keys: ${getLeaks.join(",")}`);
    pass("C_lesson9_friend_no_leak");
  } catch (e) { fail("C_lesson9_friend_no_leak", e.message); }

  // ===== D. Lesson 12 core flow smoke: common + custom(peer) problem + progress + reflection =====
  try {
    const lp12 = await api({ action: "lessonProblems", lesson: 12 }, studentHeader(s0.token));
    if (!lp12.ok || !Array.isArray(lp12.json.problems)) throw new Error(`lesson12 lessonProblems failed ${redact(JSON.stringify(lp12.json)).slice(0, 200)}`);
    const progress = { action: "progress:save", lesson: 12, stage: "solve", curriculumVersion: "v1", setId: MARK("SET"), problemId: "p1", problemVersion: 1, questionIndex: 0, answer: { value: 9 }, firstAttemptResult: "incorrect", attemptCount: 1, hintLevel: 0, finalResult: null, remediationStatus: "needed", installationId: String(klass.id) };
    const savedProgress = await api(progress, studentHeader(s0.token));
    if (!savedProgress.ok) throw new Error(`progress:save failed ${redact(JSON.stringify(savedProgress.json)).slice(0, 200)}`);
    const gotProgress = await api({ action: "progress:get", lesson: 12, setId: MARK("SET"), installationId: String(klass.id) }, studentHeader(s0.token));
    const progressRows = gotProgress.json.records ?? gotProgress.json.progress;
    if (!gotProgress.ok || !Array.isArray(progressRows) || progressRows.length === 0) throw new Error(`progress:get failed ${redact(JSON.stringify(gotProgress.json)).slice(0, 200)}`);
    pass("D_lesson12_core_flow");
  } catch (e) { fail("D_lesson12_core_flow", e.message); }

  // ===== E. Lesson skip: teacher unlocks a non-adjacent lesson (5), student reaches it =====
  try {
    const unlocked = await api({ action: "teacher:lessons:set-lock", classId: String(klass.id), lesson: 5, locked: false }, authHeader);
    if (!unlocked.ok) throw new Error(`teacher:lessons:set-lock failed ${redact(JSON.stringify(unlocked.json)).slice(0, 200)}`);
    const home = await api({ action: "home" }, studentHeader(s0.token));
    if (!home.ok) throw new Error(`home fetch failed ${redact(JSON.stringify(home.json)).slice(0, 200)}`);
    const lesson5 = (home.json.student?.lessons || []).find((l) => l.lesson === 5);
    if (!lesson5 || lesson5.locked) throw new Error("lesson 5 still locked after teacher skip-unlock");
    const lp5 = await api({ action: "lessonProblems", lesson: 5 }, studentHeader(s0.token));
    if (!lp5.ok || !Array.isArray(lp5.json.problems) || lp5.json.problems.length === 0) throw new Error(`lesson5 problems unavailable after skip-unlock ${redact(JSON.stringify(lp5.json)).slice(0, 200)}`);
    pass("E_lesson_skip_representative");
  } catch (e) { fail("E_lesson_skip_representative", e.message); }

  const artifactDir = path.join(root, "qa", "fresh-e2e-remote");
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactPath = path.join(artifactDir, "REMOTE_VERIFICATION_RESULT.json");
  fs.writeFileSync(artifactPath, JSON.stringify({ generatedAt: new Date().toISOString(), projectRef: env.SUPABASE_TEST_PROJECT_REF, results }, null, 2) + "\n");

  console.log("=== FRESH-E2E REMOTE VERIFICATION ===");
  for (const [k, v] of Object.entries(results)) console.log(`${k}: ${v}`);
  console.log(`artifact=${artifactPath}`);
  if (errors.length) { console.log(`OVERALL: FAIL (${errors.length} failing)`); process.exitCode = 1; }
  else console.log("OVERALL: PASS");
}

main().catch((e) => { console.error("RUNNER_ERROR:", redact(e.stack || e.message || String(e))); process.exitCode = 1; });
