# Browser E2E & Lesson 9 Integration: PARTIAL

검증일: 2026-09-19 (브라우저 12:55:55 UTC). 시작 HEAD d67f81a9c061346023b8c99d7bc05ddd947a9e3b. 검증 코드 HEAD a6f2d40c97aa434ed5d2c690224acaeef81ab82d. 이후 변경은 보고서와 별도 CI Node 버전 정합성만 해당한다.

## 실행 결과

- [CI 실행](https://github.com/rlasksk030/classgame/actions/runs/35444229628): production build + Chromium **19 PASS / 0 FAIL / 0 SKIP / 0 flaky**. 17 동작 검사 + 2 기존 screenshot smoke (전체 학습 검증으로 세지 않음).
- npm test: 256 중 254 PASS / 2 기존 HTTP 환경 SKIP / 0 FAIL. 로컬 및 CI. 누락된 skip을 성공으로 계산하지 않았다.
- typecheck, lint, typecheck:edge, test:security, verify-seed, build: 같은 commit의 CI PASS.
- 합성 API 인증과 실제 activityRequest + PGlite PostgreSQL migration/RPC를 결합. 문제 채점은 실제 grade/applyAttempt; 무조건 정답 mock 없음. 테스트 context는 localhost 외 원격 통신 차단, 명시적 .invalid API만 Playwright 응답.
- 범위: UI_WITH_TEST_DATA / LOCAL_LOGIC. LIVE_SUPABASE: NOT_RUN. 실제 iPad/Safari: NOT_RUN.
- 로컬 Vite 최초 EPERM; 허용된 실행 후 document 로딩 timeout, 로컬 tsc/lint 파일 읽기 정체도 확인. 같은 시도 반복 대신 기존 승인된 GitHub Actions 사용. production 서버에 접속하지 않았다.

## 기존 27 실패

[테스트별 분류](FAILURE_CLASSIFICATION.md). 이전 47개와 새 19개는 서로 다른 suite여서 단순 감소율을 제시하지 않는다.

- 기존 mixed: 5 PASS / 27 FAIL / 15 NOT_RUN.
- live: 기존 14 + 새 핵심 5 = 19 PASS.
- redesign: 33개 기존 검사를 별도 설정으로 분리. 테스트 삭제/skip 없음. 이번 실제 재실행 NOT_RUN. 출력 경로 전달 수정, 기존 Phase4를 redesign 전용 설정에도 포함.
- Node20 별도 CI는 strip-types 옵션을 지원하지 않아 실패. 기존 주 CI와 동일 Node24로 정합성 수정 (브라우저 실패와 별개).

## 9차시 실제 연결

StudentWorld → /lesson/9/learn → /lesson/9 → PeerChallengePage → activityApi → student-api activityRequest.

Learn 버튼이 일반 solve 페이지로 가던 경로 오류를 수정했다. 새 공개 목록은 친구 미풀이 우선, 미풀이 친구 문제 3개 미만이면 기존 검증 bank 24개를 보충한다. 시스템 문제는 ‘기본 연습’으로 표시하며 가짜 제작자를 넣지 않는다. 완료 항목은 뒤로 정렬하여 같은 첫 과제의 반복을 줄인다. 목록을 임의 자동 시작하지 않는다.

학급별 deterministic ID로 중복 upsert를 막고 저장된 내용으로 목록/채점을 일치시킨다. 기존 공유 코드 방식과 학생 제작 문제는 유지한다. 현 라이브 ACTIVITY_GRID(5×5×3) 계약을 유지했으며 bank의 3×3 footprint 밖은 빈 투영이다. redesign으로 라우팅을 전환하지 않았다.

공개 list/get에는 answer, blocks, hidden_validation_json, 비공개 hint가 없다. 힌트는 명시적으로 연 뒤 공개, 정상 오답 피드백의 정답 공개 단계에서만 revealedAnswer가 허용된다. 이는 모든 단계에서 정답 데이터를 절대 반환하지 않는 정책과는 구분된다.

채점: 원본과 다른 유효 입체 허용; 힌트 공개 후 힌트 조건도 적용. 기존 첫 INSERT의 score 누락을 새 SQL 함수에서 수정. 학생 row 잠금/이전 hint 상태 검증으로 완료와 보상을 1회로 유지. 성공 후 힌트 열기로 기존 점수 변경하지 않음. 놀이 점수 2/1은 XP와 분리한다.

## 핵심 실제 조작

| 흐름 | 결과 | 증거/범위 |
|---|---|---|
| 로그인→월드→Learn→Solve→정답→다음 | PASS | live-flow P0; 실제 입력/클릭 |
| 로그아웃/재로그인→문항 위치/완료 복원 | PASS | live-progress.png; 학생 B는 분리 |
| 9차시 기본 24개→10개 쌓기→제출2점→재조회 | PASS | live-lesson9.png; 실제 버튼 배치, DB score 확인 |
| A 제작/게시→독립 B context 목록/힌트/풀이1점 | PASS | live-peer-solve.png; 공동 로컬 SQL |
| 마우스 드래그/Chromium touch drag/탭 | PASS | 기존 block-world 3개; 블록 배열 직접 주입 없음 |
| Undo/Redo/저장/새로고침/오프라인 재동기화 | PASS | babylon-desktop.png |
| 3차시 격자 입력→canonical payload | PASS | 화면 첫 행 = 저장 마지막 행 |
| 10차시 저장→11차시 같은 row 복원 | PASS | live-lesson11.png; 제목, 10×10, 블록 SQL 확인 |
| 12차시 숫자 채점/자기평가 저장 | PASS | live-flow; 실제 grade 및 SQL 저장 |
| 12차시 공통6+맞춤4 라이브 연결 | NOT_VERIFIED | 기존 redesign 요구. 이번 live 검사로 완료 선언하지 않음 |

5개 캡처를 직접 열어 검토했다. 9차시 완료 재조회에서 점수는 복원되지만 풀이 블록은 빈 작업판으로 표시되는 기존 계약도 확인했다. 풀이 과정 전체 복원으로 보고하지 않는다. 11차시 전체 소개서/PDF 품질을 이 저장 검사 하나로 완료 처리하지 않는다.

## API/보안

실제 handler와 PostgreSQL 검사: list private field 미노출, 인증 없음401, 자기 문제403, 다른 학급404, 잠금403, 클라이언트 score/is_correct 무시, 중복 완료 보상 없음, 학생별 hint/점수 격리, 친구 충분하면 system fallback 생략. 기존 RLS/anon 검사 및 새 service_role 전용 RPC 권한 유지. 다른 설치는 각 Supabase DB에 격리하는 구조이며 실제 별도 설치 원격 E2E는 NOT_RUN.

## 원격 반영 필요 범위 (미실행)

1. 새 additive `20260919123152_lesson9_system_bank.sql`: source, nullable system author, v2 scoring RPC. 기존 migration/학생/답안은 수정·삭제하지 않음.
2. student-api (_shared/activities.ts 및 challenge-bank.ts 의존). student-auth 변경/배포 불필요.
3. 정적 frontend (9차시 route/list).

DB → student-api → frontend 순서 필요. 새 목록/RPC를 쓰는 API를 DB보다 먼저 배포하면 실패한다. 새 system 행은 기존 코드를 완전히 이해하지 못하므로 무조건 옛 API로 되돌리는 것은 검증되지 않았다. 먼저 UI 노출을 중단하고 데이터는 보존해야 한다. installer manifest의 schema version/기존 TEST runner 적용 범위는 새 migration 반영 전 별도로 맞춰야 한다. 이번에 installer/운영을 자동 갱신하지 않았다.

TEST Supabase migration/함수 배포 및 원격 API 확인은 이번 실행에서 하지 않았다. 현재 성공은 배포 전 합성 UI/로컬 SQL 게이트다.

## 보존·후속

원래 미추적 qa/overnight-20260913/{phase1b/html,phase2-final/html,phase2,preserved.diff}, qa/redesign-phase5는 그대로 보존. oracle/문제은행 재작성 없음. main/production/deploy/원격 데이터 변경 없음. feature push만 수행.

다음: 새 additive schema/API의 TEST 적용과 실제 인증/권한/재로그인 E2E, 별도 redesign suite의 남은 오래된 기대값 검증, live12 맞춤 흐름, 9차시 풀이 블록 복원 정책, 실제 Safari/iPad. WebGL context lost를 이번 Chromium 성공으로 해결했다고 간주하지 않는다.
