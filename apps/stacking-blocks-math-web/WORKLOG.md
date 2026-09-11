# MVP 작업 기록

## 문제 진행 위치 복원 P0 수정 (2026-09-12)
- `LessonPage`에서 단계 필터 effect가 `problemIndex`를 매 렌더링마다 0으로 되돌리던 경로를 제거했다. 단계 이동·이전/다음·틀린 문제 재풀기·새 연습 세트처럼 사용자가 명시적으로 위치를 바꾸는 동작에서만 인덱스를 변경한다.
- `sb_student_progress.last_problem_id`를 `lessonProblems` 응답에 포함하고, `position` 학생 API로 이동 위치를 저장한다. 자동 진행과 수동 이동 모두 DB 위치를 갱신하며 seed 문제는 안전하게 건너뛴다.
- 재접속 시 저장된 문제 ID를 세트 인덱스로 복원하는 순수 함수와 경계값 테스트를 추가했다. 기존 `practice_seed`, 시도 기록, 블록 snapshot 저장은 변경하지 않았다.
- 검증: `npm run typecheck`, `npm run lint`, `npm test`(36개), `npm run typecheck:edge`, `npm run build` 통과. Playwright는 기존 샌드박스 로컬 포트 제한으로 별도 미실행.

## 추가 presentation·QA 보강 (2026-09-12)
- 학생 답안 영역에 `data-answer-renderer` 계약 표식을 추가하고 Playwright Renderer mount 테스트를 준비했다. 3차시 세 격자와 8차시 층별 입력 격자가 실제 DOM에 생성되는지 확인한다.
- 9차시 친구 문제 카드에 `위에서 본 모양` 단일 투영을 추가했다. `ChallengeType`·Edge Function 채점·힌트 검증과 전용 migration `202609110014_challenge_top_type.sql`을 함께 갱신했다.
- `audit:lessons` alias와 QA 보고서의 단위 테스트 수(35개)를 정리했다.
- 9차시 migration 추가에 맞춰 `SCHEMA_VERSION`을 `202609110014`로 올리고 설치 문서·배포 버전 계약을 맞췄다. 원격 Supabase에는 이 새 migration을 별도 적용해야 한다.
- 12차시 자기평가를 문제를 풀기 전 상단에서 노출하지 않고, 현재 종합 문제 완료 뒤 결과 영역에서 보이도록 위치를 조정했다.

## 문제 화면 presentation 전수 점검 (2026-09-12)
- `shared/problemPresentation.ts`에 문제 유형·학생에게 보이는 3D/투영/높이 지도/층별 지도·답안 입력·카메라 정책을 연결하는 `ProblemPresentation` 계약과 validator를 추가했다.
- 학생 API가 정답 원본은 제외한 presentation 메타데이터만 내려 주도록 했고, 교사 3D 문제 등록도 필요한 정보가 없으면 저장하지 않도록 검증한다.
- 3차시 답안 격자는 실제 투영의 행·열을 사용한다. 4차시 개수 문제의 높이 지도와 6~8차시 조건 지도는 공통 증거 영역에 표시한다. 위치 의존 문구(오른쪽)를 반응형 문구로 정리했다.
- 9차시를 10개 쌓기 → 문제 카드 선택 → 힌트 카드 선택 → 최종 확인의 단계형 화면으로 정리하고, 친구가 보게 될 카드 미리보기를 추가했다.
- 10~11차시 건축 Builder는 4×4 기본 설계판을 사용한다. 기존 5×5 친구 문제와 분리했다.
- 이전 버전에서 저장된 5×5 건축물은 자동으로 5×5 viewer/작업판을 선택해 계속 열람·저장할 수 있도록 호환했다.
- `npm run audit:presentation`을 추가했다. 기본 30개와 14,000개 생성 문제를 검사해 필요한 표현 누락 0건을 확인했다.
- 친구 문제 제작에서 선택한 힌트 카드를 실제 풀이에 전달하도록 `202609110013_challenge_hint_type.sql`과 `hintGiven` 응답을 추가했다. 기존 행은 숫자 지도 힌트를 기본값으로 사용한다.
- 로컬 Vite 서버는 샌드박스 포트 바인딩(`listen EPERM`)으로 실행되지 않았다. 권한 확장 재시도는 자동 승인 검토의 사용량 한도 초과로 거부되어 실제 화면 캡처는 미검증이다.

## 문제 정확성 corrective migration (2026-09-12)
- 문제 감사 결과를 이미 적용된 초기 seed migration에 덮어쓰지 않도록 `202609110002_seed.sql`은 원상 보존했다.
- `202609110012_problem_accuracy.sql`을 추가해 L1-03 자유 쌓기 정답 형식, L2-01/L2-03/L12-04 시점별 블록·투영, L5-01 불충분 정보 선택형 정답을 보정한다.
- 앱 `SCHEMA_VERSION`을 `202609110012`로 올리고 배포 문서와 버전 테스트를 맞췄다. 실제 원격 Supabase 적용 여부는 별도 운영 절차로 확인한다.

## 시작 상태
- 시작 HEAD: 1bc0895b20899ff9f443524bea378b7236c6423d (pr-1)
- 미커밋 변경 없음. reset/clean 사용하지 않음.
- 기존 구현과 README/계획/마이그레이션/Edge/테스트를 조사함.
- 실제 .env/.env.local, Supabase 연결된 project-ref, 셸의 Supabase 공개/서버 키 모두 없음.
- **실제 키 부재로 검증 불가**. 모의 API E2E와 로컬 PostgreSQL 검증을 실제 Supabase 성공으로 보고하지 않음.

## 코드 기준 점검
| 기능 | 구현 | 검증/문제 |
|---|---|---|
| Babylon/ArcRotateCamera/drag/snap/ghost/undo | 있음 | 기존 Chromium 마우스·터치 회귀 재실행 |
| 투영/물리/exact/constraint/오답 규칙 | 있음 | 기존 unit 유지 |
| 학생 PIN/HMAC/교사 Auth/RLS | 있음 | 실제 서비스 키 없음; 로컬 DB/보안 테스트 |
| 1~8차시 | 문제 23개/공통 UI 있음 | 5차시 회전 제한 미적용, 6차시 2문제 보완 필요 |
| 교사 PIN/잠금/3D 제작/기록 | 있음 | 진도 요약/초기화/문제 수정 누락 |
| 9~11차시 | DB 테이블만 있음 | 실제 화면/학생 API 필요 |
| 12차시 | 종합 3문제 | 6~10개로 보완/자기평가 필요 |
| 학습지 | 없음 | 최신 지시에 따라 AI 없이 수동 crop/등록 구현 |

## 다음 순서
1. 1~8 회귀 및 수업상 오류 보완
2. 9차시 공유/10~11 건축물/12 자기평가
3. 교사 필수 관리와 수동 학습지 등록
4. 전체 회귀, 논리 단위 로컬 커밋. push/deploy 금지.

## 6b7cfac — 5차시/교육과정
- 첫 단계 앞 시점 제한 → 답 제출 → 추가 정보 확인 후 해당 문제만 자유 회전.
- 초점 테두리를 고정한 실제 canvas 비교 E2E 통과. 기존 4개 E2E도 회귀 통과.
- 6차시 3문제, 12차시 6문제로 확장. 5차시 불충분 정보에 정확한 개수를 강요하던 정답을 수정.
- 다음: 활동 저장/공유 권한과 교사 관리, 수동 학습지.

## 새 Supabase 프로젝트 연결 (2026-09-11)
- 공개 환경변수를 VITE_SUPABASE_PUBLISHABLE_KEY로 통일하고 .env.local 설정(Git 제외). 학생 요청의 잘못된 공개키 Bearer 헤더 제거.
- 새 프로젝트 SQL Editor에 001~008 적용: 테이블 16/RLS 16/문제30 확인. 두 Edge Function 배포.
- 실DB에서 교사·서버의 테이블 사용 권한 누락을 발견했고 009를 준비했다(실제 적용 결과는 아래 최신 Supabase 연결 점검 절 참조). student-api legacy JWT 설정 변경은 별도 승인 필요로 보류. APP_SESSION_SECRET/교사 계정 미설정.
- 실제 공개 API 직접 조회 차단 및 함수 오류 응답 확인. 실제 로그인 성공 미검증.
- SUPABASE_SETUP.md에 실제 적용/미적용 상태, 후속 절차 기록.
- 진행하던 9차시/건축물/12차시 요약/수동 importer 작업도 보존. AI 미사용.

## 9차시 친구 문제 놀이 (2026-09-11)
- 기존 Babylon Builder를 재사용해 10개 블록 제작, 위·앞·옆/height map/layer map 카드 자동 생성, 짧은 학급 공유 코드, 같은 반 검증, 친구 풀이 흐름을 구현.
- 친구 문제 힌트 선택을 추가하고 힌트 전 정답 2점, 힌트 후 정답 1점으로 기록. 오답 횟수·힌트 여부·성공 여부·점수는 `sb_challenge_solves`에 저장.
- `202609110010_challenge_score.sql`에 점수 컬럼 추가. 이번 단계에서는 실제 Supabase 권한/RLS 변경을 적용하지 않음.
- 교사 대시보드 놀이 기록에 제작자, 공유 코드, 풀이 학생, 시도 횟수, 힌트 여부, 점수를 표시.
- `tests/activities.test.ts`에 10개 제한, 투영 자동 생성, 점수 규칙 단위 테스트 추가.

## 반복 연습·학습 단계 구조 (2026-09-11)
- `shared/practiceGenerator.ts`에 차시별 권장 연습량(15/20)과 결정적 template+seed 문제 생성기를 추가했다. 기존 좌표·projection·heightMap·layerMap·constraint 채점 로직을 재사용한다.
- 학생별 lesson seed를 `sb_student_progress.practice_seed`에 기록하고, 요청한 문제 수가 될 때까지 서버가 생성 문제를 앱 문제은행에 보충한다. 생성 문제는 `more` 단계로 표시한다.
- 문제 화면에 `개념 익히기 → 개념 확인 → 더 풀어보기` 단계 필터와 필수 학습 완료 잠금을 추가했다. 기본 seed 문제는 순서에 따라 concept/check 단계로 분류한다.
- 교사가 차시별 추가 문제 수를 권장/5/10/15/20으로 선택할 수 있는 UI와 API 계약을 추가했다. `202609110011_practice_count.sql`은 migration만 준비하며 이번 작업에서 실제 Supabase에 적용하지 않는다.
- 학습지 배부(worksheet/assignment/submission/item)는 이번 범위에서 구현하지 않고 기존 importer 라우트와 분리된 확장 지점으로 유지한다.

## 10~11차시 나만의 건축물 (2026-09-11)
- `/lesson/10/project`, `/lesson/11/project`에서 기존 Babylon.js `ActivityBuilder`를 재사용한다. 블록 조작은 로컬에서 즉시 반영하고 1.5초 debounce, 저장 버튼, 페이지 숨김/종료, 온라인 복귀 때 서버 저장을 시도한다.
- 건축물 이름·설계 이유·전체 설명·1~3층 공간 이름/설명을 입력하며, 3층 구조가 완성되어야 11차시에서 소개서를 확정할 수 있다. 10차시 확정 우회는 화면과 Edge Function 양쪽에서 거부한다.
- `sb_projects`의 버전과 학생 토큰별 localStorage 초안으로 재접속 복원을 지원한다. 소개서에는 실제 블록에서 계산한 위·앞·옆 투영과 층별 표현을 표시한다.
- 교사 학생 기록 화면에서 저장된 건축물 소개서와 3D 모형을 읽기 전용 Babylon.js Viewer로 확인할 수 있다.
- 실제 Supabase 키/교사 계정이 없는 상태에서 서버 저장 성공을 주장하지 않는다. 연결 절차는 `SUPABASE_SETUP.md`를 따른다.

## ProblemTemplate·Seed 연습 엔진 (2026-09-11)
- `shared/practiceGenerator.ts`에 `ProblemTemplate`, `GeneratedProblem`, `generatorVersion`, `templateId`, `seed`, `difficultyTier`, `conceptTags`, `sourceType` 계약을 추가했다.
- 1·2·3·4·5·6·7·8·12차시를 기존 좌표·투영·높이 지도·층 지도·constraint 채점 로직으로 생성한다. 50개 seed 반복 검증에서 범위 밖/공중 블록 없이 모두 유효했다.
- 생성 메타데이터는 문제의 `given._generator`로 보존되어 DB 컬럼을 불필요하게 늘리지 않고도 교사 통계와 향후 generator 버전 교체를 준비한다.
- 학생은 필수 단계 완료 뒤 틀린 문제 재도전·유사 문제 보기·새 문제 세트 생성을 사용할 수 있다. 새 세트는 `practice:new-set`으로 학생별 seed를 갱신하며, 재접속 시 마지막 seed가 유지된다.
- 실제 seed 저장에는 `202609110011_practice_count.sql` 적용이 필요하지만 이번 작업에서는 Supabase에 migration을 실행하지 않았다.
- `practice:new-set`은 기존 seed를 덮어쓰지 않고 학생별 다음 seed를 기록한다. API가 migration 미적용 상태를 감지하면 새 세트 저장 실패를 안내한다.
- 관련 검증: 차시 1·2·3·4·5·6·7·8·12를 50개 seed씩 생성해 유효성, 메타데이터, 재현성을 확인했다.

## 실제 Supabase 연결 점검 (2026-09-11)
- 시작 상태 확인: branch `pr-1`, HEAD `0da4a535cc21206fba17bdbccf220bca9afe4747`, 작업트리 변경 없음. reset/clean은 사용하지 않았다.
- 원격 `stacking-blocks-math` SQL Editor에서 16개 `sb_` 테이블과 001~008의 기반 객체가 존재함을 확인했다. Supabase migration history 테이블은 이 프로젝트에 없어 파일 실행 이력으로 판정하지 않고 컬럼·권한·RLS를 대조했다.
- `202609110009_api_grants.sql`: 원격에 적용 완료. `service_role` 및 `authenticated`에 필요한 테이블 권한을 부여하고 `sb_student_sessions`는 `anon, authenticated`에서 revoke했다. anon 전체 테이블 권한은 부여하지 않았다.
- `202609110010_challenge_score.sql`: `sb_challenge_solves.score`가 없음을 확인한 뒤 원문을 적용했다(성공).
- `202609110011_practice_count.sql`: `sb_lesson_settings.practice_count`, `sb_student_progress.practice_seed`가 없음을 확인한 뒤 원문을 적용했다(성공).
- 원격 SQL 점검 결과 민감 6개 테이블(`sb_student_pin_vault`, `sb_student_progress`, `sb_lesson_settings`, `sb_problems`, `sb_shared_challenges`, `sb_challenge_solves`) 모두 RLS 활성화, `anon SELECT=false`, `authenticated/service_role SELECT=true`였다. 정책이 실제 행을 제한하는지 여부는 공개키 요청이 필요하다.
- 공개키 REST 직접 조회는 샌드박스 DNS 실패 후 네트워크 권한 요청이 자동 승인 한도 초과로 거부되어 실행하지 못했다. 따라서 공개키 PIN vault/타 학생/교사 설정/정답 원본 차단은 **실제 키 검증 불가**로 분리한다. 서비스 키·비밀키는 사용하지 않았다.
- 테스트 계정·학급·학생 PIN이 원격에 준비되어 있지 않아 학생/교사 전체 시나리오와 Edge Function 성공 경로를 허위로 PASS 처리하지 않았다. 실제 계정과 테스트 학생을 만든 뒤 `SUPABASE_SETUP.md`의 절차로 재검증해야 한다.

## 배포판 구조 준비 (2026-09-11)
- `src/lib/config.ts`에 `APP_VERSION`, `SCHEMA_VERSION`, `AppConfig`, 설치 ID 환경변수 계약을 추가했다. 개인 Supabase URL·키·교사·학급 값은 하드코딩하지 않는다.
- `src/lib/distribution.ts`에 설치 상태(`NOT_CONFIGURED`~`READY`), `VersionService`/`UpdateManifest`, 원격 업데이트를 가장하지 않는 `LocalVersionService`, 비민감 진단 정보 계약을 추가했다. 실제 자동 migration·Storage·원격 업데이트는 실행하지 않는다.
- `.env.example`에 선택적 `VITE_INSTALLATION_ID`를 추가하고 `DISTRIBUTION_ARCHITECTURE.md`에 교사별 Supabase 배포, 버전·migration·데이터 보존·향후 설치/업데이트 흐름을 기록했다.
- 문제 다양성 점검(차시 1~8, 12 / seed 1·2 / 20개): 모든 차시에서 seed에 따라 전체 생성 문제 데이터가 달라졌다. 차시 1·2·5는 정답 표현 자체가 고정되는 유형이지만 주어진 블록/문항은 달라진다. 이후 템플릿 다양화로 차시 1~8은 6개, 차시 12는 8개 템플릿을 사용한다.

## 검증 결과 (2026-09-11)
- `npm run typecheck` PASS
- `npm run lint` PASS
- `npm test` PASS (23개)
- `npm run typecheck:edge` PASS
- `npm run build` PASS
- `npm run test:security` PASS (PIN hash scope/session tamper test 1개)
- `npm run test:e2e`는 로컬 webServer가 샌드박스에서 `listen EPERM 127.0.0.1:4173`로 시작하지 못해 실행 불가. 코드 우회나 승인 우회는 하지 않았다.

## Seed 문제 템플릿 다양화 (2026-09-11)
- 차시 1~8은 각각 6개, 차시 12는 8개의 템플릿을 제공한다. 기존 좌표·투영·heightMap·layerMap·constraint 채점 로직을 그대로 사용하며, 문제 유형도 템플릿마다 순환한다.
- 학생별 seed와 문제 순서를 유지하면서 생성 인덱스에 따라 템플릿을 선택한다. 동일 템플릿이 3문제 연속 나오지 않도록 set-level 검증을 추가했다.
- 차시 1·2·3·4·5·6·7·8·12에 대해 15문제 세트는 고유 템플릿 5개 이상, 20문제 세트는 6개 이상이어야 하며, 50개 seed 반복 생성에서 좌표·정답 계약을 모두 통과했다.
- `tests/activities.test.ts`에 차시별 15/20문제 다양성, 템플릿 연속성, answer kind 검증을 추가했다.
- Node 실사용 점검에서 차시 1~8은 15/20문제 모두 6개 템플릿, 차시 12는 8개 템플릿을 사용했으며, seed 1001/1002의 전체 문제 데이터가 모든 차시에서 달라졌다.

## Cloudflare 정적 배포 제약 (2026-09-11)
- `DISTRIBUTION_ARCHITECTURE.md`에 Cloudflare Pages는 `dist/` 정적 파일만 제공하고 Pages Functions/Workers/KV/D1/Durable Objects/R2/API proxy를 사용하지 않는다는 계약을 추가했다.
- 모든 동적 기능은 각 교사의 Supabase와 브라우저가 직접 통신하며, service_role·Edge Function Secret은 브라우저에 노출하지 않는다.
- 현재 연결값은 런타임 설치 설정을 우선 사용하며, Vite `VITE_*`는 개발·테스트 fallback으로만 유지한다.

## 런타임 설치 설정 (2026-09-11)
- `src/lib/config.ts`에 공개 `RuntimeSupabaseConfig`(installationId, Supabase URL, Publishable Key) 저장·검증·URL fragment(`/#install=`) 인코딩/복원 계층을 추가했다. service_role/secret/password 이름이 포함된 값과 안전하지 않은 URL은 거부한다.
- 연결 우선순위는 런타임 localStorage 설정 → 개발/테스트의 Vite fallback → 미설정이다. production에서 Vite 값만으로 연결하지 않으며, 설정이 없으면 `/setup`으로 이동한다.
- `getSupabase()`와 학생 Edge Function 호출이 매번 현재 런타임 설정을 해석하고, 설치가 바뀌면 Supabase client cache도 교체한다. 특정 교사 URL/키를 소스에 하드코딩하지 않는다.
- `/setup`은 `/auth/v1/settings`만 호출해 연결을 확인한 뒤 공개 설정을 저장한다. DB migration·Storage 생성·교사 인증을 자동 수행하지 않는다.
- 설정 fragment round-trip 및 secret/unsafe URL 거부 테스트를 추가했다.

## 런타임 Supabase 실사용 점검 (2026-09-11)
- 현재 새 프로젝트의 URL·Publishable Key는 `.env.local`에만 남아 있으며 production에서는 Vite 값 fallback을 사용하지 않는다. `/setup` 또는 `/#install=`로 공개 연결 설정을 저장하는 코드 경로와 서로 다른 두 설치의 client 교체 단위 테스트를 확인했다.
- 공유 기기에서 다른 installationId의 fragment를 열면 기존 설정을 유지하고 확인 대화상자에서 승인한 경우에만 설정과 학생 토큰을 교체한다. 변조/손상 fragment는 `/setup`에서 오류를 표시한다.
- 실제 Supabase `/auth/v1/settings` 호출, APP_SESSION_SECRET 설정, 교사·학생 생성 및 로그인/진도 저장 smoke test는 네트워크·대시보드 자동 승인 제한으로 실행하지 못했다. 실제 성공으로 보고하지 않는다.
- 이 단계에서는 migration, Storage, Cloudflare 배포, 학습 기능을 변경하지 않았다.

## 실제 RuntimeSupabaseConfig 검증 (2026-09-11)
- production `npm run build` 후 `dist` 전체에서 현재 프로젝트의 URL·Publishable Key 문자열이 없는 것을 확인했다. 공통 산출물은 런타임 설정 또는 `/setup`이 있어야 연결된다.
- `/setup`은 연결 확인 후 공개 설정만 localStorage에 저장하고, 다른 installationId fragment는 확인 대화상자 승인 전까지 현재 설정과 학생 토큰을 유지한다.
- `getVersionState()`에 앱 버전·필수 schema 버전·설치 schema 버전·업데이트 필요 여부 계약을 추가했다.

## APP_SESSION_SECRET 및 교사 인증 점검 (2026-09-11)
- 운영자가 새 `stacking-blocks-math` 프로젝트의 Edge Function Secret에 `APP_SESSION_SECRET` 설정을 완료했다고 확인했다. 값은 기록하지 않는다.
- 교사 계정 생성 경로는 `/setup`이 아니라 Supabase Auth Dashboard의 Users 생성/초대다. 교사는 `/teacher`에서 `signInWithPassword`로 로그인하며, 이후 학급·학생 생성은 인증된 교사 API가 담당한다.
- `student-auth`는 `hashPin`과 `issueSessionToken`에서 `APP_SESSION_SECRET`을 읽고, `student-api`는 `verifySessionToken`으로 같은 서명을 검증한다. 로컬 HMAC/세션 위변조 테스트는 통과했다.
- 실제 교사 1명·학급 1개·학생 2명 생성과 학생/교사 관통 smoke test는 필요한 테스트 계정이 아직 없고 Supabase 네트워크 호출이 제한되어 실행하지 않았다. 임의 데이터는 생성하지 않았다.

## 실제 교사 계정 관통 검증 시도 (2026-09-11)
- 운영자가 `stacking-blocks-math` Supabase Auth에 테스트 교사 계정을 만들었다고 확인했지만, 로컬 Vite 서버가 샌드박스 포트 권한 오류(`listen EPERM 127.0.0.1:5173`)로 시작하지 않아 브라우저 로그인 화면을 열 수 없었다.
- 따라서 교사 비밀번호를 요청하거나 테스트 학급·학생 데이터를 임의로 만들지 않았다. 교사·학급·학생·학생 로그인·진도/스냅샷 저장/복원·교사 조회·RLS 공개키 smoke test는 미검증이다.
- `.env.local`은 실제 프로젝트 URL과 공개키가 있고 Secret 이름은 포함하지 않는 것을 값 비공개 형태로 점검했다. `APP_SESSION_SECRET`은 운영자 설정 완료 확인만 기록했으며 값은 저장하지 않았다.
- 로컬 회귀: `npm test` 23개, `typecheck`, `lint`, `typecheck:edge`, `test:security`, `build` 모두 PASS.

## 교사 로그인 실패 원인 진단 (2026-09-11)
- `/teacher`의 Auth 경로는 `getSupabase().auth.signInWithPassword`이며 `/setup`은 교사 계정이나 profile을 만들지 않는다. 신규 Auth 교사는 로그인 뒤 학급이 0개일 수 있고, `teacher:class-upsert`로 첫 학급을 만든다. 별도 `sb_teacher_profiles` 레코드를 요구하는 코드는 없다.
- 기존 화면이 모든 실패를 일반 문장으로 표시하던 문제를 고쳐 `AUTH_INVALID_CREDENTIALS`, `AUTH_EMAIL_UNCONFIRMED`, `SUPABASE_CONFIG_ERROR`, `TEACHER_PROFILE_MISSING`, `TEACHER_AUTH`, `TEACHER_BOOTSTRAP_ERROR`, `SUPABASE_NETWORK_ERROR`로 분류한다. 로그인 후 학급/교사 API 실패도 같은 코드로 표시한다.
- 비밀번호나 토큰은 로그로 남기지 않는다. 실제 Auth 응답을 보지 못한 상태에서는 특정 원인을 PASS로 단정하지 않는다.
- `npm test` 24개, typecheck, lint, build를 통과했다.

## Runtime/DB 버전 호환 계약 (2026-09-11)
- `getVersionState()`에 `currentAppVersion`, `requiredSchemaVersion`, `installedSchemaVersion`, `updateRequired` 계산을 추가했다. 설치된 Supabase schema가 부족한 경우 업데이트 필요 상태로 표시할 수 있다.
- production build에서 현재 `.env.local`의 특정 Supabase URL·Publishable Key가 `dist`에 포함되지 않는 것을 문자열 점검으로 확인했다. 런타임 설정이 없는 production은 `/setup`으로 진입한다.

## 교사 학급 생성 500 진단 및 최소 수정 (2026-09-11)
- 실제 호출 경로는 `/teacher`의 `createClass()` → `teacherUpsertClass()` → `student-api`의 `teacher:class-upsert` → `sb_classes` INSERT 이다. 교사 Auth 세션은 `getSupabase().auth.getSession()`의 access token을 `Authorization: Bearer`로 전달하고 Edge Function의 `requireTeacher()`가 검증한다.
- 500의 코드상 원인은 `sb_classes.class_code`가 `NOT NULL·UNIQUE`인데, 기존 신규 학급 INSERT가 교사가 코드를 보내지 않으면 해당 컬럼을 생략(`undefined`)하던 것이다. 따라서 DB가 NOT NULL 위반으로 `CLASS_CREATE_FAIL`을 반환했다. 별도 교사 profile/bootstrap 레코드는 학급 생성에 필요하지 않다.
- `student-api`에서 코드가 없을 때 서버가 `generateClassCode()`로 5자리 코드를 만들고, 드문 UNIQUE 충돌은 최대 5회 재시도하도록 수정했다. 교사가 지정한 코드의 중복은 기존처럼 `DUPLICATE`로 처리한다. DB 오류 전문은 서버 `console.error`에만 남기고 프런트에는 안전한 `CLASS_CREATE_SERVER` 메시지만 전달한다.
- 교사 화면은 학급 생성 실패를 `CLASS_CREATE_AUTH/PERMISSION/VALIDATION/NETWORK/SERVER`로 분류해 버튼 아래 즉시 표시하고, 성공 시 생성된 학급을 바로 선택하고 목록을 다시 불러온다.
- 이번 수정에서는 migration, RLS, 권한, 다른 Edge Function을 변경하지 않았고 기존 `student-api`를 아직 재배포하지 않았다. 배포 후 실제 학급 생성 재검증이 필요하다.
- 회귀 검증: `npm test` 25개, `npm run test:security`, `npm run typecheck`, `npm run lint`, `npm run typecheck:edge`, `npm run build` 통과. 테스트 계정·학급·학생 데이터는 생성하지 않았다.

## 학생 로그인 조회 진단 및 정규화 (2026-09-11)
- 호출 경로는 학생 화면 `loginStudent()` → `student-auth`의 `class` 조회 → `sb_students`의 `class_id + name` 조회 → 상태/잠금 확인 → `hashPin()` 대조 → `issueSessionToken()` 발급이다. 교사 학생 생성도 `teacher:students:create`에서 같은 `sb_students`와 `class_id`를 사용한다.
- 기존 `student-auth`는 학급·학생 조회 오류를 모두 빈 결과로 처리해 `STUDENT_NOT_FOUND`로 오인할 수 있었고, 이름은 단순 문자열 비교만 했다. 새 코드에서는 class code와 학생 로그인 이름을 각각 NFKC/trim/연속 공백 정리 후 비교한다. 교사 학생 생성 경로는 기존처럼 `text()`의 trim 규칙을 유지해 이번 문제 범위에서 `student-api`는 재배포하지 않는다.
- 오류 코드를 `CLASS_NOT_FOUND`, `STUDENT_NOT_FOUND`, `STUDENT_INACTIVE`, `PIN_INVALID`, `STUDENT_AUTH_SERVER`로 분리하고 학생 화면에서 안전한 한국어 메시지로 표시한다. PIN 원문·세션 비밀값은 로그에 기록하지 않는다.
- `student-auth` 변경은 로컬 코드와 테스트에 반영했지만, 실제 stacking-blocks-math 함수 재배포와 운영 학생 row/로그인 관통 검증은 아직 실행하지 못했다. `student-api`, RLS, PIN Vault, `APP_SESSION_SECRET`은 변경하지 않았다.
- `student-auth` 배포 명령은 실행했으나 이 환경에 Supabase CLI access token이 없어 `LegacyPlatformAuthRequiredError`로 중단됐다. 토큰이나 비밀번호는 요청·출력하지 않았다.
- 로컬 검증: `npm test` 27개, `npm run typecheck`, `npm run lint`, `npm run typecheck:edge`, `npm run build`, `npm run test:security` 통과.

## 학생 로그인 RLS 경로 재진단 (2026-09-12)
- 현재 `student-auth` 소스의 DB client는 `serviceClient()`이며 `SUPABASE_SERVICE_ROLE_KEY`를 Edge Function 내부에서만 사용한다. publishable/anon client나 브라우저 직접 조회는 사용하지 않는다. 따라서 anon RLS 때문에 `sb_students`가 0건이 되는 구조는 현재 코드상 아니다.
- 실제 `STUDENT_NOT_FOUND`가 계속 발생한다면, 운영 프로젝트의 `student-auth` 배포 버전이 현재 소스와 다르거나 함수 환경/조회 응답이 불일치하는지 로그 확인이 우선이다. `student-auth`에 개인정보 없이 `classFound`, 후보 행 수, 정규화 이름 일치 여부를 기록하도록 추가했다.
- `student-auth`는 학급 코드와 학생 이름을 정규화하고, `sb_students`를 해당 `class_id` 범위에서 서버 내부 조회한 뒤 이름·번호를 비교한다. RLS, anon SELECT, PIN Vault, `APP_SESSION_SECRET`은 변경하지 않았다.
- 이번 코드 변경 후 실제 함수 재배포와 테스트 학생의 운영 row/로그인 관통 검증은 아직 미완료다. 기존에 배포된 `student-api`는 재배포하지 않는다.
- `student-auth` 단독 배포는 시도했으나 Supabase CLI access token이 이 환경에 없어 `LegacyPlatformAuthRequiredError`로 실행되지 않았다. 운영자 로컬에서 `supabase login` 후 해당 함수만 배포해야 한다.

## student_no NULL 로그인 실패 원인 확정 (2026-09-12)
- 실제 요청 payload의 `studentNo`는 `null`이었다. 기존 `student-auth`가 `Number(body.studentNo)`를 먼저 호출해 `null`을 숫자 `0`으로 바꾸고, `student_no === 0` 조건으로 후보를 걸러내 실제 `student_no IS NULL` 학생을 `STUDENT_NOT_FOUND`로 처리했다.
- `parseOptionalStudentNo()`를 추가해 `null`, `undefined`, 빈 문자열은 번호 미지정(`null`)으로 유지한다. 번호가 지정된 경우에만 해당 번호로 후보를 제한한다. 기존 학생 row backfill이나 `student-api` 재배포는 필요하지 않다.
- `student-auth`만 변경했으며 RLS, PIN Vault, `APP_SESSION_SECRET`, `student-api`는 건드리지 않았다. 로컬 `npm test` 27개, 보안 테스트, typecheck, lint, edge typecheck, build는 통과했다.
- 실제 운영 `student-auth` 배포와 브라우저 로그인 성공은 Supabase CLI access token 부재로 아직 미검증이다.

## 학생 쌓기나무 보관함 UX (2026-09-12)
- 공통 `BlockWorld`에 실제로 집을 수 있는 CSS 정육면체 보관함을 추가하고, 기존 안내 버튼을 제거했다.
- `BlockScene`에서 보관함 드래그→작업판 배치와 보관함 탭→작업판 탭 배치를 Pointer Events로 통합했다. Ghost 미리보기, 기존 블록 위 스냅, 유효하지 않은 위치 차단, 기존 블록 이동/카메라 분리는 유지한다.
- 작업판 캔버스와 초기 카메라를 확대하고 첫 사용 안내를 짧게 표시한다. 안내 확인 값만 localStorage에 저장한다.
- E2E locator와 마우스·터치·탭 배치 시나리오를 갱신했다. Playwright는 이 환경에서 `listen EPERM 127.0.0.1:4173`로 webServer가 시작되지 않아 실행하지 못했다.

## 문제 정확성 감사 및 화면 정리 (2026-09-12)
- `shared/spatialConventions.ts`를 추가해 x/y/z 축, 앞·뒤·왼쪽·오른쪽·위 투영과 한글 방향 표시를 한 곳에서 관리한다. 뒤·왼쪽은 화면 가로 방향을 반전한다.
- 2차시 연습 생성기가 방향에 맞는 투영을 저장하도록 수정하고, 동일한 투영을 만드는 방향이 있으면 다른 seed를 선택하도록 했다. 기본 2차시의 모호한 모양도 비대칭 모양으로 교체했다.
- `scripts/audit-problems.ts`와 `npm run audit:problems`를 추가했다. 기본 30개와 1~8·12차시 template 5,600개(각 template 100 seed)를 검사해 좌표·투영·숫자 지도·층별 표현·정답 종류·단일 방향성을 확인한다. 현재 0 invalid, 0 ambiguous로 통과한다.
- 학생 방향 선택 버튼과 문제 투영 설명에서 영어 enum이 노출되지 않도록 한글 label을 적용했다.
- 학생 월드를 학습 흐름별 그룹, 진행률 막대, XP/별 의미 설명, 보상 화면(`/world/rewards`)으로 정리했다. 교사 화면에는 요약 카드, 메뉴, 학생 링크 복사, 이름 여러 줄 일괄 추가 미리보기를 추가했다.
- 학생 로그인표 인쇄 버튼과 안전한 학생 링크 복사를 제공한다. QR 이미지는 외부 API를 사용하지 않도록 실제 생성기를 추가하지 않았으며, 현재는 별도 QR 도구 안내까지 제공한다.
- 상세 감사 결과와 수업 전 점검 항목은 `PROBLEM_AUDIT.md`, `QA_CHECKLIST.md`에 기록했다.

## 1차 완성도 점검 후속 (2026-09-12)
- Babylon 작업판에 좌표 기준의 앞 방향 화살표를 추가하고, 화면에도 `↑ 앞`을 항상 표시했다. 카메라가 회전해도 앞 기준은 변하지 않는다.
- 학생용 표현을 정리해 `방향에 맞춰 보기`, `전체 학습`, `모든 층`, `↶ 되돌리기`, `↷ 다시하기`를 사용한다. 투영 격자는 실제 행·열과 46px 셀을 사용하며 선택된 셀은 파랑 계열로 표시한다.
- 정답 피드백은 이전 오답 횟수를 함께 반영해 오답 후 정답을 `다시 도전해서 해결했어요!`로 표시한다. 첫 시도 성공 문구와 오답 수가 동시에 모순되지 않는다.
- 교사용 `/teacher/problem-preview`를 추가했다. 차시·문제 틀·seed를 고르면 실제 `BlockWorld`와 문제 자료/답안 방식 컴포넌트로 학생에게 보이는 상태를 확인할 수 있다.
- 회귀 검증: `npm run typecheck`, `npm run lint`, `npm test`(34개), `npm run audit:presentation`, `npm run audit:problems`, `npm run typecheck:edge`, `npm run build` 모두 통과. 실제 Supabase 재배포와 브라우저 E2E는 이 변경 범위에서 수행하지 않았다.
- 10차시는 구상·3D 설계·층별 공간 입력 중심으로 분리하고, 11차시는 소개서 미리보기·설명 다듬기 중심으로 분리했다. 11차시에서는 `건축물 수정하기`를 눌렀을 때만 Builder를 열며, 기존 공통 프로젝트 저장/복원 데이터와 4×4 설계판은 그대로 공유한다.
- `qa:curriculum`과 `QA_REPORT.md`를 추가했다. 차시 route, 기본/연습 단계, answer renderer 계약, 9~12차시 특수 route를 코드 기준으로 자동 확인한다.
- 답안 입력이 비어 있던 `LAYER_DRAW` 문제는 주어진 층 수·격자 크기로 빈 입력판을 초기화하도록 수정했다. 8차시와 12차시 층별 답안 입력이 실제로 표시된다.
- 3D 기본 테마를 나무색 블록·오프화이트 격자판·연한 블루그레이 배경으로 정리하고, 바닥 타일과 grid gap의 대비를 높였다.
- `qa:visual` 자동 캡처 스위트(1366×768 및 1024×768 touch)를 추가했지만 현재 샌드박스에서는 Vite가 `listen EPERM: 127.0.0.1:4173`로 시작하지 않아 캡처를 생성하지 못했다.
