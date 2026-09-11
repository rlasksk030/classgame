# Supabase 실제 연결

## 현재 적용 상태 (2026-09-11)

프로젝트: stacking-blocks-math / Seoul / `lpjpwrgzwumnikroledh`.
기존 면담앱과 별개다. 기존 앱 코드와 DB를 수정하지 않는다. 앱에서 이미 사용하는 `sb_` 이름은 유지한다.

- `.env.local` 공개 URL/키 입력 완료. Git에서 제외된다.
- SQL Editor로 마이그레이션 001~008 적용 완료. 앱 테이블 16개 모두 RLS 활성화, 기본 문제 30개 확인.
- private Storage bucket `sb-worksheets`, `sb-problem-images` 생성 SQL 적용.
- `student-auth`, `student-api` 함수 배포 완료. 로컬 소스를 esbuild로 단일 ESM으로 묶어 대시보드 편집기로 배포했다. CLI 배포는 원본 다중 파일을 그대로 사용한다.
- student-auth의 legacy JWT 설정 해제 저장 작업 수행. student-api 설정 변경은 자동 승인 검토가 거부해 보류.
- **009 권한 SQL 적용 완료 (2026-09-11)**: 새 프로젝트 SQL Editor에서 원문을 실행했다. anon 권한은 추가하지 않았고 `sb_student_sessions`는 anon/authenticated에서 revoke했다.
- **APP_SESSION_SECRET은 운영자가 Supabase Edge Function Secret으로 설정 완료했다고 확인했다.** 값은 코드·Git·프런트엔드·로그에 저장하지 않는다. 교사 계정/테스트 학생은 아직 생성하지 않았으며, 로그인·진도 저장의 실제 성공을 검증한 상태가 아니다.
- 공개 키 직접 조회: students/PIN vault/problems 각각 401 permission denied.
- 함수 호출: student-auth 비존재 학급 CLASS_NOT_FOUND, student-api 세션 없는 요청 SESSION_MISSING 확인. 이는 함수 실행 확인이며 정상 로그인/DB 접근 성공의 증거가 아니다.

## 1. 환경변수 위치

파일: `apps/stacking-blocks-math-web/.env.local` (프로젝트 폴더 안)

```dotenv
VITE_SUPABASE_URL=https://lpjpwrgzwumnikroledh.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=대시보드의_sb_publishable_공개키
```

현재는 제공받은 실제 값을 입력해 두었으므로 다시 입력할 필요가 없다. 다른 PC에서는 `.env.example`을 `.env.local`로 복사한 뒤 값을 채운다. 개발 서버를 재시작하고 배포 환경에서도 같은 두 변수를 설정한 다음 다시 빌드한다.

`VITE_SUPABASE_ANON_KEY`는 더 이상 사용하지 않는다. 비밀키에 VITE_ 접두사를 붙이지 않는다.
`src/lib/config.ts` → `src/lib/supabase.ts`가 교사용 Auth 클라이언트를 생성한다.
학생 API는 `src/lib/studentApi.ts`에서 공개 키를 `apikey`, 학생 토큰을 `x-student-token`으로 보낸다. 교사 API는 실제 Auth access token을 Authorization Bearer로 보낸다. 공개 publishable key를 JWT로 보내지 않는다.

## 2. 마이그레이션 순서

`supabase/migrations/`의 파일을 번호순으로 적용한다.

1. 001_initial: 앱 테이블, RLS, 학급 공개 정보 RPC
2. 002_seed: 최초 기본 문제
3. 003_problem_sources: 출처 구분
4. 004_atomic_attempts: 원자적 채점/보상 저장
5. 005_curriculum: 5차시 수정, 종합 문제 포함 30개
6. 006_activities: 공유 문제/건축물/자기평가
7. 007_teacher_reset: 교사 진도 초기화 RPC
8. 008_worksheet: 수동 학습지, 비공개 파일 보관
9. 009_api_grants: 새 프로젝트의 명시적 API 테이블 권한 (**2026-09-11 적용 완료**)
10. 010_challenge_score: 9차시 친구 문제 점수 (**2026-09-11 적용 완료**)
11. 011_practice_count: 차시별 추가 문제 수와 학생별 연습 seed (**2026-09-11 적용 완료**)

현재 프로젝트에는 001~008을 다시 실행하지 않는다. 008은 반복 실행용 SQL이 아니다. SQL Editor 적용은 CLI migration 이력을 자동 등록하지 않는다. 추후 CLI를 처음 연결할 때는 이미 적용된 001~008을 확인하여 `supabase migration repair --status applied 버전번호`로 이력부터 맞춘다. 이후 `supabase db push --dry-run`으로 009만 남는지 확인한다.

009는 앱 테이블만 대상으로 한다. service_role은 16개 테이블의 SELECT/INSERT/UPDATE/DELETE, authenticated는 세션 테이블을 제외한 15개 테이블의 같은 권한을 갖되 기존 RLS로 자기 학급만 허용한다. 학생 세션 테이블은 서버만 접근한다. anon 테이블 권한은 추가하지 않는다. 서비스 비밀키는 서버에서만 사용한다.

## 3. Edge Functions와 Secret

Supabase CLI 로그인은 계정 소유자가 수행한다. 아래 명령은 앱 폴더에서 실행한다.

```bash
supabase login
supabase link --project-ref lpjpwrgzwumnikroledh
supabase functions deploy student-auth --project-ref lpjpwrgzwumnikroledh
supabase functions deploy student-api --project-ref lpjpwrgzwumnikroledh
```

`supabase/config.toml`은 내부 인증을 사용하도록 verify_jwt=false를 명시한다. student-api 설정 변경은 이번 자동 승인 검토에서 보류됐으므로 승인 전 위 명령으로 우회 적용하지 않는다.

대시보드 → Edge Functions → Secrets에서 `APP_SESSION_SECRET`을 추가한다. 현재 새 프로젝트에는 설정 완료 상태다. 암호 관리자로 최소 32바이트 무작위 값을 생성하고 서버 Secret에만 보관한다. 코드/SQL/공개 env/로그에 넣지 않는다. 변경하면 기존 PIN 해시·세션에 영향을 줄 수 있으므로 운영 후에는 임의 교체하지 않는다.

Supabase가 함수에 제공하는 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 `_shared/db.ts`에서만 사용한다. 프런트엔드에 복사하지 않는다. AI Secret은 필요 없다.

## 4. 교사와 테스트 학생

1. 위 권한 SQL·Secret·함수 설정을 먼저 완료한다.
2. `/setup`은 공개 연결 설정만 저장하며 교사 계정을 만들지 않는다. 교사 계정은 Supabase Dashboard의 Authentication → Users → Add user(또는 초대)로 생성한다. 실제 비밀번호는 소유자가 직접 입력하고 보관한다.
3. `npm run dev` 실행 후 `/teacher`에서 Supabase Auth 교사 계정으로 로그인한다.
4. 로그인 뒤 앱의 `새 학급 만들기`에서 학급을 만들고 학급 코드와 ID를 확인한다.
5. 교사 화면에서 테스트 학생 2명만 추가하고 자동 생성된 PIN을 확인한다. 기존 실제 학생 데이터가 있는 학급을 재사용하지 않는다.
6. 학생용 `/?class=학급코드` 링크를 별도 브라우저에서 연다.

## 5. 실제 연결 검증

- 학생 이름+PIN 로그인 → 1차시 블록 배치 → 저장 → 로그아웃/재접속 → 모양 복원.
- 3차시 잠금/해제 후 학생 카드가 15초 갱신 내 반영되는지 확인.
- 같은 문제 1/2회 오답에는 힌트 없음, 3회 힌트만, 다음 오답에 정답 공개 확인.
- 교사가 마지막 학생 3D 기록을 열고 회전.
- 다른 교사 계정에서 해당 학급/학생/PIN/작품 조회 불가 확인.
- 토큰을 변조하거나 student_id만 바꿔 요청해도 다른 학생 접근 불가 확인.
- 같은 반 공유 코드는 접근 가능, 다른 반은 불가 확인.
- 건축물 중간 저장/새 로그인 복원 및 소개서 확인.
- 학습지 원본은 교사만 접근. 승인한 문제의 crop 이미지만 학생에게 표시.

## 6. 검증 범위

로컬 typecheck, lint, unit/실제 PostgreSQL(PGlite) DB·RLS 8개, Deno 보안 1개, Edge 타입, production build, Chromium E2E 5개 통과. E2E API는 테스트 전용 HTTP 모킹이며 실제 서버 로그인 성공을 뜻하지 않는다. production src에는 mock API를 연결하지 않으며 PDF 코드는 교사 route chunk에서 로드한다.

권한 SQL/Secret/교사 계정/인증 설정이 끝나기 전에는 수업 투입 준비 완료로 판단하지 않는다. `student-auth`는 `APP_SESSION_SECRET`으로 PIN 해시와 HMAC 학생 세션을 발급하고, `student-api`는 같은 Secret으로 세션 서명을 검증한다. Secret 자체는 브라우저 요청에 포함되지 않는다.

`202609110011_practice_count.sql`을 적용하면 교사 설정의 5/10/15/20 추가 문제 수와 학생별 결정적 문제 seed가 서버에 저장된다. `202609110012_problem_accuracy.sql`은 문제 정확성 감사에서 확인된 기본 문제의 정답·투영·시점 데이터를 보정하고, `202609110013_challenge_hint_type.sql`은 친구 문제의 힌트 카드 유형을 저장한다. `202609110014_challenge_top_type.sql`은 9차시의 위에서 본 모양 단일 투영 카드를 허용한다. `202609110015_architecture_grid.sql`은 건축 프로젝트의 8×8 작업판 메타데이터를 저장하면서 기존 5×5 기록을 보존한다. `202609110016_rewards_loadout.sql`은 XP 해금 외형과 소개서 테마를 저장하고 장착 RPC를 추가한다. 001~016을 순서대로 적용하며, 이미 적용한 migration은 다시 실행하지 않는다. 이 migration들은 새 Storage bucket이나 공개 권한을 추가하지 않는다. `student-api`의 문제 생성 요청과 RLS는 실제 학생 세션을 준비한 뒤 다시 검증한다. 향후 학습지 배부(worksheet/assignment/submission/item)는 별도 migration과 Storage 정책으로 추가하며 이번 단계에서는 bucket을 만들지 않는다.
