# MVP 작업 기록

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
- `npm test` PASS (19개)
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
- 현재 연결값은 Vite `VITE_*` 환경변수 단계까지이며, 특정 교사 값을 공통 dist에 고정하지 않는 런타임 설치 설정은 향후 설치 도우미 범위로 남겼다.

## 런타임 설치 설정 (2026-09-11)
- `src/lib/config.ts`에 공개 `RuntimeSupabaseConfig`(installationId, Supabase URL, Publishable Key) 저장·검증·URL fragment(`/#install=`) 인코딩/복원 계층을 추가했다. service_role/secret/password 이름이 포함된 값과 안전하지 않은 URL은 거부한다.
- 연결 우선순위는 런타임 localStorage 설정 → 개발/테스트의 Vite fallback → 미설정이다. production에서 Vite 값만으로 연결하지 않으며, 설정이 없으면 `/setup`으로 이동한다.
- `getSupabase()`와 학생 Edge Function 호출이 매번 현재 런타임 설정을 해석하고, 설치가 바뀌면 Supabase client cache도 교체한다. 특정 교사 URL/키를 소스에 하드코딩하지 않는다.
- `/setup`은 `/auth/v1/settings`만 호출해 연결을 확인한 뒤 공개 설정을 저장한다. DB migration·Storage 생성·교사 인증을 자동 수행하지 않는다.
- 설정 fragment round-trip 및 secret/unsafe URL 거부 테스트를 추가했다.
