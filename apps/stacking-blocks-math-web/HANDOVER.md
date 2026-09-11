# 인수인계서 — 3D 쌓기나무 「공간과 입체」 학습 웹앱

> 이 문서만 읽고 이어서 작업할 수 있도록 정리했습니다.
> 작성 시점: 2026-09-11 / 브랜치: `claude/relaxed-cerf-ha4fwf` / 저장소: `rlasksk030/classgame`

---

## 1. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 프로젝트 위치 | `apps/stacking-blocks-math-web/` |
| 목표 | 초등 6학년 수학 '공간과 입체' 단원을 웨일북에서 실제 수업에 쓰는 수준으로 구현 |
| 현재 진척 | **기반 60% / 화면 10%** — 도메인 로직·DB·보안 설계는 끝, 3D 엔진과 화면은 미착수 |
| 빌드 상태 | `npm run build` **통과** |
| 데이터 점검 | `node --experimental-strip-types scripts/verify-seed.ts` **통과** (문제 26개 정합) |

### 지금 바로 확인하는 법

```bash
cd apps/stacking-blocks-math-web
npm install
npm run build                                          # 통과해야 정상
node --experimental-strip-types scripts/verify-seed.ts # 통과해야 정상
```

---

## 2. 저장소 정리 내역 (이미 반영됨)

`classgame` 저장소를 **앱별 폴더 구조**로 바꿨습니다. 앞으로 새 앱은 `apps/` 아래에 폴더를 하나 만들어 넣습니다.

```
classgame/
├── index.html                    포털 (앱 목록)
├── gyeol-hap.html                → apps/gyeol-hap/ 로 보내는 리다이렉트 (옛 주소 유지용)
├── mystery-sign.html             → apps/mystery-sign/ 로 보내는 리다이렉트
└── apps/
    ├── gyeol-hap/index.html      기존 게임 (내용 그대로 이동)
    ├── mystery-sign/index.html   기존 게임 (내용 그대로 이동)
    └── stacking-blocks-math-web/ ★ 이번 프로젝트
```

> 기존 두 게임은 **자체 완결형 HTML** 이라 옮겨도 깨지지 않습니다. 학생이 북마크했을 수 있는 옛 주소는 리다이렉트 스텁으로 살려 두었습니다.

---

## 3. 사전 조사 결과 — AI 면담실에서 가져온 것

명세 0번에 따라 기존 프로젝트를 먼저 조사했습니다.

**중요한 사실: AI 면담실은 Supabase 가 아니라 Google Apps Script + 스프레드시트 기반입니다.**
(`daengdaeng-lab/ai-interview-room-gas-v2`, 별도 저장소)

그래서 *연결 방식*은 가져올 것이 없었고, **보안 설계 패턴만** 옮겨 왔습니다.

| 패턴 | 원본 (AI 면담실) | 이 앱에서 |
|---|---|---|
| PIN 대조 | `sha256('pin:v2:' + studentId + pin + 비밀키)` — 원문 미저장 | `hashPin()` = HMAC-SHA256(`pin:v1:{id}:{pin}`) |
| 세션 토큰 | `base64url(payload).서명`, 12시간 | `issueSessionToken()` 동일 구조 + 표에 토큰 해시 보관 |
| 무차별 대입 방어 | 5회 실패 → 10분 잠금 | `failed_attempts` / `locked_until` 동일 |
| 학생 식별 | `class_code + student_no` (동명이인 대비) | `sb_students.id`(uuid) + 동명이인 시 번호 확인 |
| 비밀값 | GAS Script Properties | Supabase Edge Function Secrets |
| 관리자 인증 | 단일 `ADMIN_PASSCODE` | **Supabase Auth 로 격상** (교사별 계정 분리) |

Supabase 연결·배포 방식은 같은 저장소의 `daengdaeng-lab` 본체(Next.js)를 참고했습니다 — anon key 만 프런트에, 서버 키는 서버 전용, `schema.sql` 일괄 적용.

**기존 AI 면담실 코드는 읽기만 했고 한 줄도 고치지 않았습니다.**

---

## 4. 완료된 작업

### 4-A. 공용 도메인 로직 (`shared/`) — 완료

프런트와 Edge Function 이 **같은 파일**을 씁니다. 그래서 채점 기준이 어긋날 수 없습니다.
(Deno 호환을 위해 import 에 `.ts` 확장자를 붙였습니다. Vite 는 `allowImportingTsExtensions` 로 처리합니다.)

| 파일 | 내용 | 명세 |
|---|---|---|
| `types.ts` | 좌표(`{x,y,z}`, x=좌우 y=높이 z=앞뒤), 격자 설정, 문제 유형 13가지, 채점 모드, 투영/층별/숫자지도 타입 | 7, 16, 27 |
| `blocks.ts` | `canonicalize()` 정렬·중복 제거, **물리 규칙**(`canPlace`/`canRemove`), `project()` 위·앞·옆 투영, `toLayers()` 층별, `toHeightMap()` 숫자 지도, `settle()` | 7, 11, 14 |
| `grading.ts` | 자동채점. **좌표·격자 데이터만 비교하고 화면 픽셀은 절대 비교하지 않음.** `exact` / `constraint` 두 모드 | 16, 27 |
| `attempts.ts` | 오답 처리 상태 기계 + 보상 계산 | **17, 18, 19** |
| `lessons.ts` | 1~12차시 정의 (제목·목표·모드·색) | 21~32 |
| `seedProblems.ts` | 기본 문제 26개 | 22~32 |

#### 꼭 알아야 할 설계 결정

**① 물리 규칙 — 삭제 정책 A 채택 (명세 11)**
`y>0` 에 놓으려면 `(x, y-1, z)` 에 블록이 있어야 합니다. 삭제는 **위에 블록이 있으면 아래를 못 지웁니다.**
지웠더니 위가 내려앉는 혼란이 없어 교육용으로 안전합니다.

**② 투영은 "화면에 보이는 그대로"의 순서로 만듭니다**
`blocks.ts`의 `project()` 주석 참고. 격자를 그대로 출력하면 3D 시점 버튼을 눌렀을 때와 좌우가 일치합니다.
- 위: `top[z][x]` (카메라 +y, 화면 아래가 +z)
- 앞: `front[y][x]` (카메라 −z)
- 옆: `side[y][depth-1-z]` (카메라 +x, 화면 오른쪽이 −z) ← **여기 반전 주의**

**③ 오답 처리는 반드시 이 순서 (명세 17)**
```
1회 오답 → "다시 살펴보세요."        (힌트 X, 정답 X)
2회 오답 → "조금만 더 생각해 볼까요?" (힌트 X, 정답 X)
3회 오답 → 힌트 제공                  (정답 X)
힌트 본 뒤 또 오답 → 그때 정답 공개
정답 공개 후 → 스스로 다시 쌓아야 완료 (answer_revealed = true 로 기록)
```
`applyAttempt()` 하나에 다 들어 있습니다. **화면에서 이 규칙을 다시 구현하지 마세요.**

**④ 기본 문제의 정답은 손으로 적지 않았습니다**
투영·층별·숫자지도 정답은 모양에서 `project()` / `toLayers()` / `toHeightMap()` 로 계산해 넣습니다.
그래서 값이 어긋날 수 없고, `scripts/verify-seed.ts` 가 이를 다시 검증합니다.

#### 차시별 기본 문제 현황

| 차시 | 모드 | 문제 수 | 비고 |
|---|---|---|---|
| 1 쌓기나무와 친해지기 | problems | 3 | 층별 개수, 전체 개수, 자유 쌓기 |
| 2 어느 방향에서 본 모양(1) | problems | 3 | 앞/위/옆 방향 찾기 |
| 3 어느 방향에서 본 모양(2) | problems | 3 | 위·앞·옆 격자 그리기 |
| 4 쌓기나무의 개수 | problems | 3 | 자리별/층별 두 전략 + 숫자 지도 |
| 5 보이지 않는 쌓기나무 | problems | 3 | **회전 금지 문제 포함** (정보 부족 경험) |
| 6 세 방향 보고 쌓기 | problems | 2 | **constraint 채점** (여러 정답 허용) |
| 7 위에서 본 모양에 수 쓰기 | problems | 3 | 양방향(숫자→모양, 모양→숫자) |
| 8 층별로 나타낸 모양 | problems | 3 | 층별 그림 + 규칙 찾기 |
| 9 쌓기나무 놀이터 | playground | 0 | 문제 데이터가 아니라 전용 화면 필요 |
| 10 나만의 건축물 설계 | project | 0 | 전용 화면 필요 |
| 11 나만의 건축물 소개서 | project | 0 | 전용 화면 필요 |
| 12 단원 마무리 | review | 3 | 종합 |

### 4-B. 데이터베이스 (`supabase/schema.sql`) — 완료

표 이름에 `sb_` 접두사를 붙여 같은 Supabase 프로젝트의 다른 앱과 충돌하지 않게 했습니다 (명세 7).

```
sb_classes             학급 (class_code 가 학생 접속 링크의 ?class= 값)
sb_teacher_settings    교사 설정
sb_students            학생 (pin_hash 만 보관, 원문 없음)
sb_student_pin_vault   PIN 원문 — 담당 교사만 SELECT 가능
sb_student_sessions    발급한 세션 (토큰 해시만 저장)
sb_lesson_settings     차시별 잠금
sb_problems            문제 (answer 컬럼에 정답 원본)
sb_student_progress    차시별 진도
sb_problem_attempts    문제별 시도 (wrong_count / hint_shown / answer_revealed / completed)
sb_block_snapshots     학생이 마지막으로 쌓은 모양 (교사가 3D 로 다시 봄)
sb_student_rewards     XP·별·배지
sb_shared_challenges   9차시 친구 문제 (share_code)
sb_challenge_solves    9차시 풀이 기록
sb_projects            10~11차시 건축물 소개서
```

#### RLS 설계 (명세 8) — 핵심

```
교사 = Supabase Auth 사용자 → 자기 학급 데이터만 접근 (sb_owns_class / sb_owns_student)
학생 = Auth 회원 아님       → anon 키로는 어떤 표도 못 읽음. 정책을 아예 만들지 않았음.
                              모든 학생 요청은 Edge Function 을 지나고, 거기서만 service_role 사용.
```

그 결과 **`sb_problems.answer` 는 브라우저로 절대 내려가지 않습니다.**

유일한 공개 통로는 `sb_public_class_info(class_code)` 함수 하나입니다.
반 이름만 돌려주고, 학생 명단이나 PIN 은 나오지 않습니다.

### 4-C. Edge Function — 부분 완료

| 파일 | 상태 | 내용 |
|---|---|---|
| `_shared/security.ts` | ✅ 완료 | HMAC 세션 토큰 발급/검증(상수 시간 비교), PIN 해시, PIN 생성(약한 값 배제), 학급 코드·공유 코드 생성 |
| `_shared/http.ts` | ✅ 완료 | CORS, JSON 응답, 프리플라이트 |
| `_shared/db.ts` | ✅ 완료 | service_role 클라이언트, 교사 인증, 학급 소유 확인 |
| `student-auth/index.ts` | ✅ 완료 | 반 정보 조회 + 학생 로그인(동명이인 번호 확인, 잠금 처리, 세션 발급) |
| `student-api/index.ts` | ❌ **미작성** | 학생용 통합 API |
| `teacher-pins/index.ts` | ❌ **미작성** | PIN 생성·재발급 |

### 4-D. 프런트엔드 — 골격만

| 파일 | 상태 |
|---|---|
| `src/styles/index.css` | ✅ 디자인 토큰 완료 (블록 세계 느낌, 큰 버튼 48px, 1366×768 대응) |
| `src/lib/config.ts` | ✅ 완료 |
| `src/lib/supabase.ts` | ✅ 완료 (교사용, anon key 만) |
| `src/lib/studentApi.ts` | ✅ 완료 (Edge Function 호출기) |
| `src/pages/StudentLogin.tsx` | ✅ 완료 — **다른 화면을 만들 때 이 파일을 본보기로 삼으세요** |
| `src/App.tsx` | 🟡 라우터만. `/world`, `/lesson/:n`, `/teacher/*` 는 안내 문구 자리 |
| 3D 엔진 전체 | ❌ 미착수 |

---

## 5. 남은 작업 (우선순위 순)

### 3-A. 3D 쌓기나무 엔진 ★★★ 최우선 (명세 9~15)

`src/three/` 아래에 만듭니다. **이 앱의 핵심이고, 나머지 화면이 전부 여기에 의존합니다.**

만들 컴포넌트 (명세 9에 지정된 이름):
```
BlockWorld       Canvas + 조명 + 그림자 + 전체 묶음
Block            정육면체 하나. 모서리를 보이게 (경계 구분)
Grid             바닥 격자
BlockPalette     블록 보관함 (여기서 끌어다 놓음)
CameraControls   회전/확대. Pointer Events 로 마우스·터치 통합
ViewControls     자유/위/앞/옆/원래위치 버튼 (부드러운 전환)
LayerControls    층별 보기 (전체 / 1층 / 1~2층 ...)
ProjectionView   위·앞·옆 2D 격자 (읽기 + 학생 입력 겸용)
BuildToolbar     Undo / Redo / 전체 초기화
```

**반드시 지킬 것**

1. **성능 (명세 2)** — 블록 추가·이동·삭제·카메라 조작은 전부 브라우저 로컬 상태에서 즉시 처리.
   Supabase 저장은 *자동저장(debounce) / 정답 확인 / 문제 완료 / 차시 이동 / 창 닫기 전* 에만.
   → `zustand` 가 이미 설치되어 있습니다. 로컬 스토어 + debounce 저장으로 구현하세요.
   학생 30명이 동시에 써도 3D 조작이 서버 때문에 느려지면 안 됩니다.

2. **입력 (명세 10)** — `onPointerDown/Move/Up` 하나로 마우스·터치를 통합.
   - 블록 위 드래그 = 블록 조작 / 빈 공간 드래그 = 카메라 회전 (제스처 충돌 금지)
   - 휠 = 확대축소 / 두 손가락 = 확대축소
   - `touch-action: none` 을 캔버스에 지정 (body 에는 이미 `manipulation` 지정됨)

3. **위에서 보기는 2D 이미지로 바꾸지 않습니다 (명세 13)** — 3D 모델을 그 방향에서 보게만 하고,
   드래그하면 그 상태에서 자유 회전이 이어져야 합니다.

4. **물리 규칙은 `shared/blocks.ts` 의 `canPlace`/`canRemove` 를 쓰세요.** 새로 만들지 마세요.

5. **Undo / Redo / 전체 초기화 (명세 15)** — 초기화는 확인 창 1회.

### 3-B. 학생 메인 화면 `/world` ★★ (명세 20)

- 1~12차시 카드 전부 표시. 잠긴 차시도 보이되 자물쇠 표시.
- 카드에 차시·제목·진행률·획득 별·완료 여부·잠금 여부.
- 교사가 잠금을 풀면 새로고침 없이(또는 짧은 폴링으로) 들어갈 수 있게.
- `lessons.ts` 의 `accent` / `emoji` 를 카드 색과 아이콘으로 쓰세요.

### 3-C. 차시별 활동 화면 `/lesson/:n` ★★ (명세 22~32)

문제 유형(`ProblemType`)별로 컴포넌트를 하나씩 만들고 스위치로 고릅니다.
`shared/types.ts` 의 `PROBLEM_TYPES` 13가지가 목록입니다.

- 정답 확인 → `student-api` 의 `submit` 호출 → 돌아온 `GradeResult` 대로 화면 처리
- 힌트·정답 공개 여부는 **서버가 정합니다.** 클라이언트에서 판단하지 마세요.
- 정답 공개 시 반투명 Ghost 모델로 보여 주고, "정답 모양대로 다시 쌓기" 버튼 제공 (명세 18)

### 3-D. 교사 관리자 `/teacher` ★★ (명세 6)

Supabase Auth 로그인 후 진입. 화면 목록:
- 학생 관리 (추가/삭제/이름 수정/PIN 확인/PIN 재발급/전체 PIN 보기/전체 복사)
- 차시 관리 (1~12 개별 잠금·해제, 전체 잠금·해제)
- 학생 진도 (완료 차시, 진행 차시, 시도 횟수, 정답/오답, 힌트 사용, 정답 공개 여부, 보상)
- **3D 기록** — `sb_block_snapshots` 를 클릭하면 그 모양을 3D 로 다시 렌더링해 회전해 볼 수 있게
- 문제 관리 (추가/수정/삭제/활성·비활성/차시 이동/난이도/정답 설정)
- **3D 문제 제작기** — 교사가 직접 쌓아 정답으로 저장 (BlockWorld 재사용)
- 기록 초기화 (학생 1명 / 특정 차시 / 전체 학생 특정 차시)

### 3-E. `student-api` Edge Function ★★★ (3-C 와 짝)

`student-auth` 와 같은 틀로 만들되, 맨 앞에서 `verifySessionToken()` + `sb_student_sessions` 조회로 신원을 확인합니다.
**요청 본문의 studentId 를 절대 믿지 마세요. 토큰에서 꺼낸 `sid` 만 씁니다.** (명세 8)

필요한 action:
| action | 하는 일 |
|---|---|
| `world` | 차시별 잠금·진도·별, 보상 요약 |
| `lesson` | 그 차시 문제 목록. **`answer` 를 제거하고**, `hint` 는 `hint_shown` 일 때만 채움 |
| `submit` | `grade()` → `applyAttempt()` → 기록 저장 → `GradeResult` 반환 |
| `snapshot` | 쌓은 모양 저장 (자동저장) |
| `project.get` / `project.save` | 10~11차시 |
| `challenge.create` / `get` / `solve` | 9차시 |

### 3-F. `teacher-pins` Edge Function ★

PIN 해시에 서버 비밀키가 필요해서 이것만 Edge Function 이어야 합니다.
(나머지 교사 기능은 RLS 덕분에 `supabase-js` 로 바로 해도 안전합니다.)
- 학생 생성 시 PIN 자동 발급 → `sb_students.pin_hash` + `sb_student_pin_vault.pin_plain` 동시 기록
- 개별 재발급 / 전체 발급

### 3-G. 기본 문제 심기

`shared/seedProblems.ts` → `sb_problems` 로 넣는 스크립트가 필요합니다.
`code` 컬럼(예: `L3-01`)을 기준으로 upsert 하면 재실행해도 안전합니다.

### 3-H. 9차시 / 10~11차시 전용 화면

문제 데이터가 아니라 별도 흐름입니다. 표는 이미 만들어 두었습니다
(`sb_shared_challenges`, `sb_challenge_solves`, `sb_projects`).

---

## 6. 설정 · 배포 절차

### Supabase

1. 새 프로젝트 생성
2. SQL Editor 에 `supabase/schema.sql` 전체를 붙여넣고 실행
3. 비밀값 설정 (**절대 프런트에 넣지 마세요**)
   ```bash
   supabase secrets set APP_SESSION_SECRET="충분히 긴 무작위 문자열"
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 는 Supabase 가 자동 주입합니다.
4. Edge Function 배포
   ```bash
   supabase functions deploy student-auth
   ```
5. 교사 계정: Supabase Auth 에서 이메일 계정을 만들고, `sb_classes` 에 학급을 1개 추가

### 프런트 (Cloudflare Pages)

- 빌드 명령: `npm run build`
- 출력 폴더: `dist`
- 루트 디렉터리: `apps/stacking-blocks-math-web`
- 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `public/_redirects` 가 SPA 라우팅을, `public/_headers` 가 보안 헤더를 처리합니다.
- `wrangler.toml` 이 이미 들어 있습니다.

> `.npmrc` 에 `legacy-peer-deps=true` 가 있습니다.
> `@react-three/fiber` 가 optional peer 로 `expo` 를 끌어와 설치가 막히기 때문이며, 지우면 빌드가 깨집니다.

---

## 7. 절대 하지 말 것

1. **`service_role` 키나 `APP_SESSION_SECRET` 을 프런트엔드에 넣지 않기.** `VITE_` 접두사가 붙으면 번들에 그대로 들어갑니다.
2. **`sb_problems` 에 학생용(anon) RLS 정책을 만들지 않기.** 정답이 통째로 노출됩니다.
3. **채점을 브라우저에서 하지 않기.** 정답 비교는 반드시 Edge Function 안에서.
4. **요청 본문의 `studentId` 를 믿지 않기.** 세션 토큰에서 꺼낸 값만 쓰세요.
5. **3D 조작마다 Supabase 를 부르지 않기** (명세 2). debounce 자동저장만.
6. **화면 픽셀로 채점하지 않기** (명세 16). 항상 좌표·격자 데이터 비교.
7. **오답 처리 규칙을 화면에서 다시 구현하지 않기.** `applyAttempt()` 하나만 씁니다.
8. **교과서 삽화·출판사 이미지를 복제하지 않기** (명세 21). 모양과 문제는 직접 새로 만듭니다.
9. **기존 AI 면담실 코드를 수정하지 않기** (명세 0). 다른 저장소이며 참고만 합니다.
10. **`shared/` 의 import 에서 `.ts` 확장자를 떼지 않기.** Deno(Edge Function)가 깨집니다.

---

## 8. 명세 항목별 대조표

| 명세 | 항목 | 상태 |
|---|---|---|
| 0 | 저장소 조사 · 별도 프로젝트 분리 | ✅ |
| 1 | 기술 스택 (Vite+R3F+Supabase) | ✅ 구성 완료 |
| 2 | 로컬 우선 성능 원칙 | 🟡 zustand 준비, 구현 남음 |
| 3 | 웨일북 · 반응형 | 🟡 CSS 토큰 완료, 입력 통합 남음 |
| 4 | 블록 세계 디자인 | ✅ 토큰 완료 |
| 5 | 학생 로그인 (이름+PIN) | ✅ 화면·API 완료 / PIN 발급 남음 |
| 6 | 교사 관리자 | ❌ |
| 7 | DB 구조 | ✅ |
| 8 | 학생 세션 보안 | ✅ 설계·인증 완료 / student-api 남음 |
| 9~15 | 3D 엔진 | ❌ |
| 16 | 자동채점 | ✅ 로직 완료 |
| 17 | 오답 처리 | ✅ 로직 완료 |
| 18 | 정답 공개 방식 | 🟡 로직 완료, 화면 남음 |
| 19 | 게임 요소 | ✅ 보상 계산 완료 / 화면 남음 |
| 20 | 메인 화면 | ❌ |
| 21~32 | 차시 내용 | 🟡 문제 26개 완료 / 화면 남음 |

---

## 9. 다음 사람을 위한 추천 순서

```
1) student-api Edge Function 골격 (world / lesson / submit)
2) BlockWorld + Block + Grid + CameraControls  ← 최소 3D 가 서면 나머지가 빨라집니다
3) /world 화면 (3-B)
4) COUNT 유형 한 개로 /lesson 흐름 끝까지 연결 (제출 → 오답 3회 → 힌트 → 정답 공개 → 재구성)
   ★ 여기까지 되면 나머지 유형은 같은 틀의 반복입니다
5) 나머지 문제 유형 컴포넌트
6) 교사 관리자
7) 9 / 10~11차시 전용 화면
```

4번까지가 이 앱의 뼈대입니다. 그 지점에서 한 번 실제 웨일북으로 시험해 보시길 권합니다.
