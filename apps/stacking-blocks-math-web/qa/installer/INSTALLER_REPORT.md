# Phase 7 교사용 간편 설치 보고서

PHASE 7 RESULT: PARTIAL

## 기준

- 브랜치: `feature/spatial-math-redesign-v1`
- 현재 HEAD: `622eb7afde878e41bdbe1ba780de56ce1a4ee6a9`
- 기존 미커밋 변경과 학생·TEST 데이터 보존
- production Supabase, migration, deploy, push, 외부 자원 변경: 없음

## 국어 챗봇 참고

`KOREAN_CHATBOT_REFERENCE: NOT_FOUND`.
현재 로컬 저장소에서 국어 2단원 챗봇의 설치 화면이나 실행 코드를 확인하지 못했다. 따라서 특정 코드를 복사하지 않고 이 프로젝트의 기존 `/setup`, RuntimeSupabaseConfig, TeacherGate, TeacherPage, VersionService 경로를 재사용했다.

## 이번 구현

기존 `/setup`을 8단계 설치 마법사로 확장했다.

1. 시작 / 설치 이어하기
2. Supabase 준비 및 대시보드 바로가기
3. Project URL·Publishable key 연결 확인
4. 자동 설치 상태를 정직하게 표시
5. Supabase Auth 교사 로그인
6. 기존 학급 선택 또는 새 학급 생성
7. 학생 명단 붙여넣기와 일괄 생성, PIN 표시
8. 학생 로그인 smoke 확인 및 학생 접속 링크

구현 파일:

- `src/pages/SetupPage.tsx`
- `src/lib/installer.ts`
- `src/styles/index.css`
- `tests/installer.test.ts`

설치 위치는 `stacking-installer-progress`에 설치 ID·단계·학급 식별자만 저장한다. 교사 비밀번호, 학생 PIN, access token은 저장하지 않는다. Runtime config는 기존 공개 연결 설정 저장 경계를 그대로 사용한다.

## 자동 설치의 실제 범위

정적 Cloudflare SPA와 공개 Publishable key만으로는 Supabase migration, Edge Function 배포, `APP_SESSION_SECRET` 설정을 안전하게 실행할 수 없다. 관리 토큰·service_role을 브라우저에 넣는 우회는 구현하지 않았다.

따라서 4단계는 다음을 명시적으로 표시한다.

- 연결 확인: 가능
- schema/migration 확인·적용: 관리용 실행부 연결 필요
- student-auth/student-api 배포: 관리용 실행부 연결 필요
- APP_SESSION_SECRET 설정: 서버 Secret에서만 수행

설치 완료 화면도 이 세 서버 항목을 완료했다고 가장하지 않는다. 현재 구현은 연결·교사 인증·학급·학생 준비까지의 UI와 정상 API 경로를 제공하며, 안전한 관리용 설치 실행부가 없으므로 `PARTIAL`이다.

## 복구·업데이트

- 설치 단계는 설치 ID별로 이어서 열 수 있다.
- 기존 학급을 먼저 조회하고, 새 학급을 만들 때만 insert한다.
- 학생 생성은 기존 정상 `teacher:students:create`를 사용한다.
- 단계 진행 상태만 재개하며 PIN·비밀번호를 저장하지 않는다.
- schema/function/Secret의 부분 실패 복구와 버전별 업데이트는 관리용 실행부가 없어 NOT_IMPLEMENTED다.
- 기존 학생·PIN·진도·작품을 삭제하거나 초기화하는 동작은 추가하지 않았다.

## 보안

- service_role·management token·APP_SESSION_SECRET을 프런트 코드, URL, localStorage에 넣지 않음
- 교사 비밀번호는 로그인 요청 동안만 사용하고 즉시 지움
- 학생 PIN은 생성 직후 화면 메모리에서만 표시하며 설치 재개 데이터에 저장하지 않음
- 공개 설치 링크에는 기존 공개 RuntimeSupabaseConfig만 포함
- 학생 화면에는 Supabase URL/key를 노출하지 않음

## 테스트

- `npm test`: PASS (167)
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS
- `npm run typecheck:edge`: PASS
- `npm run test:security`: PASS (1)
- `npm run audit:problems`: PASS (30 fixed, generated checks 5600, ambiguous 0)
- `npm run audit:presentation`: PASS (14030 checks)
- 새 installer 단위 테스트: PASS (2)
- 실제 Chromium 설치 흐름: BLOCKED (현재 브라우저 실행 환경의 localhost listen EPERM 및 승인 검토 사용량 제한)
- 실제 신규 빈 Supabase 설치: NOT_RUN
- 실제 업데이트·부분 실패 복구: NOT_RUN

## 교사 작업량

이번 UI 구현으로 앱 안에서 줄어든 이동·입력 작업:

- 학급 생성 API 호출과 학급 코드 생성: 기존 교사 화면에 이어 마법사에서 직접 수행
- 학생 명단 한 줄/쉼표 붙여넣기와 일괄 생성: 구현
- 학생 접속 링크 복사: 구현
- Supabase 연결 설정 확인: 구현

기존 수동 설치 대비 실제로 제거된 외부 작업:

- 없음 (0개). 학급·학생 준비는 기존 교사 화면의 정상 API를 한 흐름에 연결한 것이며, Supabase 관리 작업은 그대로 남아 있다.

아직 줄이지 못한 작업:

1. Supabase 계정 로그인과 프로젝트 생성
2. Project URL·Publishable key 붙여넣기
3. migration 17개 적용
4. student-auth/student-api 배포
5. APP_SESSION_SECRET 설정
6. Supabase Auth 교사 계정 생성

따라서 “터미널·SQL·함수 배포·Secret 입력이 없는 완전 간편 설치”는 아직 달성하지 못했다. 안전한 관리용 실행부의 실행 장소·권한·비용 승인 없이는 공개 키만으로 이 작업을 자동화할 수 없다.

## 남은 승인 및 검증

- 제작자 운영의 별도 설치 실행부 또는 동등한 공식 관리 권한 흐름 도입 여부 승인
- 관리 토큰 보관 위치, scope, 운영 주체, 비용과 철회 정책 승인
- 빈 TEST 프로젝트에서 실제 migration/function/Secret 설치 E2E
- 이미 설치된 TEST에서 상태 확인·복구·업데이트 E2E
- 설치 완료 후 교사 로그인→학급/학생 생성→학생 첫 저장→재접속 복원 브라우저 검증

이 보고서는 구현과 한계를 함께 기록하며, mock 또는 정적 검사만으로 설치 완료를 주장하지 않는다.

## Phase 7B — 설치 실행부 구현 상태 (2026-09-13)

**PHASE 7B RESULT: PARTIAL**  
`AUTOMATION_BACKEND: PARTIAL` · `REMOTE_INSTALL: NOT_RUN` · `PRODUCTION: UNCHANGED`

### Architecture

- `scripts/installer/contract.ts`: 설치 대상·단계·상태·오류 계약. 설치 결과에는 Secret 원문·교사 비밀번호·PIN을 담지 않는다.
- `scripts/installer/management-api.ts`: 브라우저에서 import하지 않는 Supabase Management API 어댑터. 프로젝트 확인, migration 적용, Secret 이름 확인/설정, 함수 목록/배포, 함수 OPTIONS probe를 지원한다.
- `scripts/installer/orchestrator.ts`: 대상 바인딩 → 적용 migration 재조회 → 누락분 순차 적용 → Secret이 없을 때만 안전한 난수 생성 → 함수 hash 비교/배포 → probe 순서와 부분 실패 재개 상태를 구현한다.
- `scripts/installer/security.ts`: TEST/비운영 대상 guard, URL·project ref 결합 확인, ephemeral credential 폐기, 진단 redaction.
- `scripts/installer/fake-backend.ts`: 원격을 흉내 내지 않고 같은 계약을 사용하는 개발·QA 전용 상태 어댑터.
- `src/lib/installerClient.ts`: 관리 토큰 없이 HttpOnly 설치 세션으로 상태·계획·설치·복구·업데이트·철회를 요청하는 공개 클라이언트. `VITE_INSTALLER_API_URL`이 명시된 배포에서만 `/setup` 4단계가 상태 조회를 시도하며, 값이 없으면 기존 연결 필요 안내를 유지한다.
- `scripts/installer/math-manifest.ts`: 수학 앱의 migration·student-auth/student-api·APP_SESSION_SECRET·probe만 선언하는 앱별 manifest. AI API나 면담 전용 자원은 포함하지 않는다.

Management OAuth는 공식 Supabase OAuth 흐름의 callback/state/PKCE와 client secret을 요구하므로 정적 SPA에 넣지 않았다. 실제 OAuth 앱 등록·callback 서버·암호화 token vault는 승인과 운영 장소가 정해진 뒤에만 연결할 수 있다. 또한 Supabase의 migration Management API는 선택된 partner OAuth 앱에만 제공된다고 명시되어 있어, 일반 OAuth 앱으로 바로 자동 migration을 보장할 수 없다. PAT는 fallback 설계 대상이지만 기본 UI에서 요구하지 않는다.

### Automatic tasks

| 작업 | 로컬 실행 계약 | 실제 TEST/교사 프로젝트 |
|---|---|---|
| migration 001~017 | `runInstaller`와 Management API `POST /v1/projects/{ref}/database/migrations` | NOT_RUN |
| student-auth | bundle hash 비교·Management API deploy 계약·OPTIONS probe | NOT_RUN |
| student-api | bundle hash 비교·Management API deploy 계약·OPTIONS probe | NOT_RUN |
| APP_SESSION_SECRET | 32-byte 난수 생성, 기존 이름이 있으면 보존, 원문은 state/log에 반환하지 않음 | NOT_RUN |
| 교사 Auth | 기존 `/setup`의 정상 Supabase Auth 로그인/생성 흐름 유지 | 자동 생성은 지원하지 않음 |
| 학급·학생 | 기존 `teacher:*` API가 `/setup`에서 수행 | 기존 Phase 7 범위, installer backend와 분리 |
| QR | 현재 링크 복사만 구현, 로컬 QR encoder 없음 | NOT_IMPLEMENTED |
| 학생 smoke | 기존 `/setup`에서 생성 PIN을 메모리에서만 사용 | 실제 신규 설치는 NOT_RUN |

### Existing TEST and recovery

기존 TEST 프로젝트에서 installer status/repair를 실제 호출하지 않았다. 따라서 `ALREADY_INSTALLED`, `NO_CHANGES`, 부분 실패 재개, 함수 버전 update check는 **LOCAL_LOGIC만 검증**했으며 `VERIFIED_LIVE`로 표시하지 않는다. 이미 있는 Secret·학생·PIN·진도·작품을 삭제하거나 재발급하는 경로는 만들지 않았다.

### Manual teacher steps

현재 교사에게 남는 단계는 Phase 7과 동일하다.

1. Supabase 계정 로그인 및 프로젝트 생성.
2. Project URL·Publishable key를 `/setup`에 입력.
3. migration 17개 적용.
4. `student-auth`와 `student-api` 배포.
5. `APP_SESSION_SECRET`을 Edge Function Secret에 설정.
6. 교사 Auth 계정 준비.
7. `/setup`에서 학급·학생을 만들고 학생 링크를 전달.

실제 제거된 외부 수동 작업은 **0개**다. 로컬 실행 계약은 향후 승인된 installer backend에 붙일 준비를 했지만, 배포하지 않았으므로 간편 설치 완료로 보고하지 않는다.

### Security and approvals

- Management credential은 `EphemeralCredential`에서만 사용하고 `dispose()` 후 재사용할 수 없다.
- project ref와 URL이 맞지 않거나 production ref이면 backend 호출 전에 중단한다.
- Secret 값, access token, PIN, 교사 비밀번호를 브라우저/localStorage/URL/보고서에 넣지 않는다.
- 실제 자동 설치를 위해서는 제작자 소유의 별도 실행 장소, Supabase OAuth 앱 또는 제한된 PAT, callback/PKCE·CSRF 검증, 암호화된 단기 token 보관, 운영 비용과 권한 범위에 대한 승인이 필요하다. Cloudflare Pages에는 backend를 두지 않는다.

### Tests

- `npm test`: PASS (201 tests, Phase 7B installer 계약·OAuth·공개 client·앱 manifest·보안 검사 포함).
- `npm run qa:installer:mock`: PASS (`COMPLETE`, 누락 migration 계산·Secret 설정·함수 배포/skip·probe를 합성 backend로 확인).
- 실제 Management API/TEST migration/function deploy/학생 데이터 생성: NOT_RUN.
- 실제 Chromium `/setup` 자동 설치 흐름: 기존 실행 제한으로 BLOCKED. 공개 클라이언트의 상태 연결은 코드·단위 검사만 수행.
- 빈 Supabase 신규 설치 E2E: NOT_RUN_NEEDS_NEW_TEST_PROJECT.

### Phase 7B decision

로컬 실행 계약과 서버 전용 Management API 호출 코드는 준비되었지만, 실제 관리 권한 연결·배포·신규/기존 TEST 관통 검증이 없어 `PARTIAL`이다. Phase 7B PASS 조건의 “교사 외부 수동 작업 감소”는 아직 0개다.

## Phase 7C — Easy Setup 통합 및 OAuth 우선 경계 (2026-09-13)

**PAT_INSTALLER: PARTIAL** · **COMMON_EASY_SETUP: PARTIAL** · **REMOTE: NOT_RUN**

- 면담실 참고 소스는 현재 로컬 경로와 원격 읽기 환경에서 확인되지 않아 `AI_INTERVIEW_EASY_SETUP_REFERENCE.md`에 `NOT_FOUND`로 남겼다. 확인하지 못한 Worker·Durable Object·AI API 구현을 수학 앱에 복사하지 않았다.
- 수학 앱에 `InstallerManifest`/`math-manifest.ts`를 추가했다. `stacking-blocks-math`, 001~017 migration, `student-auth`, `student-api`, `APP_SESSION_SECRET`, 두 probe만 선언한다.
- 공개 `installerClient`는 OAuth authorize 시작·설치 세션·상태/계획/설치/복구/업데이트·철회 경로와 개발·복구용 PAT 전달 계약을 제공한다. PAT는 저장·로그·URL에 남기지 않는다.
- `scripts/installer/http-server.ts`는 별도 실행 장소에 배치할 수 있는 로컬 HTTP 실행부다. HttpOnly 세션 cookie, origin 검사, 짧은 TTL, project binding, 완료 시 credential 폐기를 수행하며 Management API adapter를 주입받는다. 실제 서버로 기동하거나 원격 요청하지 않았다.
- `/setup`은 `VITE_INSTALLER_API_URL`이 명시된 경우에만 OAuth 권한 연결과 상태 조회를 시도한다. 기본 정적 배포에는 installer backend가 없으므로 기존 정직한 연결 필요 안내가 유지된다.

### 검증 상태

- `npm test`: 205개 중 203 PASS, 2개 HTTP integration 테스트는 이 환경의 localhost `listen EPERM`으로 SKIPPED/BLOCKED. 테스트를 약화하지 않고 운영자 환경에서 재실행하도록 기록했다.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run typecheck:edge`, `npm run test:security`, `npm run audit:problems`, `npm run audit:presentation`, `npm run qa:installer:mock`: PASS.
- 실제 Supabase OAuth/PAT, TEST status/repair, 신규 설치, QR 생성, 외부 backend 배포는 NOT_RUN. 실제 교사 외부 수동 작업 감소는 0개다.

## Phase 7D — TEST backend 배포 게이트

**INSTALLER_BACKEND: LOCAL_ONLY** · **EXISTING_TEST_INSTALL_E2E: NOT_RUN** · **PRODUCTION: UNCHANGED**

- [`http-server.ts`](../../scripts/installer/http-server.ts)는 `/health`와 `/api/installer/*` 실행 경로를 제공하지만, 실제 호스팅 환경에는 배포하지 않았다.
- TEST PAT session, `status → INSTALLED`, `plan → NO_RUNTIME_CHANGES`, `repair → NO_CHANGES`, `update → UP_TO_DATE`, `/setup` 원격 연결은 모두 **NOT_RUN**이다.
- QR 생성기는 아직 의존성·구현이 없어 **NOT_IMPLEMENTED**다. 외부 QR SaaS를 사용하지 않았다.
- 실제 배포에는 별도 Node 실행 환경, HTTPS 도메인, 허용 origin, OAuth/PAT 보안 정책과 사용자의 명시적 외부 자원 승인이 필요하다. Cloudflare Pages에는 backend를 배포하지 않는다.

## Phase 7E — TEST backend 배포 준비 (2026-09-13)

**PHASE 7E RESULT: READY_FOR_REMOTE_DEPLOY** · **REMOTE TEST: NOT_RUN** · **PRODUCTION: UNCHANGED**

- `scripts/installer/runtime.ts`가 `INSTALLER_MODE=TEST`, 허용 TEST project ref 목록, HTTPS origin 목록, 32자 이상 `INSTALLER_SESSION_SECRET`, 포트를 시작 전에 검증한다. 허용 목록에 운영 ref가 포함되면 기동하지 않는다.
- `scripts/installer/start.ts`는 동일한 수학 manifest/plan과 `SupabaseManagementBackend`를 사용하는 Node HTTP 진입점이다. `npm run installer:server`로 실행할 수 있으며, Cloudflare Pages/Worker에는 배포하지 않는다. `GET /health`는 버전·모드·서비스만 반환하고 Secret을 반환하지 않는다.
- HTTP 세션 cookie는 HttpOnly·SameSite=Strict이며 런타임 Secret으로 서명한다. PAT는 credential 객체에만 머물고 세션 완료·철회·만료 시 폐기된다. TEST 허용 ref와 project URL이 모두 일치해야 세션이 만들어진다.
- 이미 설치된 상태의 `/repair`는 `NO_CHANGES`, `/update`는 `UP_TO_DATE`를 읽기 전용으로 반환하도록 분리했다. 설치가 필요한 상태에서만 기존 오케스트레이터가 실행된다.
- `scripts/installer/qa-remote.ts`와 `npm run qa:installer:remote`를 추가했다. 원격 URL·TEST ref·Publishable key·PAT는 환경변수에서만 읽고 artifact에는 project ref hash와 안전한 상태 요약만 남긴다. 실행 전 `TARGET_ENV=TEST`와 운영 ref 차단을 확인한다.
- `.env.installer.example`은 비밀값 없는 배포 템플릿이다. TEST PAT·session secret은 파일/로그/브라우저 bundle에 포함하지 않는다.

### 이번 실행 결과

- 로컬 단위/정적 검사: `npm test` 207개 중 205 PASS, 2 SKIPPED (localhost listen EPERM), `typecheck`, `lint`, `build`, `typecheck:edge`, `test:security`, 문제/프레젠테이션 감사, `qa:installer:mock` PASS.
- 실제 HTTPS backend 기동, TEST PAT session, status/plan/repair/update, `/setup` remote 연결, QR, 출력 artifact는 **NOT_RUN**. 외부 호스팅 자원·OAuth 앱·Supabase remote 변경은 생성/배포하지 않았다.
- QR은 현재 링크 복사만 제공하며 실제 QR encoder는 **NOT_IMPLEMENTED**이다. 외부 QR 서비스는 사용하지 않는다.

### 배포 전 승인 조건

새 HTTPS Node 호스트와 도메인, `INSTALLER_ALLOWED_ORIGIN`, TEST project ref allowlist, 단기 PAT 또는 Supabase OAuth 앱/redirect URI, Secret 보관·철회 정책, 운영 비용을 승인해야 한다. 승인 전에는 로컬 진입점과 mock 검사만 사용한다. 교사 외부 수동 설치 작업 감소는 아직 0개다.

## Easy Setup HTTPS TEST checkpoint — 2026-09-19

**RESULT: PARTIAL — fresh Supabase install NOT_RUN.** This section supersedes older session/UI limitations above, without treating past checks as current evidence.

- Start: `24c8bd1924ace1a56616f2135dbbb636fef0e481`.
- Runtime verification: `e6c2289ee4bc158dd62405347dab99d6a7aba43f` (frontend and backend Render Live confirmed). Existing untracked work preserved.
- TEST frontend created: https://stacking-blocks-math-setup-test.onrender.com/setup (Render Static Site `srv-dan95ibm8hqs73agpk9g`, feature branch, SPA rewrite).
- Existing TEST backend: https://stacking-blocks-math-installer-test.onrender.com (`srv-damhnvm1egvs73ca667g`). No production service or Supabase database changed.
- User explicitly approved PAT **for this TEST only**. Final teacher distribution still requires connection without manually entering PAT; INSTALL_EASY is not complete.
- /setup now connects its existing session/credential/install/status/repair/update/revoke API. The masked token clears before transmission and is never persisted by the client. A fixed 15-minute server session supports reconnect/status and explicit revoke; server restarts require authorization again.
- A failed browser test caught a genuine native `fetch` receiver error before any installer HTTP request. Added a failing regression, corrected the default transport, then verified the HTTPS UI.
- Project-scoped in-process lock prevents concurrent installs across separate sessions; target mismatch and attacker origin are rejected. Job identifiers no longer expose session identifiers.
- Migration source names written by Management API and CLI version/name history are both recognized. Schema version/count are derived from current sources (18 migrations). Existing function secret is preserved on retry/repair/update.

### Executed evidence

- Local installer suite: **58 PASS / 0 FAIL / 0 SKIP**, 2026-09-19 UTC, runtime source `e6c2289`; subsequent uncommitted changes are QA helper only.
- Related lint and `qa:installer:mock`: PASS. Local full typecheck was stopped after dependency-file reads stalled; it is not counted as PASS.
- CI for `e6c2289`: typecheck/lint/unit/Edge/security/build/existing browser checks PASS: https://github.com/rlasksk030/classgame/actions/runs/35447692322 . No manual oracle rerun; existing push workflow ran its configured checks.
- **UI_WITH_TEST_DATA: 5/5 PASS**, actual HTTPS /setup using Playwright input/click/reload. Covers connection/session contract, masked PAT clear, install/teacher gate, reload, no PAT in browser storage/URL, repair/update/revoke/expiry. This is not Supabase remote installation or actual cookie/CORS verification.
- Passing capture and result: `runtime/setup-ui-1789826846398/installed.png`, `runtime/setup-ui-1789826846398/result.json`. Capture visually reviewed. Earlier failing captures retained in `runtime/setup-ui-1789826492533/` and `runtime/setup-ui-1789826590391/`.

### Pending gate (not bypassed)

- Backend's saved origin remains `https://pending-test-frontend.invalid`. Replacement with the actual TEST frontend origin is prepared in Render but **not saved**, pending the browser-policy action-time confirmation already requested.
- `npm run qa:installer:remote -- --https-session` is prepared for real HTTPS health/CORS/HttpOnly/Secure/SameSite=None/reload/revoke checks with no PAT and no Supabase requests. Required public env: INSTALLER_FRONTEND_URL, INSTALLER_REMOTE_URL, INSTALLER_TEST_PROJECT_REF, INSTALLER_BUILD_COMMIT. NOT_RUN until origin setting is approved/applied.
- After that gate: separate empty TEST project approval/provisioning, allowlist binding, actual PAT authorization, fresh install, post-install teacher/class/3-student/login/progress/L9/project smoke remain NOT_RUN. Existing `stacking-blocks-math-test` and both production databases must remain untouched.
- Actual remote retry/repair/update, session expiry during real install, Render log credential review: NOT_RUN. Local mock/HTTP checks are not substitutes.
- External teacher manual work actually eliminated by a proven fresh install: **0** so far. No Easy Setup completion claim.

## Approved TEST origin / actual HTTPS session gate — 2026-09-19

**/setup HTTPS transport/session gate: PASS. Fresh installation: NOT_RUN (explicit stop).**

- User approved the exact TEST frontend origin. Saved only `INSTALLER_ALLOWED_ORIGIN=https://stacking-blocks-math-setup-test.onrender.com` on TEST backend `srv-damhnvm1egvs73ca667g`. Render deployment `dep-dan9l0egekts7387bfq0` succeeded with runtime commit `ac95c9eb137b612f81aab1cd0652018f721395be`. This supersedes the pending origin gate above.
- Real HTTPS Chromium run at `2026-09-19T14:24:54.199Z`: /setup visible, allowed-origin CORS PASS; forbidden-origin browser fetch rejected and independent live HTTP probe returned 403 `INSTALLER_ORIGIN_BLOCKED` with no allow-origin header.
- Session POST returned 201. Cookie properties: HttpOnly, Secure, SameSite=None. Reload preserved the session (status returned `INSTALLER_AUTH_REQUIRED`, rather than missing session; no PAT was supplied). Revoke returned 200, then both normal access and replay of the old cookie returned 401 `INSTALLER_SESSION_REQUIRED`.
- Production target binding rejected before Supabase access. Requests restricted to frontend and backend health/session/status. No PAT, Supabase access, project creation, install, migration, data write or production change.
- Evidence: `runtime/https-session-1789827890089/result.json`, `runtime/https-session-1789827890089/setup.png` (visually reviewed). The denied-origin test document alone is synthetic; backend responses are real HTTPS, not mocked.
- QA helper change only: add origin denial and revoked-cookie replay assertions; correct cookie inspection URL to `/api/installer/session` because the cookie is deliberately scoped to `/api/installer`. First failing test artifact `runtime/https-session-1789827812151/` preserved; this was a test path mismatch, not a server cookie fix. Related ESLint and diff whitespace check PASS. Existing app/runtime unchanged.
- Stop point: before creating/binding a fresh TEST Supabase or running automated installation. PAT-authorized installation, fresh install and post-install school flow remain NOT_RUN; final teacher PAT-free connection is still incomplete.
