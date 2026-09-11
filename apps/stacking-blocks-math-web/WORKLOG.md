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
- 실DB에서 교사·서버의 테이블 사용 권한 누락 발견. 009 추가, 테스트 임의 grant 제거 후 검증. 실제009 적용과 student-api legacy JWT 설정 변경은 자동 승인 검토 거부로 보류. APP_SESSION_SECRET/교사 계정 미설정.
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
