# 3D 쌓기나무 — 공간과 입체

초등 6학년 수학 수업을 위한 React/TypeScript/Vite + **Babylon.js** + Supabase 앱입니다.
현재는 구현을 이어가는 중입니다. 아래 검증 범위와 남은 작업을 확인한 뒤 사용하세요.
Three.js/React Three Fiber 의존성을 제거했습니다. 기존 다른 앱은 수정하지 않습니다.

## 설치와 실행

Node.js 24를 사용합니다. 이 폴더에서 실행하세요.

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`에 프로젝트의 공개 설정을 입력합니다.

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

학생에게 이 값을 입력시키지 않습니다. 학생은 `/?class=학급코드` 링크로 접속하여 이름과 4자리 PIN만 입력합니다.
`service_role`, 세션 비밀키, AI API 키는 브라우저 환경변수에 넣지 마세요.

실제 새 프로젝트 연결 상태와 순서는 [SUPABASE_SETUP.md](./SUPABASE_SETUP.md)를 먼저 확인하세요.

## Supabase 설정

1. 사용할 Supabase 프로젝트를 준비합니다. 현재 저장소에는 기존 AI 면담실의 원본/프로젝트 연결 정보가 없습니다. 기존 인수인계서에는 면담실이 GAS/Sheets 기반이라고 기록되어 있습니다.
2. Supabase SQL Editor에서 다음 파일을 **순서대로** 실행합니다. 기존 설치에도 첫 파일은 `if not exists` 및 정책 재생성 방식으로 적용됩니다. 이후 파일도 적용해야 합니다.
   - `supabase/migrations/202609110001_initial.sql`: `sb_` 테이블 14개, 교사별 RLS
   - `supabase/migrations/202609110002_seed.sql`: UUID를 가진 기본 문제 26개
   - `supabase/migrations/202609110003_problem_sources.sql`: 문제 출처
   - `supabase/migrations/202609110004_atomic_attempts.sql`: 시도·스냅샷·진도·보상 원자적 저장
   - `supabase/migrations/202609110005`~`202609110016`: 활동·교사 관리·연습 seed·문제 정확성·친구 카드·건축 8×8·XP 보상 외형 저장 계약
3. Supabase CLI를 설치한 환경에서 프로젝트를 연결하고 비밀키를 설정합니다. 기존 같은 이름의 Edge Function이 있는 프로젝트에는 덮어쓰기 전에 앱별 함수 이름을 분리해야 합니다.

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
# 최소 32바이트 이상의 무작위 값을 사용합니다.
supabase secrets set APP_SESSION_SECRET=YOUR_LONG_RANDOM_SECRET
supabase functions deploy student-auth --no-verify-jwt
supabase functions deploy student-api --no-verify-jwt
```

게이트웨이 JWT 검사 대신 함수 내부에서 학생의 HMAC 토큰과 DB 세션을 검증합니다. 교사 요청은 `auth.getUser()`로 실제 Supabase Auth 사용자를 검증합니다. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 Supabase 함수 환경에서 제공합니다.

4. Supabase Authentication에서 교사 이메일 계정을 생성합니다. `/teacher`에서 로그인하고 `새 학급 만들기`를 누릅니다.
5. 학생을 추가하고 PIN을 확인/복사합니다. 학생에게 학급 코드가 포함된 링크를 배포합니다. 1차시 외에는 기본 잠금 상태입니다.

## 주요 화면

- `/`: 학생 로그인
- `/world`: 12차시 카드와 진도, 15초마다 잠금 상태 갱신
- `/lesson/1` ~ `/lesson/12`: 공통 문제 화면
- `/teacher`: 교사 로그인, 학급 생성, 학생 추가/이름 수정/삭제/비활성화, PIN 재발급/전체 복사, 차시 잠금
- `/teacher/problems/new`: Babylon 3D 문제 제작. 정답 확정 후 등록
- `/teacher/students/:studentId`: 문제별 시도 상태와 저장된 3D 모양 열람

문제 데이터 품질을 점검할 때는 `npm run audit:problems`, `npm run audit:presentation`,
`npm run audit:semantics`, `npm run audit:solvability`, `npm run qa:curriculum`을 순서대로 실행합니다.

9차시 공유 놀이, 10~11차시 건축물 프로젝트, 수동 학습지 importer의 화면/API/저장 구조를 추가했습니다. 실제 계정으로 전체 흐름 검증은 남아 있습니다.

## 3D와 채점

- `src/features/block-world/BlockScene.ts`가 Babylon Scene/카메라/포인터/GPU 자원을 관리합니다. React 컴포넌트는 해제 시 엔진과 리스너를 정리합니다.
- 블록 추가·이동·삭제는 로컬 상태에서 처리합니다. 팔레트 드래그, 기존 블록 이동, 배치 Ghost, 카메라 회전/휠/터치 확대, 보기 애니메이션, orthographic 옵션, 층별 표시를 사용합니다.
- `shared/blocks.ts`: 정수 좌표 `{x,y,z}`, y→z→x 정렬, 바닥 지지/위 블록 삭제 금지, 투영/높이/층 계산.
- `shared/grading.ts`: 문제별 제출 유형을 검사하고 exact/constraint를 채점합니다. 잘못된 좌표를 자동 보정해서 정답으로 인정하지 않습니다.
- `shared/attempts.ts`: 오답 1·2회 재시도 → 3회 힌트만 → 다음 오답에서 정답 공개 → 직접 재구성 후 완료.
- `shared/types.ts`: 기존 문제 유형 및 좌표/답안 계약. 프런트와 Deno가 공유하므로 `.ts` import 확장자를 보존합니다.
- `sb_record_attempt` RPC는 서비스 역할만 호출합니다. 학생 행 잠금과 예상 시도 횟수를 사용해 오래된 동시 제출을 거부하며, 진도와 XP를 같은 트랜잭션에서 저장합니다. 한 문제 완료로 차시 전체를 완료하지 않습니다.

## 저장과 복구

블록 편집 즉시 학생/학급/문제별 localStorage 임시 기록을 만듭니다. 조작이 1.5초 멈추면 서버에 저장하며, 저장 버튼/정답 확인/문제 이동/페이지 숨김 시에도 저장을 시도합니다. 페이지 종료 시 네트워크 저장은 보장할 수 없으므로 기기 임시 기록을 우선 보관합니다.

서버 저장 실패 시 학생에게 안내하고 재접속 때 임시 기록을 복원합니다. `online` 이벤트에서 재전송합니다. 복원 중에는 편집하지 못하도록 하여 초기 상태가 기존 작업을 덮지 않게 합니다. 기기 저장소 접근이 차단된 경우에도 안내합니다.

## 검증 명령

```bash
npm run typecheck
npm run lint
npm test
npm run typecheck:edge
npm run test:security
node --experimental-strip-types scripts/verify-seed.ts
npm run build
npx playwright install chromium
npm run test:e2e
```

- `npm test`: 좌표/물리/투영/정확·조건 채점/오답 규칙 및 PostgreSQL(PGlite) 마이그레이션·RLS·원자적 진도 저장 테스트.
- DB 테스트는 실제 PostgreSQL로 SQL/RLS를 실행하지만 Supabase Auth의 `auth.uid()`는 테스트용으로 구성합니다. 배포된 Supabase 자체를 검증한 것은 아닙니다.
- `test:security`: Deno의 실제 HMAC/PIN 해시와 토큰 변조 검사.
- E2E: Chromium 1366×768 마우스 드래그/스냅/Undo/Redo/저장 복원, 터치 드래그, 자유 회전, 오프라인 복구. E2E의 HTTP 응답은 테스트용 모의 API입니다.
- `.github/workflows/stacking-blocks.yml`에 CI를 추가했습니다. 원격 CI 실행은 아직 확인하지 않았습니다.

## 배포

Cloudflare Pages 설정:

- 프로젝트 루트: `apps/stacking-blocks-math-web`
- 빌드 명령: `npm run build`
- 결과 폴더: `dist`
- Node 버전: 24
- 공통 정적 배포판은 Cloudflare 환경변수에 특정 교사의 Supabase 값을 고정하지 않는다. 학생/교사는 `/setup`에서 런타임 설치 설정을 등록하거나 설치 링크의 `#install=` fragment를 받아 연결한다.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`는 로컬 개발·테스트 fallback으로만 사용할 수 있다. `service_role`, `APP_SESSION_SECRET` 등 비밀값은 넣지 않는다.
- Cloudflare Pages Functions/Workers/KV/D1/R2 등 서버 기능은 사용하지 않는다. Edge Functions와 DB migration은 각 교사의 Supabase에 별도로 배포한다.

`public/_redirects`는 SPA 경로를 처리하며 `public/_headers`는 기본 응답 보안 헤더를 설정합니다. Edge Functions와 DB 마이그레이션은 별도로 배포합니다. 기존 AI 면담실과 다른 앱의 설정은 수정하지 않습니다.

## 수업 전 필요한 추가 검증과 남은 작업

전체 완료 상태는 아닙니다. [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)를 기준으로 이어갑니다.

- 실제 Supabase에서 교사/학생 로그인, PIN 잠금·재발급, 학생 A/B 및 교사 A/B 격리, 저장/복원 검증
- 교사용 문제 수정/삭제/필터/순서/학생 미리보기, 학생별·차시별 기록 초기화
- 9차시 같은 반 공유 문제, 10~11차시 건축물 소개서, 12차시 자기평가와 전체 보상 요소
- 학습지 PDF/이미지 분석·crop·교사 검토·3D 정답 확인·선택 등록·중복 감지·private Storage 전체 과정
- 5차시 정보 공개 단계, 투영 카메라의 모든 방향 정합, 터치 회전/핀치/기존 블록 이동의 확장 E2E
- 실제 웨일북 30명 동시 수업 및 네트워크 장애/종료/재접속 시험

자동 검증 통과만으로 위 항목이나 실제 서비스 배포가 완료되었다고 보고하지 않습니다.
