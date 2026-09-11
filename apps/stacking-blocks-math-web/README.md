# 3D 쌓기나무 「공간과 입체」 학습 웹앱

초등학교 6학년 수학 '공간과 입체' 단원을 웨일북에서 수업용으로 쓰기 위한 웹앱입니다.

- 학생: 이름 + 4자리 PIN 으로 접속 → 1~12차시 활동
- 교사: Supabase Auth 로그인 → 학생·차시·진도·문제 관리

## 기술 스택

| 영역 | 사용 |
|---|---|
| 프런트 | React 19 + TypeScript + Vite 6 |
| 3D | Three.js + @react-three/fiber + @react-three/drei (실제 WebGL) |
| 백엔드 | Supabase (PostgreSQL / Auth / Edge Functions / RLS) |
| 배포 | Cloudflare Pages (정적 SPA) + Supabase Edge Functions |

## 빠르게 시작하기

```bash
npm install
cp .env.example .env.local   # Supabase URL / anon key 입력
npm run dev
```

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입 검사 + 프로덕션 빌드 (`dist/`) |
| `npm run typecheck` | 타입만 검사 |
| `node --experimental-strip-types scripts/verify-seed.ts` | 기본 문제 데이터 정합성 점검 |

## 폴더 구조

```
shared/              프런트와 Edge Function 이 함께 쓰는 순수 로직
  types.ts             좌표·문제·채점 타입
  blocks.ts            좌표 정규화, 물리 규칙, 투영/층별/숫자지도 변환
  grading.ts           자동채점 (좌표 비교. 화면 픽셀 비교 없음)
  attempts.ts          오답 처리 상태 기계 (1·2회 안내 → 3회 힌트 → 이후 정답 공개)
  lessons.ts           1~12차시 정의
  seedProblems.ts      기본 문제 26개

src/                 브라우저 전용 코드
supabase/
  schema.sql           표·RLS·함수 전체
  functions/           Edge Function (학생 인증 등)
scripts/verify-seed.ts 기본 문제 점검
```

## 보안 원칙

- `service_role` 키와 `APP_SESSION_SECRET` 은 **Supabase Secret 에만** 둡니다. 프런트 번들에 절대 넣지 않습니다.
- 학생은 Supabase Auth 회원이 아닙니다. 모든 학생 요청은 Edge Function 을 지납니다.
- `sb_problems.answer`(정답 원본)에는 anon 정책이 없습니다. 브라우저로 내려가지 않습니다.
- PIN 원문은 교사만 볼 수 있는 `sb_student_pin_vault` 에만 있고, 대조는 해시로 합니다.

자세한 진행 상황과 남은 작업은 [HANDOVER.md](./HANDOVER.md) 를 보세요.
