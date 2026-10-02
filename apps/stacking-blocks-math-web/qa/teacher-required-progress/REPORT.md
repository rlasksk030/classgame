# 교사관리 필수 진행 0/12 조사·수정 (2026-10-02)

## 원인과 지표의 의미

`0/12`는 **완료한 필수 학습 차시 / 전체 12차시**다. 문제 12개를 세는 지표가 아니다.
일반 차시(1~8, 12)의 학생 `/solve` 화면은 활성·학급 공개 문항 중 `order_index=2`인 `check` 문제를 모두 풀면 필수 완료로 판단한다.
그러나 기존 `sb_record_attempt`는 해당 차시의 모든 활성 문제를 분모에 넣었다. 안내용 개념 문제, 선택 연습, 다른 학생의 생성 문제와 이전 연습 세트까지 포함되어 필수 문제를 맞혀도 `sb_student_progress.completed=false`가 남았다.
교사 요약은 이 값을 그대로 읽었다. 별도로 교사 화면의 10초 갱신과 “상태 새로고침”은 접속 현황만 갱신하고 진도는 갱신하지 않았다.

9차시는 친구/기본 놀이 문제 완료, 10~11차시는 건축물 소개서 제출이라는 기존 활동 완료 규칙을 유지한다. 일반 필수 문항 9개와 활동 차시 3개를 합쳐 전체 12차시다. 한 차시에 교사가 필수 문항을 추가했다면 모두 완료해야 해당 차시 1개로 집계한다.

## 수정 전 조사한 구조

앱 루트: `/Users/kimnana/Documents/codex/classgame/apps/stacking-blocks-math-web`
Git 루트: `/Users/kimnana/Documents/codex/classgame`
시작 브랜치/HEAD: `feature/spatial-math-redesign-v1` / `2db59cd`.
기존 추적 파일 수정 없음. 추적되지 않은 QA HTML, 과거 diff, 배포자료는 보존했다.
`AGENTS.md`, `CURRENT_REQUIREMENTS.md`, `QUALITY_GATE.md`, `README.md`, `SUPABASE_SETUP.md`, QA/설치·배포 문서 및 관련 history를 읽었다.

| 구간 | 파일 · 함수/동작 | 실제 데이터 |
|---|---|---|
| 학생 입장 | `src/pages/StudentLogin.tsx` `submit`, `src/lib/studentApi.ts` `loginStudent`, `supabase/functions/student-auth/index.ts` | 학급 코드·이름·PIN → 학생/학급 ID가 있는 서버 검증 세션 |
| 문제 시작·단계 복원 | `src/pages/LessonPage.tsx`, `student-api/index.ts` `lessonProblems`, `parseProblemRow` | `order_index<=1`: concept, `=2`: check, `>2`: more. `practice_seed`, `guided_completed`, `last_problem_id` |
| 답안 임시 보관 | `LessonPage.tsx`, `src/lib/studentApi.ts` | 브라우저의 학생·설치·문제별 임시 답안/위치, snapshot/position API. 임시 보관만으로 완료 처리하지 않음 |
| 제출 | `LessonPage.tsx` `submit` → `submitAttempt` | POST `/functions/v1/student-api`, `action=attempt`, `problemId`, `submission`, `x-student-token` |
| 채점·완료 사실 생성 | `student-api/index.ts` attempt, `shared/grading.ts` `grade`, `shared/attempts.ts` `applyAttempt` | 서버 채점 → `completed`, `wrongCount`, 힌트/공개 상태, XP/별 |
| 실제 저장 | `sb_record_attempt` RPC | `sb_problem_attempts`의 `(student_id,problem_id)` 유일 행, `sb_student_progress`의 `(student_id,lesson)` 행; 같은 트랜잭션으로 보상·스냅샷 저장 |
| 교사 인증·학급 경계 | `student-api/index.ts` `requireTeacher`, `teacherOwnsClass` | 교사 Auth 확인 → 소유 학급 학생 ID 조회 → 해당 학생들만 집계 |
| 교사 진도 조회 | `teacher:progress:summary`, `shared/teacherProgress.ts` `summarizeStudentProgress` | 학생별 저장된 시도와 활성 필수 문항 대조. 활동 차시만 기존 차시 완료값 사용 |
| 화면 분자/분모 | `src/pages/TeacherPage.tsx` 학생 진도 표 | 응답의 `requiredProgress.completedLessons` / `totalLessons`(12) 그대로 표시 |
| 자동/수동 갱신 | `TeacherPage.tsx` `loadProgress` | 진도 전용 10초 갱신, 수동 새로고침. 실패 시 마지막 정상값 보존·오류 표시 |

실제 흐름:

```text
학생 답 제출 → 서버 채점·완료 판정 → sb_record_attempt
→ sb_problem_attempts + sb_student_progress 저장
→ 소유 학급/학생을 한정한 teacher:progress:summary
→ 저장된 완료 문제 ID와 필수 문제 ID 대조 → 완료 차시 수/12
```

필수 플래그를 브라우저에서 신뢰하여 전달하지 않는다. 서버 문항의 `order_index`로 단계를 판별한다.
학생 세션은 학생·학급을 인증하는 수단이며, 진도 저장 키는 세션 ID가 아닌 영속적인 학생 ID다. 로그아웃/다른 세션에서도 같은 학생 기록을 읽는다.

## 증거와 한계

- 기존 SQL `202609110004_atomic_attempts.sql` 34~39행의 모든 문제 집계와 학생의 `requiredSolveIds(stage=check)` 판정 불일치를 확인했다.
- 해당 SQL은 최초 저장 기반 커밋 `1bc0895`에서 유래한다. 학생 필수 단계 분리는 `896b99f`, 교사 진도 집계는 `e1f983e`에 존재한다. 최근 새 기기 교사 연결 수정과 별개다.
- 문서에 연결된 Supabase 프로젝트를 읽기 전용 조사했다. 완료된 시도 16건, 차시 진도 9행 중 완료 0행, 필수 완료인데 차시 미완료인 사례 2건을 익명 집계로 확인했다. 활성 문제 수는 차시당 17~37개이며 필수 check는 각 1개였다.
- 이 문서 연결 프로젝트의 Edge Function은 오래된 v4이고 `teacher:progress:summary`가 없다. 따라서 이 원격 증거는 동일 저장 결함의 실재를 확인하는 자료이며, 제보한 교사의 설치/학급을 특정해 검증했다는 뜻은 아니다.
- 관련 테이블 RLS 활성화, 시도/차시 복합 키, RPC의 service_role 전용 실행 권한을 확인했다. 학생 insert/update 권한을 넓히는 변경은 없다.
- 수정 전 실제 PostgreSQL 회귀 테스트 4개가 실패했다(`expected 1, actual 0` 포함). 교사 갱신 회귀 검사도 수정 전에 실패했다.

## 수정 원칙

- 기존 migration은 수정하지 않고 `20261002085049_required_lesson_completion.sql`을 추가했다. 새 SQL은 RPC 정의와 기존 실행권한을 보존한 권한 명시만 포함하며 기존 행 일괄 갱신/삭제가 없다.
- 앞으로의 답 제출은 활성·학급 공개 필수 문항만 완료 분모에 넣는다. 선택 문제 보상, 동시 제출 보호, 학생 잠금, 완료 시도 중복 방지를 유지한다.
- 과거의 잘못된 차시 완료값은 저장된 풀이를 조회할 때 다시 판정한다. 학생 home, 교사 진도/수업 결과의 기준을 맞추며 조회 과정에서 학생 기록을 쓰지 않는다.
- 선택 연습은 실제 선택 단계의 완료 문항으로 집계한다. 필수 완료를 선택 연습 완료로 부풀리지 않는다.
- 학급 전체 시도는 페이지를 나누어 조회하므로 API의 1,000행 제한으로 뒤쪽 학생 기록이 누락되지 않게 한다.
- 진도 자동 갱신은 접속 상태와 별도 오류 상태를 유지하고, 학급 전환/동시 요청의 오래된 응답을 무시한다.

## 검증 결과

| 시나리오 | 결과 · 확인 방법 |
|---|---|
| 최초 0 → 필수 1 → 필수 3 → 전체 12차시 | PASS. 실제 채점·시도 상태 기계·PostgreSQL RPC로 저장 후 교사 집계. 활동 9~11차시는 실제 활동 RPC 사용 |
| 학생 화면에서 필수 문제 직접 제출 | PASS. 독립 학생/교사 브라우저에서 0/12 → 1/12 자동 갱신 → 3/12 수동 갱신 |
| 선택 문제만 여러 개 및 개념 문항 완료 | PASS. 필수 0/12 유지. 과거/중복/다른 학생의 생성 연습 세트가 필수 완료를 막지 않음 |
| 선택 연습 추가 완료 | PASS. 필수 3/12 유지, 선택 연습 1로 증가 |
| 한 차시의 필수 문항이 2개인 경우 | PASS. 1개만 풀면 미완료, 모두 풀면 해당 차시 1개 완료 |
| 페이지 열기·오답·재시도 | PASS. 열기/오답만으로 완료되지 않고, 정답 재시도 후 기존 오답 수 보존 |
| 학생/교사 새로고침·로그아웃 후 재접속 | PASS. 3/12 및 문제 완료 상태 유지 |
| 새 교사 브라우저 context | PASS. 같은 서버 저장 기록을 3/12로 표시 |
| 학생 A/B/C 분리 | PASS. DB와 브라우저 모두 1/12, 5/12, 12/12. 다른 학급 필수 문제 및 학생 기록 제외 |
| 디스크 DB 종료 후 재개방 | PASS. 메모리/브라우저 상태 없이 동일한 진도 복원 |
| 과거 잘못 저장된 completed=false | PASS. 기존 RPC로 결함을 재현한 뒤 읽기 시 3/12 계산. 조회 및 새 migration 적용이 기존 행을 변경하지 않음 |
| 진도 조회 일시 실패·회복 | PASS. 마지막 정상 수치 유지, 오류 표시 후 성공 시 오류 해제 |
| 다른 교사 지표 | PASS. 차시 칩·현재 차시·오답 수·최근 활동·선택 연습·학생 상세·수업 완료율 33%/100% 확인. 접속 상태의 기존 단위 테스트도 통과 |
| 대량 조회 | PASS. 2,305행 및 정확히 1,000행 페이지 경계 검사. 중간 실패를 부분 진도로 표시하지 않음 |

브라우저 검증은 **실제 앱 UI + 합성 인증/HTTP 전달 계층 + 실제 공유 채점 코드·PostgreSQL(PGlite) migration/RPC·교사 집계 함수**를 사용했다. 인증 서비스와 HTTP 라우팅을 대체한 테스트이므로 수정된 Edge Function 전체를 원격 Supabase에 배포해서 확인한 결과는 아니다. 운영 학생 계정이나 개인정보는 사용하지 않았다.

## 전체 테스트와 실행 환경

- 전체 단위·DB 통합 `npm test`: **593/593 PASS**, skip 0 (원본 저장소의 최종 변경본, 44.4초).
- 전체 Playwright E2E: **41/41 PASS**, skip 0. 새 진도 테스트 2개 포함.
- `npm run typecheck`: PASS.
- `npm run typecheck:edge`: PASS (`student-api`, `student-auth`).
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `npm run test:security`: **1/1 PASS**.
- `scripts/verify-seed.ts`: **30문제 정합성 PASS**.
- `git diff --check`, 추가/수정 내용의 비밀키 패턴 검사: PASS.

전체 E2E 최초 실행은 39 PASS/2 FAIL이었다. 두 실패는 이번 변경 이전 코드에서도 이미 존재한 테스트 선택자 불일치였다. `live-flow.spec.ts`의 예전 placeholder를 실제 `전체 개수`로 맞추고, `renderer-mount.spec.ts`의 증가/감소 버튼 위치 의존을 접근성 이름으로 바꿨다. 기존 동작 검증·assertion은 유지했으며 테스트 삭제/skip이나 기능 우회는 하지 않았다. 이후 전체 41개를 재실행해 통과했다.

원래 `node_modules`에서 타입 검사/브라우저 도구의 파일 읽기가 정지하여, 원본 의존성은 보존하고 `/private/tmp/teacher-required-progress-verify`에 같은 lockfile로 `npm ci`한 검증 복사본을 사용했다. 변경된 코드·테스트 19개 파일은 원본과 바이트 단위로 일치함을 확인했다(보고서 제외). 빌드는 합성 로컬 Supabase URL/공개 테스트 키를 사용했다. E2E가 생성한 제3자 HTML 보고서 자산이 린트에 잡힌 중간 실행은 제외하고, 그 산출물만 소스 밖으로 이동한 뒤 원래 `npm run lint`를 통과했다.

전체 단위 테스트는 상위 `render.yaml`, 기존 QA fixture, `.env.test.example`까지 읽으므로 원본 저장소에서 최종 실행했다. 임시 복사본에서 해당 부속 파일이 없는 실행은 환경 누락으로 실패했으며 최종 PASS에 포함하지 않았다.

## 수정 파일 (앱 루트 기준, 20개)

| 파일 | 변경 |
|---|---|
| `shared/lessonProgression.ts` | 필수 문제/차시 완료의 공통 판정 |
| `shared/teacherProgress.ts` | 저장된 문제 ID로 필수 진도와 선택 연습을 정확히 집계 |
| `src/pages/TeacherPage.tsx` | 진도 10초 갱신·수동 갱신·오류 회복·늦은 응답 보호·12차시 설명 |
| `src/pages/TeacherStudentRecord.tsx` | 상세 완료 차시 기준 통일·시도 전체 조회·조회 오류 처리 |
| `supabase/functions/student-api/index.ts` | 학생 홈/필수 단계/교사 진도/수업 결과의 판정 일치 및 조회 오류·페이지 처리 |
| `supabase/functions/_shared/pagination.ts` | 안정적으로 정렬된 조회의 1,000행 제한 처리 |
| `supabase/migrations/20261002085049_required_lesson_completion.sql` | 기존 데이터 변경 없이 완료 저장 RPC의 필수 분모 수정, 활동/보상/권한 보존 |
| `tests/support/required-progress-db.ts` | 실제 SQL·채점·제출 및 합성 학급 DB fixture |
| `tests/teacher-required-progress-db.test.ts` | 0/1/3/12·학생/학급 격리·영속성·과거 기록·활동 보존 회귀 검사 |
| `tests/progress-pagination.test.ts` | 대량 조회·경계·부분 오류 검사 |
| `tests/teacher-progress-refresh.test.ts` | 자동/수동 갱신 및 오래된 응답 보호 검사 |
| `tests/teacher-progress-summary.test.ts` | 필수·선택 및 잘못된 과거 완료값 집계 검사 |
| `tests/teacher-live-status-source.test.ts` | 접속 새로고침의 진도 갱신 연결 검증 |
| `tests/teacher-progress-phase2.test.ts` | 수정된 진도 갱신 호출 규약 검증 |
| `tests/installer-backend.test.ts` | 추가 migration의 설치 묶음 포함 검사 |
| `e2e/support/required-progress-api.ts` | 합성 인증/HTTP와 실제 DB·공유 함수 연결 |
| `e2e/teacher-required-progress.spec.ts` | 학생/교사 분리 브라우저 제출·갱신·재접속·상세·수업 결과 검증 |
| `e2e/live-flow.spec.ts` | 기존 숫자 입력 테스트의 오래된 placeholder 보정 |
| `e2e/renderer-mount.spec.ts` | 기존 증가/감소 버튼을 위치 대신 접근성 이름으로 선택 |
| `qa/teacher-required-progress/REPORT.md` | 조사 근거·구조·검증·한계·운영 반영 요건 기록 |

## Git 처리

작업 브랜치: `fix/2026-10-02-teacher-required-progress` (시작 브랜치 `feature/spatial-math-redesign-v1`에서 분기).
검증 후 위 20개 파일만 커밋·push한다. 기존 사용자 QA 산출물과 배포자료는 추가하거나 삭제하지 않는다. 운영 브랜치와 main에는 push하지 않는다.

## 운영 반영

이번 작업에서 운영 배포·원격 migration 적용·운영 학생 데이터 수정은 하지 않는다.
향후 운영 반영에는 새 migration, 변경된 `student-api` 및 프런트엔드가 함께 필요하다. 화면만 배포하는 것으로 DB 저장 규칙까지 바뀌지는 않는다.
