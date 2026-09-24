# MVP 작업 기록

## 교과서 흐름·단계 페이지·10×10 작업판 보완 (2026-09-12)
- 학생 월드의 일반 차시 카드를 `/lesson/:lesson/learn`으로 연결하고, 실제 라우트 `/learn`, `/solve`, `/practice`를 분리했다. `① 개념 배우기`는 기존 채점 패널을 재사용하지 않고 차시별 관찰·직접 해 보기·정리 안내와 안내된 Babylon.js 탐구를 제공한다.
- `LessonPage`는 `/solve`와 `/practice`를 라우트 기준으로 선택하며, 단계별 문항 위치와 숫자·선택·격자 답안 초안을 브라우저 세션 범위에서 문항별로 복원한다. 더 풀어보기는 필수 학습 완료 전 자동으로 문제 풀기 단계로 안내한다.
- 단계 버튼, 완료 후 이동, 틀린 문제 다시 풀기, 유사 문제 풀기의 URL과 실제 문항을 함께 갱신하도록 연결했다. 기존 문제·진도·Supabase 저장 계약은 변경하지 않았다.
- `BlockScene`의 초기/방향 보기 프레임을 작업판 크기에 맞게 조정해 10×10 설계판의 유효한 바닥 칸이 첫 화면에서 보이도록 했다. 정사영 프레임도 넓은 판 전체가 잘리지 않도록 여유를 둔다.
- `qa:local`은 실제 단계 URL과 새 표시명을 사용하도록 갱신했고, 개념 배우기 페이지에서 문제 풀기로 전환하는 대표 브라우저 검사를 추가했다. 기존 `qa/local-browser-qa/history/9518934/` 실패 증거는 보존한다.
- 검증: `npm run audit:problems`, `audit:presentation`, `audit:semantics`, `audit:solvability`, `qa:curriculum`, `npm run typecheck`, `npm run lint`, `npm test`(46개), `npm run test:security`, `npm run typecheck:edge`, `npm run build` 통과. 맥용 Chromium 재실행은 이 환경의 기존 포트 실행 제한으로 별도 실행하지 않았다.

## 문제 진행 위치 복원 P0 수정 (2026-09-12)
- `LessonPage`에서 단계 필터 effect가 `problemIndex`를 매 렌더링마다 0으로 되돌리던 경로를 제거했다. 단계 이동·이전/다음·틀린 문제 재풀기·새 연습 세트처럼 사용자가 명시적으로 위치를 바꾸는 동작에서만 인덱스를 변경한다.
- `sb_student_progress.last_problem_id`를 `lessonProblems` 응답에 포함하고, `position` 학생 API로 이동 위치를 저장한다. 자동 진행과 수동 이동 모두 DB 위치를 갱신하며 seed 문제는 안전하게 건너뛴다.
- 재접속 시 저장된 문제 ID를 세트 인덱스로 복원하는 순수 함수와 경계값 테스트를 추가했다. 기존 `practice_seed`, 시도 기록, 블록 snapshot 저장은 변경하지 않았다.
- 검증: `npm run typecheck`, `npm run lint`, `npm test`(36개), `npm run typecheck:edge`, `npm run build` 통과. Playwright는 기존 샌드박스 로컬 포트 제한으로 별도 미실행.

## 학습 workspace·건축판·3D 테마 보강 (2026-09-12)
- 학생/교사 콘텐츠 폭을 최대 1600px의 유동 레이아웃으로 확장하고, 데스크톱의 여러 답안 격자와 층별 자료가 가로로 비교되도록 보완했다.
- 건축 프로젝트 기본 작업판을 8×8×3으로 분리했다. `Building`에 grid 메타데이터를 담고 `202609110015_architecture_grid.sql`에서 저장/복원하며, 메타데이터가 없는 기존 5×5 기록은 서버 값을 통해 그대로 연다.
- 앞 방향 표식을 작업판 앞쪽 경계 중앙의 `앞쪽 경계 ↑`로 정리하고 보관함 CSS 블록을 원목 베이지 팔레트로 맞췄다.
- 원격 Supabase에는 015 migration을 아직 적용하지 않았으므로 배포 전에 001~015 순서 적용이 필요하다.

## Semantic·Solvability QA 명령 추가 (2026-09-12)
- `audit:semantics`를 추가해 질문 문구와 답안 형식(방향·개수·투영·높이·층별)의 의미 계약을 2,830개 문제에서 검사한다.
- `audit:solvability`를 추가해 기본/생성 문제의 유효 블록 구조, 정답 구조, constraint 조건 자료를 출제 전에 검사한다. 현재 2,830개 모두 통과했다.
- QA_REPORT에 자동 오류 카운터를 기록했다. `PROGRESS_RESET`은 코드·단위 감사 기준 0이며, 실제 기기 레이아웃·터치 동작은 브라우저 환경 제한으로 별도 확인이 필요하다.

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
## XP 보상 공방과 작품 외형 연결 (2026-09-12)
- `shared/rewards.ts`에 버전 1 보상 카탈로그와 XP 해금 임계값(원목/파스텔/벽돌/타일, 설계 도면/전시관/하늘 정원)을 단일 출처로 추가했다. 보상은 실제 10·11차시 작품에서 사용할 수 있는 항목만 공개한다.
- `student-api`에 보상 조회와 장착 action을 추가하고, `sb_set_reward_loadout` 서버 함수가 XP 임계값을 다시 확인하도록 했다. 클라이언트가 XP를 임의로 올리거나 잠금 보상을 장착할 수 없다.
- `BlockWorld`/`BlockScene`에 좌표와 분리된 블록 외형 metadata를 연결했다. 새 블록과 이동 블록의 재료가 유지되고, 채점 좌표에는 영향을 주지 않는다. 건축 페이지에서 해금된 재료만 선택 가능하다.
- `sb_projects.block_appearance`, `intro_theme`, `sb_student_rewards.equipped_material`, `intro_theme`을 추가하는 `202609110016_rewards_loadout.sql`을 작성했다. 기존 `sb_save_building`은 외형/테마를 함께 저장하며 service_role 전용이다. 원격 Supabase에는 아직 적용하지 않았다.
- `/world/rewards`를 실제 `보상 공방`으로 바꾸어 해금 상태, 미리보기, 사용하기, 저장 결과를 표시한다. 작품 새로고침/재로그인 시 장착 상태를 다시 읽는다.
- 테스트에 보상 임계값과 외형 metadata 정제 검사를 추가했다. 기존 미추적 `supabase/.temp/`는 보존한다.
## 최신 요구사항 정정 및 신규 건축판 10×10 (2026-09-12)
- 최신 기준 문서 `CURRENT_REQUIREMENTS.md`를 추가했다. 과거 문서의 8×8/4×4 표현은 신규 기본값 기준에서 폐기하고, 실제 검증 상태와 브라우저 BLOCKED 상태를 분리했다.
- 신규 `ARCHITECTURE_GRID`를 10×10×3으로 변경했다. `sb_projects` 새 행의 기본값과 저장 RPC의 메타데이터 없는 신규 입력 기본값도 10×10으로 맞췄다. 기존 5×5·8×8 저장 행의 grid metadata/좌표는 변경하지 않는다.
- 오른쪽 관찰 기준은 기존 코드의 `side[y][depth-1-z]`, `projectionForDirection(..., 'right')`, Babylon side camera 경로와 일치함을 고정 비대칭 fixture로 확인했다. 표시명만 바꾼 것이 아니다.
- 현재 환경에서는 실제 브라우저 캡처와 live Supabase 관통 검증을 수행하지 못했으므로 `CURRENT_REQUIREMENTS.md`와 QA 보고서에 BLOCKED로 기록했다.

## 오른쪽 관찰 기준 표시 보강 (2026-09-12)
- 학생 답안 격자와 문제에서 함께 제시한 투영 자료의 `옆` 제목을 `오른쪽에서 본 모양`으로 명확히 표시했다.
- 차시 화면에 단원 공통 기준 안내를 추가했다. 계산 로직과 좌표 규칙은 기존 오른쪽 관찰 기준을 그대로 사용한다.
- 로컬 회귀: `npm run typecheck`, `npm run lint`, `npm test`(39개), `npm run build` 통과. 실제 브라우저 캡처는 포트 바인딩 제한으로 여전히 BLOCKED다.

## 관찰 기준 자료 및 교사 3D 기록 보강 (2026-09-12)
- 위에서 본 모양·높이 지도·층별 지도·학생 답안 격자에 `앞에서 바라봄`과 `오른쪽(옆)에서 바라봄` 관찰 기준을 표시했다. 앞·옆 실루엣에는 바닥 지도 화살표를 붙이지 않는다.
- 교사 학생 기록과 놀이·건축물 기록이 저장된 `grid_width/grid_depth/max_height`를 사용해 10×10 작품과 기존 5×5·8×8 작품을 각자의 작업판으로 다시 렌더링하도록 수정했다. 작품 외형 metadata도 유지한다.
- 자동 감사: `audit:problems`, `audit:presentation`, `audit:semantics`, `audit:solvability`, `qa:curriculum` 모두 통과. DOM/기기 캡처는 포트 권한 제한으로 BLOCKED다.

## 학생 화면 긴급 오류 R01~R06 수정 (2026-09-12)
- 실제 학생 route의 `LessonPage`가 문제 `presentation.gridSpecs`와 구버전 응답의 `given`/문구를 함께 해석하도록 보강했다. 3차시 `PROJECTION_DRAW`는 답안 격자를 빈 상태로 mount하고 제출 payload에는 문제에서 요구한 면만 포함한다. 필요한 면 정보가 없으면 제출을 막고 오답 횟수를 올리지 않는다.
- 5차시 대표 문항을 정보 충분성 판단(`CHOICE`)과 ‘숨은 블록 없음’ 가정하의 숫자 세기(`COUNT`)로 분리했다. 숫자 정답은 원본 3D 총개수가 아니라 제시된 앞면의 채워진 칸 수를 사용한다. 연습 생성기의 최대 개수 문항도 앞 투영에서 가능한 상한을 계산한다.
- 정답 공개 후 후속 활동은 답안 유형에 맞춘다. 숫자·선택·격자·높이 지도·층별 지도는 자료와 다시 답하기를 제공하고, 실제 블록 쌓기 유형만 정답 3D Ghost와 재구성 단계를 요구한다. `applyAttempt`에 `requiresRebuild` 계약을 추가하고 Edge Function이 문제 유형에 따라 전달한다.
- 학생 단계 표시를 `① 개념 배우기 → ② 문제로 익히기 → ③ 더 풀어보기`로 고정하고 한 단계씩 문항을 탐색하도록 초기 `all` 혼합 상태를 제거했다. 저장된 현재 문항은 해당 단계 안에서 복원한다.
- 학생 화면의 앞 표시는 `앞`으로 단순화하고, 보관함 아이콘은 세 면이 같은 꼭짓점을 공유하는 닫힌 SVG 정육면체로 교체했다. 기존 Pointer Events 드래그·탭 배치와 원목 색상 토큰은 유지한다.
- 현재 작업 트리 기준 회귀: `npm run audit:problems`(5,600 생성), `audit:presentation`(14,030), `audit:semantics`(2,830), `audit:solvability`(2,830), `npm test`(41개), `test:security`, `typecheck`, `lint`, `typecheck:edge`, `build` 모두 통과했다. 테스트 실행 대상은 이 변경을 포함한 작업 트리이며 커밋 전 HEAD는 `4ebd1995`다.
- Playwright 시각 캡처/Renderer DOM mount는 이 환경의 Vite 포트 바인딩 오류 `listen EPERM: 127.0.0.1:4173`로 실행하지 못했다. 따라서 실제 브라우저 화면 증거는 BLOCKED이며 자동 감사 PASS를 화면 VERIFIED로 승격하지 않는다.

## 최종 품질 게이트·문항 inventory 추가 (2026-09-12)
- 앱 전용 `AGENTS.md`에 `CURRENT_REQUIREMENTS.md`와 `QUALITY_GATE.md` 선독, 실제 학생 route 우선 확인, 브라우저 미검증 항목의 BLOCKED 기록 규칙을 추가했다.
- `QUALITY_GATE.md`에 문항·활동 목록, 상태 정의, 수학·자료·Renderer·grader 계약, 오답/복원/실제 서버와 모의 UI 검증 분리 기준을 고정했다.
- `scripts/generate-problem-inventory.ts`와 `npm run inventory:problems`를 추가해 현재 코드에서 고정 30개, practice template 대표 56개, 9~12차시·교사 기능 활동 6개, 수업용 practice manifest 140개를 `PROBLEM_INVENTORY.json`으로 생성한다. 원격 데이터가 수집되지 않은 범위는 LIVE로 표시하지 않는다.
- 의도적으로 격자 자료를 제거한 문항, 3×3 앞면의 9/20 변조, 오른쪽 투영 좌우 반전을 품질 게이트 테스트에서 거부하도록 `tests/qualityGate.test.ts`를 추가했다.
- 당시 품질 게이트 작업 트리에서는 `npm test` 45개를 통과했다(역사 기록). 실제 학생 화면 DOM/터치/서버 관통은 포트 권한 제약으로 BLOCKED였다.

## 최종 품질 기준 보강 (2026-09-12)
- 실제 학생 route를 모의 API로 여는 `e2e/renderer-mount.spec.ts`에 셀 입력 상호작용 검사를 추가했다. 3방향 격자의 셀을 클릭하면 선택 상태가 바뀌고 `attempt` 제출 payload의 해당 투영 좌표가 변경되는지 확인한다.
- 자료와 방향 단서가 없는 투영 문항은 학생 route에서 답안 Renderer가 준비되지 않은 상태로 안내하고, 정답 확인 버튼을 비활성화하며, attempt 요청이 발생하지 않는지 검사한다. 이는 화면 표식만 있는 빈 영역을 통과로 보지 않기 위한 회귀 사례다.
- 이번 보강은 실제 브라우저 실행이나 원격 Supabase를 변경하지 않았다. Playwright는 현재 환경의 `listen EPERM: 127.0.0.1:4173` 제약으로 여전히 `BLOCKED`다.
- 기준 HEAD `a53724c19b8151326787f477f2a00b1bb8b7cfbe`에서 시작한 변경이며, 추적되지 않은 `supabase/.temp/`는 보존한다.

## 맥용 production 브라우저 QA 실행기 (2026-09-12)
- `scripts/local-browser-qa.ts`와 `npm run qa:local`을 추가했다. 앱 디렉터리·HEAD·working tree·Chromium 실행 파일을 확인하고, 환경변수 고정값 없이 production build와 임시 preview를 준비한다.
- 실제 학생 `LessonPage`, `BlockWorld`, `ArchitecturePage`를 합성 `student-api`와 함께 열어 3·12차시 격자 입력/제출, 5차시 판단·개수, 숫자 정답 공개, 단계 위치, 보관함 드래그와 snapshot, 10×10 건축 재료 저장, 11차시 복원을 자동 검사한다.
- 테스트가 시작한 preview만 종료하며 기존 localhost 서버는 종료하지 않는다. 실패 시 문제 ID/fixture 버전/단계/기대·실제 메시지/실제 브라우저 캡처와 trace를 `qa/local-browser-qa/`에 저장한다. 보고서는 `UI_WITH_TEST_DATA`로 분류하고 LIVE_SUPABASE와 혼동하지 않는다.
- 현재 샌드박스에서는 새 실행기를 한 번 실행했다. production build는 성공했지만 preview 포트 확보 단계의 `listen EPERM: operation not permitted 127.0.0.1`로 BLOCKED됐고, `qa/local-browser-qa/report.json`·`report.md`가 생성됐다. 같은 실패를 반복하지 않고 운영자 맥에서 `npm run qa:local`을 한 번 실행한다.
# 공통 격자·방향 라벨·완료 후 이동 보완 (2026-09-12)

- `ProjectionGrid`의 입력·참고·정답 셀을 고정 48×48 정사각형으로 통일하고, 바닥 지도 관찰 기준을 격자 아래 `앞`, 오른쪽 `옆` 라벨로 배치했다. 기존 행·열과 좌표 순서는 변경하지 않았다.
- `LessonPage`에서 완료 상태가 제출 버튼만 막도록 분리하고, 완료 후 `다음 문제`·`문제로 익히기 시작`·`더 풀어보기 시작`·`차시 결과 보기` 행동을 제공한다. 제출 직후 자동으로 문항을 바꾸지 않아 현재 위치를 유지한다.
- `qa:local`에 셀 bounding box 정사각형/라벨 위치 검사와 완료 후 단계 이동 회귀 사례를 추가했다(대표 흐름 12개). 실제 브라우저 실행은 운영자 맥에서 수행한다.
- 현재 커밋에서 `npm run typecheck`, `npm run lint`, `npm test`(46), `npm run build`, QA 실행기 구문 검사가 통과했다. 샌드박스 포트 제한으로 브라우저 화면 증거는 아직 BLOCKED다.
# 로컬 브라우저 QA 9건 실패 원인 분리 및 실행기 보완 (2026-09-12)

- 운영자 맥에서 생성된 `qa/local-browser-qa/report.json`(대상 `9518934b`, 12개 중 PASS 3/FAIL 9)과 캡처·trace를 보존했다. 기존 결과는 `qa/local-browser-qa/history/9518934/`에 복사했고, 이후 `qa:local` 재실행 때도 HEAD별 history를 자동 생성한다.
- T01·T02·T06·T09·T10은 실제 화면이 lazy fallback인 상태에서 즉시 assertion한 테스트 타이밍 오류로 분류했다. T04·T05는 결과 렌더링을 기다리지 않은 assertion 오류였다. T07·T08은 보드 중앙을 항상 유효한 칸으로 가정한 조작 오류였다. 캡처상 앱 fallback·성공 결과·보드/보관함 표시를 각각 확인했으며, 앱 채점 계약을 완화하지 않았다.
- `local-browser-qa.ts`에 실제 학생 route 준비 대기, 유효 칸 후보를 순회하는 마우스/터치 drag, 실패 단계(`render-input`/`interact`/`assert-grade` 등), 원인 분류(`APP`/`FIXTURE`/`TEST`/`ENVIRONMENT`/`UNKNOWN`), 콘솔 오류 안전 요약을 추가했다.
- 보고서의 계획/실행 범위는 12개 대표 흐름으로 유지하며, 전체 inventory는 여전히 NOT_RUN 후속 대상이다. 새 합성 데이터·원격 DB 변경은 없다.
- 현재 커밋에서 `npm run typecheck`, `npm run lint`, `npm test`(46), `npm run build`, `node --experimental-strip-types --check scripts/local-browser-qa.ts`가 통과했다. 수정된 실행기의 실제 맥 재실행은 다음 운영자 실행에서 확인한다.
# 2026-09-12 간편 설치 요구 통합 및 완료 판정 보정

- 시작 HEAD: ac5d871b14c99f33ccdb7015f3aa3601c2c991df. 기존 미추적 supabase/.temp/ 보존.
- 최신 메시지 10개 요구를 CURRENT_REQUIREMENTS와 DISTRIBUTION_ARCHITECTURE에 반영. 첨부 제목 검색 결과 없음: 별도 전문 미확인.
- /setup은 Auth settings 읽기와 공개 config 저장만 수행한다. 자동 학생 화면 이동을 없애고 교사 로그인으로 명시적으로 이어가며 설치 완료와 연결 성공을 구분했다.
- getInstallationStatus가 설정 존재만으로 연결 성공을 추정하거나 선행 단계 없이 READY에 도달하지 않도록 수정. 학생 인증·활동 저장·새 세션 복원 증거 플래그 추가. 실제 증거 수집 실행부는 아직 없음.
- 공식 OAuth/Management API 조사: client secret을 안전하게 보관할 실행부가 필요. 정적 Cloudflare만으로 자동 설치 성공을 만들지 않음. 새 중앙 실행부·비용·권한은 승인 대상. 외부 수동 준비 제거 0개, 신규 설치/업데이트/중단 복구 실제 검증 NOT_RUN.
- 검증 시각 2026-09-12T11:43Z, 대상은 시작 HEAD + 이번 distribution/SetupPage/tests 변경. typecheck PASS, lint PASS, npm test 47 PASS, build PASS, git diff --check PASS. 브라우저 및 LIVE_SUPABASE 검사는 실행하지 않았으며 기존 QA 미완료를 승격하지 않음.
- 원격 push/DB/migration/RLS/Secret 변경 없음. 학생 화면 P0와 qa:local 실패 분석은 기존 체크포인트 그대로 미완료이며 설치 문서로 대체하지 않음.
# 2026-09-12 5차시 반복 세트 — 로컬 수정 체크포인트

- 기준 HEAD ac0b3f32673871350655a0846aaad19b70aabc97, 미추적 supabase/.temp/ 보존. 첨부 bbb095a2 지시문 전문 확인.
- 운영 35문항 응답/학생 세션/교사 배정 설정은 미확보. 실제 URL·누적 여부·문항 버전 및 1~35 운영 대조표는 BLOCKED. 35를 임의로 줄이거나 운영 기록을 수정하지 않음.
- 코드상 APP 결함: (1) shape 식이 seed mod 3만 사용 (2) lessonProblems가 생성 없는 재조회에서 seed 필터 전 problemRows를 반환 (3) practice:new-set 저장 seed를 목록 조회가 무시 (4) 전역 class_id NULL 문항은 UNIQUE(class_id,code)로 중복 삽입 방지 불가. 마지막 항목은 PGlite 실제 SQL로 재현.
- 새 v2 모형은 결정적 PRNG, 공개 과제 fingerprint, 슬롯별 최대 256회 재시도, 부족 시 오류. v1 기본 함수와 기존 DB 행은 유지. v2 생성 ID는 code 해시 기반 안정 UUID로 기존 PK를 이용해 삽입 중복을 방지한다. migration 변경 없음.
- 5차시 신규 6계열: 충분성 판단/숨은 블록 없음 가정/명시된 깊이에서 최대/추가 정보/설명 오류/회전 후 실제 개수. 질문·보기·정답·힌트·해설을 연결. 3차시 v2의 면 순서와 문구 불일치도 수정.
- lessonProblems는 항상 현재 seed로 필터하고 기존 세트가 있으면 보존. 신규 추가량은 교사 practice_count 자체를 사용하며 필수 문항 수를 빼지 않는다. 읽기/쓰기 실패 시 성공으로 처리하지 않는다. 새 세트는 생성·저장 이후 seed 전환. 실제 원격 동시성/중단 관통은 미검증.
- 학생에게 중복 묶음 안내와 명시적 새 세트 확인을 제공. 기존 답안/시도/XP 삭제 또는 재채점 없음. 이전 기록 열람·복원과 보상 집계의 실제 서버 확인은 남음. 기존 오류 세트를 자동 교체하지 않음.
- 테스트 우선 재현: 수정 전 합성 seed123 35개 중 공개 과제 6개로 FAIL. 수정 후 35개/6계열(6,6,6,6,6,5). 여러 seed 반복 복원 PASS. 실제 35문항이 전부 하나였다는 신고를 이 합성 수치로 대체하지 않는다.
- qa/practice-sets/2026-09-12T12-06-36-885Z/report.json 및 comparison.md: 합성 전후 1~35 대조표와 1~8/12차시 5/10/15/20 표본. 2·3·6차시 동일 입력 행동 편중은 NEEDS_FAMILY_REVIEW, 모든 차시 품질 완료 아님. 9~11 반복 작품/공유 문제와 기존 조작/복원 오류는 미완료 유지.
- qa:local T14 추가: 실제 학생 /lesson/5/practice에 합성 v2 35개, 실제 클릭/숫자 입력/제출 ID·grade 확인, 문항별 캡처/대조표. 기존 13건 보존. 외부 네트워크 기본 차단. 브라우저 실행 0, BLOCKED. Babylon Scene 내용 비교·지연 응답 변형·기존 운영 세트 순회·로그아웃 복원은 아직 미검증이며 이 테스트 추가만으로 완료 처리하지 않는다.
- workspace/attachments에서 5차시 PDF를 찾지 못해 수학66~67/익힘48~49/지도서 원자료 적합성 확인 BLOCKED. 6계열은 앱 구성이지 교과서 공인 분류가 아니다.
- 실행(2026-09-12T12:06Z 이후, 기준 HEAD+이번 작업 트리): typecheck/lint/unit54/security1/typecheck:edge/build PASS. qa 실행기 구문 검사 및 diff --check PASS. 마지막 DB 읽기 오류 분기 추가 뒤 lint/edge 재확인.
- 코드 커밋 b7ae120b6c58b7d31c12832ab3d78bd817e0c449에서 2026-09-12T12:11:55Z 이후 typecheck/lint/unit54/security1/typecheck:edge/build 모두 다시 PASS. 이후 변경은 이 검증 기록뿐이다. 브라우저 실행 0/BLOCKED, LIVE 검증 없음.
- 설치 상태는 '완료 판정 오류 수정 완료 / 간편 설치 미구현'. getInstallationStatus는 학생/교사 route의 진입 gate로 사용되지 않아 첫 저장을 READY로 막는 순환 조건 없음.
- 원격 함수/DB/RLS/Secret/학생 데이터 변경·push 없음. student-api 재배포 전 실제 운영 증거/승인 범위를 확인해야 한다. 전체 요구 완료 아님.

# 2026-09-12 실제 반복 세트 조사와 보존 복구 체크포인트

- 시작 HEAD875229ab7bf45ce40b8dd1ce882d88422e368ebe. b7ae120→875229a 차이는 WORKLOG만이다. 이번 실행 코드 커밋 `d6bbe6612b63dd2669321183dd1f6dbc901e4802`. 기존 supabase/.temp/ 보존.
- 실제 Chrome /lesson/5/practice에서1~35 화면을 읽기 순회한 후 원래11/35로 돌아왔다. 제출/새세트시작/로그아웃은 하지 않았다. DB 공개 문항과 대조: 기본추가1+17코드×2=35, 공개 과제6개. 교사배정20, 저장seed603756, 반환문항seed595837. 같은ID만35번/첫화면고정이라는 추측은 배제했다. 동일code 두 UUID의 화면 순서는 DOM에 ID가 없어 미확정. 실제 화면 캡처는 도구 결과에 있고 로컬 PNG export는 브라우저 미지원이다.
- READ ONLY로 확인한 원격student-api: ACTIVE v4, SHA256 d746eef83edbaedf647e5a83ed89da92ac0df36f5921f38f2385d520825329a2. 저장seed 무시·17개생성·NULL class_id/code unique의 중복허용·생성없는목록에서 필터누락이 현재원인이다. 브라우저는 Vite HMR이며 실행commit 확인불가: 최신코드 화면PASS로 보고하지 않는다.
- 신규 변경: practiceSet 계약2/실제배정량과기본추가량 구분/구서버전환 차단. 직접practice재접속의 서버cursor 사용, 설치·학생별로 로컬cursor/답안 분리. 기대seed CAS로 중복 새세트 요청1회전환. 개별generated ID는 현재seed 또는 본인기존기록 검증. DB읽기실패를 빈데이터로 처리하지 않음.
- 안전복구: 저장seed에 준비된 세트가 없고 기존원래seed세트가 남으면 기존35개 유지+awaitingReplacement 안내. 명시적new-set 요청 후611675의 배정20개를 먼저 저장하고 전환. 기존문항/답안/XP삭제·재채점 없음. 원격복구 실행없음. 과거세트 목록UI, 실제로그아웃복원, 기존 비소유자정보 없는 로컬cursor의 이관/현재위치 유지, 보상관통 검증은 BLOCKED로 남긴다.
- 생성ID PK 중복8요청/다른버전ID분리/CAS 경쟁2요청 및 재전송은 로컬PGlite로 검증. 실제 Supabase 동시 HTTP·네트워크유실은 미검증. 같은학생완료사건 XP중복방지 기존 DB검사를 유지했으며 새세트관통 성공으로 확대하지 않음.
- seed0,1,2,3,42,123,7919,595837,603756,611675,999999 × 배정5,10,15,20,35. 5차시55세트 공개fingerprint고유수=배정수, 최장같은계열1. 6계열 목표/자료/행동/답근거와 의미검사한계는 comparison.md. 과제수가 다른 모든세트에35/6계열을 강제하지 않음.
- 다른차시1~8/12도 같은표본 검사. 2/3/6은 각 CAMERA_DIRECTION/PROJECTION_DRAW/BUILD_FROM_VIEWS에 편중, 최장35. 문제타입수와 세부template수는 다르며 전체 의미품질PASS 아님. 이번에는 근거없이 새로운template을 추가하지 않았다. 기존 P0/UI/작품복원 미완료 유지.
- 기존 qa:local T14에 실제공개격자표시값/입력payload문항ID/3번답안 reload복원을 보강. 새실행기/인증우회/운영쓰기mock 없음. 수정후35문항 입력·제출 브라우저 실행0, BLOCKED. 이전 운영35개 읽기순회를 신규세트 자동검증으로 세지 않음. 단계왕복·Babylon매문항모형·깨끗한세션과기존복원·재료/11차시 실제화면은 미검증. 알려진 로컬포트제한 재시도/우회 없음, 사용자에게qa명령 재실행 요청하지 않음.
- 검증 `2026-09-12T12:47:14.924448+00:00`, 대상 `d6bbe6612b63dd2669321183dd1f6dbc901e4802`: typecheck/lint/unit/security/typecheck:edge/build/QA구문/diff검사 PASS. 실행원본은 verification.json/log. 이후 문서·결과파일 기록만 변경. 현재검사를 과거PASS로 대체하지 않음.
- 간편설치: 이전요청의 실행안1개를 DISTRIBUTION_ARCHITECTURE에 구체화(제작자전용 Supabase Free OAuth실행부). 공식API/권한/한도/중단·재개/승인범위 명시. 실제 수동작업 감소0, 실행부 미구현/승인전. READY기존수정 재작업 없음.
- 원격 함수/DB/RLS/Secret/학생기록 변경·배포·push 없음. migration추가없음. 원격migration 이력은[]이지만 schema는존재하므로 빈DB라고판정하지 않는다.

## 2026-09-13 — redesign Phase 1 (local only, browser BLOCKED)

Start 3454fd7, branch feature/spatial-math-redesign-v1. Pre-existing work backed up at /private/tmp/stacking-blocks-pre-redesign-20260912-235523. New isolated /student/lesson/3/redesign route: explicit contracts, display inverse, five action-based activities, 6+4 adaptive solve, 5+5 practice, four-step feedback, versioned local persistence. Existing 3D math/scene and authentication reused; no remote mutation. See qa/redesign-phase1/README.md for scope and evidence. New + existing unit suite 75 passed; browser attempt executed 0 because preview process exited before launch. T01–T15 remain BLOCKED. No installation completion or whole-app completion claimed.

## 2026-09-13 — Phase 1B production browser gate PASS

- Start HEAD 5b43a2504085443235afed4c55ba0064ea043150, feature/spatial-math-redesign-v1. Existing ten modified files and untracked evidence/settings preserved; only Phase 1B hunks go into a separate commit. No amend/reset/push/deploy/migration/operating-data access.
- Exact initial qa:redesign run and standalone preview both confirmed immediate listen EPERM at 127.0.0.1:4186, no port collision. Tool-approved local execution of the same preview served all four routes HTTP 200; no port/dev-server/package change.
- Real screenshot exposed a right-side mirror mismatch missed by the original tests. Added independent actual WebGL-pixel assertion, reproduced FAIL, then added redesign-only side display/inverse adapter. Legacy canonical data/grading/records preserved. Front label follows the actual board edge; perspective clipping and hidden floor tiles corrected; wide comparison panels now sit side by side.
- Final single actual Chromium run: T01–T15 + R16 = 16 PASS / 0 FAIL / 0 BLOCKED / 0 NOT_RUN. Real mouse add/delete/Undo/Redo, CDP touch drag, all 6+4 solve submissions, practice 5+extra entry, four-stage feedback, current activity/question/grid/block reload, legacy login UI and actual legacy ProjectionGrid payload. Failed/intermediate runs retained; final gate-confirmation result is authoritative.
- Current production build SHA256 9021a0c7d760e7e518ab4f73928d63984b55d12ee78dd5df24c449cf319c2541. Tests ran against start HEAD plus preserved working changes and this phase, not pristine HEAD. Source/test/build identity and UTC execution recorded in qa/redesign-phase1/browser-gate/gate-confirmation/. Screenshots visually inspected; trace and original failure logs retained.
- typecheck/lint/unit 76/security/typecheck:edge/build PASS on current app code; final E2E source separately typechecked/linted. See browser-gate/checks/results.json for timestamps.
- Scope: UI_WITH_TEST_DATA, LOCAL_ONLY. No LIVE_SUPABASE/physical iPad/Safari/cross-device verification. Feedback/activity5/completion retain vertical scroll with full-sized controls. Old learning/INSTALL_EASY backlogs are not declared done. READY_FOR_PHASE_2 for this browser gate only; stop before other lesson implementation.


## 2026-09-13 — Overnight Phase 1B / Phase 2 local gates PASS

- Start fcb1d28f37b92ecd61deb8680f5485b152beb4a5 on feature/spatial-math-redesign-v1; ten pre-existing modified files and their untracked evidence preserved. START_STATUS and preserved diff recorded under qa/overnight-20260913. Only new Phase 2 hunks staged, including two isolated BlockWorld toolbar lines.
- Phase 1B rerun: real production preview Chromium 16/16 PASS. Tool-approved local execution resolved the previously diagnosed sandbox listen EPERM; no port substitution or remote execution. Existing runner retained.
- Added isolated redesign routes for lessons1/2/4 using shared contracts, answer renderer, grading, display adapter, persistence and Babylon. Learn4/4/5, solve8/9/9, practice5 each. Actual block inspection, four named viewing directions, synchronized height/column/layer highlighting; count invariants validated before problems are offered.
- Final qa:redesign production run 19/19 PASS including all three complete new student flows and full16 previous cases. Source SHA256 239c096753738198e5f31e035f3681f6a83cba21375a5bf50c46716ff0563a83; build 9be2701d9eb96a68f132e1a88f10829ae67fbb4f9801eba8c17e65ecf773b620. Test target includes existing working changes; not a claim about pristine start commit. Screenshots visually reviewed; fixed-photo stale rotation help removed and full browser run repeated.
- Full unit initially found one obsolete left/back→free expectation. Updated to explicit left/back and retained noncanonical/zero free assertions; final81/81 PASS. typecheck/lint/build/edge/security1 PASS. Timestamped logs in checks/, including the retained initial failure.
- LOCAL_ONLY / UI_WITH_TEST_DATA: synthetic browser identity, all remote browser requests aborted. No Supabase/Auth/DB/migration/secret/operating data/push/deployment changes. Existing broader P0 and INSTALL_EASY not declared complete. Phase 3 begins only as design preparation after these gates.


## 2026-09-13 — Overnight Phase 3 design preparation only

- After Phase2 gate and local commit762780a, read existing coordinate conversion, display adapter, contract validation and grading. Existing projection-constraints checks candidates but min/max remains unsupported; no full-model enumerator is implemented.
- qa/overnight-20260913/PHASE3_PREP.md proposes bounded height-variable search, pruning, COMPLETE/LIMIT_REACHED separation, fixed independently enumerated fixtures, height/layer input validation, missing-layer ambiguity and next gate order.
- No solver or lesson5~8 implementation; performance numbers are candidate-space arithmetic/initial budgets, not benchmark results. No remote actions. Installation simplification and existing unresolved learning scope stay open.


## 2026-09-13 — Phase 3 local solver and lessons5–8 PASS

- Start efb878d7517cfa60b5becc61e385af2b194fdc46, branch feature/spatial-math-redesign-v1. Local implementation b1638f9; targeted camera corrections a7a51b6 and 89793e4. Existing ten modified files retain exactly their original added/removed lines (preservation.json); only new hunks staged.
- Height-column solver with bounded complete/limit/cancel/invalid outcomes, top/front/right, heights/layers/given/exact count, pruning and independent fixed fixtures. No large-board exhaustive generation on interactions.
- Isolated lessons5–8 redesign routes: action-gated Learn5 each; Solve10/10/9/9 (common6 + concept-tag adaptive); Practice5+optional5. Sufficient/insufficient, hidden count ranges, any-valid 3D, exact heights/layers and unique middle-layer inference. Existing runtime/auth/operating curriculum preserved.
- Final production Chromium run qa/redesign-browser/89793e4-2026-09-13T00-33-57-072Z: planned29/executed29/PASS29/FAIL0/NOT_RUN0. All four Learn/Solve/Practice flows, drafts and completed state reload, stage roundtrip, actual mouse/touch/tap, independent alternative structure, four wrong steps, plus all19 previous cases. Screenshots visually reviewed. Source 6f39ede78b963d72b8ed36f1cfee3495275a191300d40a8743540d2f6d411ae9; build 9badec09b7cfff783a344e6c312087ab5d50e611ded1a55c579d57f4d2615ed2; code HEAD 89793e43b211901b3aa45600baf4528e7643a65e plus preserved working tree.
- Intermediate focus-border screenshot failure retained and fixed by matching focus, without relaxing pixel equality. Old-build run explicitly interrupted after code corrections; never counted as final PASS. Final source frozen during all29 cases.
- Current code tests: unit101, solver12 included, typecheck, lint, build, Edge, security and E2E typecheck PASS; UTC logs in qa/redesign-phase3/release-checks.json. Final report qa/redesign-phase3/PHASE3_REPORT.md.
- LOCAL_ONLY / UI_WITH_TEST_DATA / ANSWER_PROTECTION_NOT_REMOTE_VERIFIED. No LIVE Supabase, cross-device, physical iPad/Safari or installation/update verification. INSTALL_EASY still required/unimplemented; external teacher setup steps reduced0. No push/deploy/remote migration/secret or student-data changes.

## 2026-09-13 — Phase 5E TEST fixture·E2E runner 준비

- Start HEAD `622eb7afde878e41bdbe1ba780de56ce1a4ee6a9`, branch `feature/spatial-math-redesign-v1`; existing dirty worktree and student data preserved. No reset/clean/push/deploy/remote migration or production access.
- Added `scripts/phase5b-runner.ts`: TEST target/ref guard, TEST marker fixture reuse path, safe redaction, explicit cleanup guard, fail-fast pipeline, remote teacher/student API flow, and local `Phase5ApiStore` mock scenarios for 9~12차시.
- Added F01–F08 in `tests/phase5-runner.test.ts`; `npm run qa:phase5e:mock` produced a redacted gitignored runtime artifact. Updated `run-phase5b-test.mjs` so fixture/E2E modes require `--apply` plus `APPLY_TO_TEST`, and dry-run checks `runner=PASS`.
- `npm test` 139 PASS, `npm run typecheck`, `npm run lint`, `npm run typecheck:edge`, `npm run test:security`, `npm run build`, `npm run qa:phase5c:dry-run`, `npm run qa:phase5e:mock` PASS on this working tree.
- Actual TEST migration/function deploy/fixture creation/remote E2E were not run. `qa/redesign-phase5/PHASE5E_RUNNER_REPORT.md` is `READY_FOR_MAC_REMOTE_RUN`; this indicates runner readiness only, not live Supabase success. Mac command and credential handling are documented in `PHASE5B_MAC_RUNBOOK.md`.

## 2026-09-13 — Phase 5B CLI resolution

- `run-phase5b-test.mjs` now resolves Supabase CLI in order: project `node_modules/.bin/supabase`, `npx --no-install supabase`, then global `supabase`; otherwise it emits `SUPABASE_CLI_MISSING`. No package download is permitted.
- Added a source contract test for this priority. `npm run qa:phase5c:dry-run` and `npm run qa:phase5e:mock` remain PASS.
- In this sandbox, `npx supabase --version` reached the installed CLI but exited because it could not write `/Users/kimnana/.supabase/telemetry.json`; no migration, deploy, or remote write occurred.

## 2026-09-13 — Phase 5B TEST IPv4 link preparation

- TEST schema execution now links only the temporary CLI workspace with the guarded TEST ref before `db push`; the main repository's `supabase/.temp/linked-project.json` is snapshotted and checked unchanged.
- Link failure emits `TEST_LINK_FAILED` and prevents `db push`; dry-run prints `TEST LINK PLAN: READY` without linking.
- Added source contract coverage for link ordering, production-link immutability, and failure gating. Latest local suite: 141 PASS; typecheck and lint PASS; `qa:phase5c:dry-run` and `qa:phase5e:mock` PASS.
- Remote link, migration, deploy, and data writes were not run in this environment.

## 2026-09-13 — Phase 5B TEST API failure diagnostics

- `scripts/phase5b-runner.ts` now reports the first remote failure as `REMOTE_API_FAILED` with stage, function, method, status, content type, safe error code/message; tokens, PINs, passwords, and secrets are redacted.
- Added harmless `OPTIONS` probe for `student-auth`/`student-api` (`npm run qa:phase5b:probe`) and F09-style coverage for 401/403/404/500/network/malformed responses. No fixture or E2E rerun was performed.
- Latest targeted tests, typecheck, lint, dry-run, and mock runner PASS. Live function deployment/secret status remains unverified from this environment.

## 2026-09-13 — Phase 5B TEST teacher-api 500 diagnosis

- Current source confirms the fixture's first teacher request is `teacher:classes` (`POST /functions/v1/student-api`, bearer Auth access token); if the marker class is absent, `teacher:class-upsert` is the next request. The route calls `requireTeacher` then a service-role `sb_classes` select filtered by `teacher_id`; it does not require an app teacher profile or `APP_SESSION_SECRET`.
- Current source's normal configuration/auth/database failures return structured JSON (`CONFIG`, `TEACHER_AUTH`, or route-specific errors). The reported blank `text/plain` HTTP 500 therefore does not match this source's handled paths and is not sufficient to claim a DB/RLS or credential root cause; deployed function version or an uncaught runtime exception remains unconfirmed pending TEST invocation logs.
- Runner diagnostics now include the non-sensitive request action in `REMOTE_API_FAILED` output. Fixture/E2E were not rerun; no remote writes, migration, deployment, or production access occurred. Local unit suite 142 PASS, typecheck and lint PASS.
- Supabase documentation confirms production Edge Function invocation/custom logs are inspected in Dashboard → Functions → select function → Invocations/Logs; the CLI does not query ClickHouse function logs. Secret names can be listed with `supabase secrets list --project-ref <TEST_REF>` on the operator Mac without printing values. See official [Supabase function logging](https://supabase.com/docs/guides/functions/logging) and [CLI secrets reference](https://supabase.com/docs/reference/cli/v0/supabase-gen-types-typescript).

## 2026-09-13 — Phase 5B partial fixture PIN recovery (local only)

- Existing marker students now reuse a known four-digit `pinPlain`; when the teacher list cannot return it, the runner calls the existing `teacher:students:pin-reset` action with the existing student ID. Non-marker rows are rejected, reset output is held only in process memory, and no PIN is printed or written to artifacts.
- New marker rows still use `teacher:students:create`. Repeated runs do not rotate a PIN once one was acquired in the same fixture flow. Student IDs remain unchanged on recovery. The current APP_SESSION_SECRET is used by the deployed reset/hash path; no secret value was read or changed here.
- Remote fixture output now reports only `class/studentN=EXISTS|MISSING` and `studentN PIN=READY`; no PIN digits, rows, IDs, or credentials are emitted.
- Added R01–R10 local contract tests. `npm test` 152 PASS; typecheck and lint PASS. Remote fixture/E2E, migration, deployment, and production access remain NOT_RUN.

## 2026-09-13 — Phase 5B new-student PIN response recovery

- Confirmed source-level root cause: `teacher:students:create` returns `{ student: {...}, pinPlain }`, while the runner previously read `student.pinPlain`; the new student path therefore discarded a valid top-level PIN.
- Fixed only the runner parser. New students now parse top-level `pinPlain`, immediately call `student-auth`, verify the returned student ID, and only then report `studentN PIN=READY`. Existing marker students use the existing ID and the normal `teacher:students:pin-reset` action when their PIN is unavailable.
- `RemoteContext` keeps the verified session token in process memory for the same run; no plaintext PIN is written to console, report, artifact, or Git. No `student-api` source change, migration, deploy, or remote fixture rerun was performed.
- Added N01–N10 contract coverage. `npm test` 162 PASS; `npm run typecheck`, `npm run lint`, and `npm run typecheck:edge` PASS. Live TEST state and student2 creation status remain unverified until the operator reruns the fixture.

## 2026-09-13 — Phase 5B remote result: project assertion contract diagnosis

- Preserved artifact `qa/redesign-phase5/runtime/PHASE5B_REMOTE_RESULT.json` (generated 2026-09-13T06:34:50.339Z): peer publish/list, peer grade, and teacher hide PASS; the first failure was the 12×12 project persistence check. The artifact records no HTTP failure details, so later progress, reflection, and security checks are NOT_RUN.
- Traced the failing path: `runRemotePhase5` sends two `project:save` requests through `student-api`; the second response is returned by `student-api` as the request-normalized `projectData`, whose fields are `grid_width/grid_depth/max_height`. The runner incorrectly asserted `expanded.project.gridWidth`, so the response reached the assertion and was reported as `REMOTE_PROJECT` failure. This response echo does not by itself prove the database row; the applied `sb_save_building` migration also clamps requested width/depth to 10, which is a separate remote persistence contract still requiring verification and was not changed here.
- Fixed only the local runner contract with `readRemoteProjectGridWidth`, and added N11 to lock the snake_case response contract. No server function, migration, remote data, fixture, deployment, or production target was changed. Remote E2E was not rerun.
- Current local checks after the fix: `npm test` 163 PASS, `npm run typecheck` PASS, `npm run lint` PASS, `npm run typecheck:edge` PASS. The saved artifact remains the evidence for the prior run; live TEST revalidation is pending.

## 2026-09-13 — Phase 5B latest remote result: idempotent project recovery

- Latest preserved artifact (`generatedAt` 2026-09-13T06:45:01.157Z) keeps `peer_publish_list`, `peer_grade`, and `teacher_hide` PASS, then fails on the first project save with `REMOTE_API_FAILED`, status 409, `PROJECT_VERSION_CONFLICT`, action `project:save`. No 10×10/12×12 assertion or reload ran; progress, reflection, and security checks remain NOT_RUN.
- The first save used the default `expectedVersion=0`. The previous remote run had already created the TEST marker student's project, so `sb_save_building` correctly rejected the stale version. This is a runner idempotency/state-recovery defect, not an authorization or database outage.
- The runner now reads `project:load`, reuses the existing marker project's version, and refuses to overwrite a non-marker project. Added N12–N13 regression coverage. No remote E2E, fixture, migration, deployment, or production change was performed.
- The artifact does not contain persisted grid dimensions. The later 12×12 assertion is therefore NOT_REACHED; the applied RPC source still clamps width/depth to 10, so actual 12×12 DB persistence remains a separate unverified implementation issue.
- Local verification after this change: `npm test` 165 PASS, `npm run typecheck` PASS, `npm run lint` PASS, and `npm run typecheck:edge` PASS.

## 2026-09-13 — Phase 6 browser integration gate

- Start/finish HEAD `622eb7afde878e41bdbe1ba780de56ce1a4ee6a9`, branch `feature/spatial-math-redesign-v1`; existing dirty worktree and all student/TEST data were preserved.
- Phase 5 TEST artifact `qa/redesign-phase5/runtime/PHASE5B_REMOTE_RESULT.json` was read as prior remote API evidence: all 9 recorded checks PASS. It was not counted as Phase 6 browser evidence.
- Ran `npm run qa:local` once. The production build completed, then the preview preflight stopped at `listen EPERM: operation not permitted 127.0.0.1`; browser execution 0, PASS 0, FAIL 0, BLOCKED 1. The run is `UI_WITH_TEST_DATA`, not LIVE_SUPABASE.
- A single escalated browser retry was rejected by the automatic approval review usage limit. No approval bypass or repeated retry was attempted.
- On this working tree, `npm test` (165), `npm run typecheck`, `npm run lint`, `npm run build`, `npm run typecheck:edge`, `npm run test:security`, `npm run audit:problems`, and `npm run audit:presentation` PASS. These do not replace browser verification.
- No fixture, remote E2E, migration, deploy, push, production access, or production data change was performed. Full Phase 6 report: `qa/redesign-phase6/PHASE6_BROWSER_REPORT.md` (`PHASE 6 RESULT: BLOCKED`).

## 2026-09-13 — Phase 7 teacher setup wizard

- Start HEAD `622eb7afde878e41bdbe1ba780de56ce1a4ee6a9`, branch `feature/spatial-math-redesign-v1`; existing dirty worktree and student/TEST data preserved.
- Extended the existing `/setup` route into an eight-step teacher wizard: start/resume, Supabase preparation, URL + Publishable key connection check, honest management-install status, teacher Auth login, class selection/creation, bulk student creation, student login smoke and class link copy.
- Added `src/lib/installer.ts` for installation-scoped resumable progress. Only installation ID, step and class metadata are stored; teacher passwords, PINs and access tokens are not persisted. Added two unit tests in `tests/installer.test.ts`.
- The static app does not receive management tokens or service_role. Migration, Edge Function deployment and APP_SESSION_SECRET setup remain explicitly unavailable until a separately approved secure management runner exists; the wizard does not claim them complete.
- `KOREAN_CHATBOT_REFERENCE: NOT_FOUND` in the local repositories; no external project was copied.
- Verification on this working tree: `npm test` 167 PASS, `npm run typecheck` PASS, `npm run lint` PASS, `npm run build` PASS, `npm run typecheck:edge` PASS, `npm run test:security` PASS, `npm run audit:problems` PASS, `npm run audit:presentation` PASS. Actual installer Chromium and new/upgrade TEST Supabase E2E remain BLOCKED/NOT_RUN.
- No push, production deploy, remote migration, production data change, or external resource creation.

## 2026-09-13 — Phase 7B 설치 실행부 로컬 구현

- Start HEAD `622eb7afde878e41bdbe1ba780de56ce1a4ee6a9`, branch `feature/spatial-math-redesign-v1`; 기존 dirty worktree·학생/TEST 데이터 보존. reset/clean/push/deploy/remote migration 없음.
- `scripts/installer/contract.ts`, `security.ts`, `management-api.ts`, `orchestrator.ts`, `fake-backend.ts`를 추가했다. 이 경로는 `src/`에 import하지 않아 정적 Vite bundle에 포함되지 않는다.
- Management API adapter는 프로젝트 ref 확인, migration 적용, Secret 이름 조회/누락 시 설정, 함수 hash 비교·배포, OPTIONS probe를 지원한다. `EphemeralCredential`은 서버/CLI 경계에서만 사용하고 폐기 후 재사용을 차단한다. URL/ref production guard와 안전한 오류/redaction을 포함한다.
- `qa:installer:mock`와 B01~B25 로컬 계약 검사를 추가했다. 누락 migration 계산·부분 재개·Secret 보존·함수 skip/deploy/probe·대상 mismatch·credential disposal을 확인한다. 합성 결과는 LIVE Supabase 성공으로 집계하지 않는다.
- 실제 OAuth 앱/installer backend 배포, TEST status/repair, migration/function/Secret 원격 작업, QR encoder, 빈 프로젝트 E2E는 승인·실행 장소·비용 미확정으로 NOT_RUN/BLOCKED. 교사 외부 수동 작업 감소는 0개.
- `qa/installer/INSTALLER_REPORT.md`, `CURRENT_REQUIREMENTS.md`, `DISTRIBUTION_ARCHITECTURE.md`에 Phase 7B 구현/한계/승인 조건을 반영했다.
- OAuth authorization URL·state·S256 PKCE·일회성 callback 소비·만료·단기 token exchange 계약(`scripts/installer/oauth.ts`)과 공개 Setup 소스의 privileged import 차단 검사를 추가했다. Supabase migration Management API가 선택된 partner OAuth 앱 전용이라는 공식 조건을 확인해 일반 OAuth만으로 자동 migration을 보장하지 않도록 보고했다.
- 최신 `npm test`: 194/194 PASS. `npm run qa:installer:mock`, typecheck, lint, build, typecheck:edge, test:security, audit:problems, audit:presentation 모두 PASS. 실제 TEST remote installer, OAuth 앱 등록, migration/function/Secret 변경, QR 생성, browser installer E2E는 실행하지 않음.

## 2026-09-13 — Phase 7B 공개 installer client 연결

- `src/lib/installerClient.ts`를 추가해 `/setup`이 관리 토큰 없이 HttpOnly 설치 세션 기반의 상태·계획·설치·복구·업데이트·철회 API를 호출할 수 있는 공개 계약을 마련했다. `VITE_INSTALLER_API_URL`이 명시된 경우에만 4단계에서 상태를 읽고, 없으면 기존의 관리 실행부 연결 필요 안내를 유지한다.
- client는 HTTPS endpoint만 허용하고 `Authorization` 헤더·Secret·비밀번호·PIN을 전송하지 않는다. 실제 installer backend는 여전히 배포하지 않았으며 원격 호출은 실행하지 않았다.
- `tests/installer-client.test.ts`에 HttpOnly 요청, 공개 target payload, 오류 redaction, endpoint guard를 추가했다.
- 최종 로컬 검사: `npm test` 198/198, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run typecheck:edge`, `npm run test:security`, `npm run audit:problems`, `npm run audit:presentation`, `npm run qa:installer:mock` 모두 PASS. 브라우저·Management API·원격 변경은 실행하지 않았다.

## 2026-09-13 — Phase 7C Easy Setup 공통 계약 정리

- 면담실 참고 소스는 현재 로컬 작업 공간과 이 환경의 원격 조회에서 확인하지 못해 `qa/installer/AI_INTERVIEW_EASY_SETUP_REFERENCE.md`에 `NOT_FOUND`로 기록했다. 확인하지 못한 Worker·Durable Object·AI 전용 구현은 수학 앱에 복사하지 않았다.
- `scripts/installer/math-manifest.ts`에 `stacking-blocks-math` 전용 manifest를 추가했다. 001~017 migration source, `student-auth`·`student-api`, `APP_SESSION_SECRET`, 두 OPTIONS probe만 선언하고 AI capability는 비워 두었다.
- 공개 `installerClient`에 OAuth authorize 시작, 세션 생성, 일회성 PAT fallback 전달, 설치 세션 철회 경로를 추가했다. PAT는 클라이언트 저장·로그·URL에 남기지 않는 요청 계약으로만 지원한다. `/setup`은 명시적인 `VITE_INSTALLER_API_URL`이 있을 때만 OAuth 연결 버튼과 원격 상태 조회를 활성화한다.
- 비교표: `qa/installer/EASY_SETUP_COMPARISON.md`. 실제 OAuth 앱·backend 배포·TEST status/repair·원격 설치는 실행하지 않았다.
- 최종 `npm test` 201/201 PASS, typecheck·lint·build·Edge·보안·문제/프레젠테이션 감사·installer mock PASS.

## 2026-09-13 — Phase 7C HTTP 실행부 및 Easy Setup 통합

- OAuth 우선 공개 client와 앱별 수학 manifest를 유지하면서, `scripts/installer/http-server.ts`에 `/api/installer/session`, `/credential`, `/status`, `/plan`, `/install`, `/repair`, `/update`, `/session DELETE` 로컬 HTTP 실행부를 추가했다. PAT는 HttpOnly 세션의 메모리 credential로만 받고, 완료·철회·만료 때 폐기한다.
- HTTP 실행부는 project ref/URL guard, origin allowlist, 15분 기본 TTL, 단계별 오케스트레이터 재개, 완료 후 PAT 폐기를 포함한다. 실제 Management API/PAT/OAuth 연결은 실행하지 않았다.
- 면담실 Easy Setup 참고 코드는 로컬/원격에서 확인하지 못해 조사·비교 문서에 `NOT_FOUND`로 기록했다. AI 전용 기능을 수학 설치에 추가하지 않았다.
- HTTP 통합 테스트 2개는 이 샌드박스의 localhost listen EPERM으로 SKIPPED/BLOCKED이며, 나머지 테스트와 정적 검사는 통과했다. 최종 `npm test`: 204개 중 202 PASS, 2 SKIPPED.
- Phase 7D 배포 게이트: `/health` 및 HTTP installer 경로는 로컬 실행부로만 준비했다. 실제 TEST backend 배포·PAT status/repair/update·`/setup` 원격 연결·QR 구현은 외부 실행 환경 승인 전 NOT_RUN/NOT_IMPLEMENTED이다. 최종 `npm test`: 205개 중 203 PASS, 2 SKIPPED(환경 EPERM).

## 2026-09-13 — Phase 7E TEST installer backend 배포 준비

- 시작/최종 HEAD `622eb7afde878e41bdbe1ba780de56ce1a4ee6a9`, 브랜치 `feature/spatial-math-redesign-v1`; 기존 dirty worktree·학생/TEST 데이터 보존. push/deploy/remote migration/외부 자원 생성 없음.
- `scripts/installer/runtime.ts`, `scripts/installer/start.ts`를 추가해 TEST 전용 Node HTTPS 호스트에 올릴 수 있는 실행 진입점과 환경변수 guard를 마련했다. `INSTALLER_MODE=TEST`, 허용 TEST ref/origin, 운영 ref 차단, 세션 Secret 길이, 포트를 시작 전에 검증한다.
- `http-server.ts`는 서명된 HttpOnly·SameSite=Strict cookie와 `NO_CHANGES`/`UP_TO_DATE` read-only maintenance 결과를 지원한다. 설치가 필요한 상태에서만 기존 오케스트레이터가 실행된다.
- `scripts/installer/qa-remote.ts` 및 `npm run qa:installer:remote`는 TEST 환경변수의 PAT로 health→session→status→plan→repair→update→revoke를 검사하고, ref hash·안전한 상태 요약만 gitignored artifact에 저장한다. 원격 실행은 하지 않았다.
- `.env.installer.example`을 추가했고 production secret/PAT는 포함하지 않았다. QR encoder는 이번에도 구현하지 않아 NOT_IMPLEMENTED로 유지한다.

## 2026-09-24 — 학습지로 문제 만들기 UI 제거 + Teacher Page Expansion Phase 4

- worksheet import UI removed: `WorksheetImportPage.tsx`, `src/features/worksheet/`, `App.tsx`의 lazy import·`/teacher/worksheet-import` route, `TeacherPage.tsx`의 관련 버튼/nav 링크를 제거했다. `sb_worksheet_imports` 테이블, RLS 정책, `sb-worksheets`/`sb-problem-images` Storage 버킷, 관련 migration은 전혀 건드리지 않았다(데이터 보존/롤백 가능성 유지). `sb-problem-images`는 student-api의 일반 문제 이미지 표시에도 쓰이므로 별도로 확인 후 유지했다.
- 현재 로컬 검사: `npm test` 207개 중 205 PASS, 2 SKIPPED(localhost listen EPERM), typecheck/lint/build/Edge/security/audit/mock PASS. 실제 HTTPS backend, TEST status/plan/repair/update, SetupPage remote, QR, 신규 설치 E2E는 NOT_RUN/BLOCKED. 교사 외부 수동 작업 감소 0개.
