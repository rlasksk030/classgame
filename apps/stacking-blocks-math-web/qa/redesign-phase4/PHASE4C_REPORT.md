PHASE 4C RESULT: LOCAL_IMPLEMENTATION_COMPLETE

이번 단계는 2026-09-13 현재 작업 트리(시작 HEAD `622eb7afde878e41bdbe1ba780de56ce1a4ee6a9`)에서 로컬 구현과 정적 계약 검증만 수행했다. 기존 미커밋 수학 변경과 기존 QA 산출물은 보존했으며, 원격 서비스와 운영 데이터에는 접근하지 않았다.

## 9차시 — 공유·채점 계약

- `shared/phase4.ts`에 `PublicPeerChallenge`를 추가해 학생 목록 DTO에서 `blocks`와 `hint`를 제외했다. 원본과 공개 카드·힌트의 일치 여부는 `validatePeerChallenge`가 `BLOCK_COUNT_INVALID`, `OUT_OF_BOUNDS`, `INVALID_SUPPORT`, `PROJECTION_MISMATCH`, `HINT_MISMATCH`, `VERSION_REQUIRED`로 구분한다.
- `createLocalPhase4Store`는 `installationId`와 `classId`를 함께 사용해 게시물·목록·문제 조회·힌트·숨김·통계를 격리한다. 학생별 문제 버전 키로 동일 제출을 재사용해 중복 점수를 막고, 채점은 출제자 좌표가 아니라 공개 조건을 기준으로 수행한다.
- 게시된 채점 조건을 같은 버전으로 바꾸는 경우를 거부해 기존 시도 기록을 보존한다. 숨김은 목록에서만 제외하고 원본과 시도 기록은 삭제하지 않는다.
- 현재 학생 화면의 기존 `PeerChallengePage`는 `activityApi`/`student-api` 경계를 계속 사용한다. 새 로컬 저장소는 이 경계의 계약·QA adapter이며 실제 Supabase 반 전체 공유는 검증하지 않았다.

## 11차시 — 소개서 내보내기

- `shared/phase4Export.ts`에 작품 버전 스냅샷, SVG 소개서, 연속 층의 모양과 공간 메모를 함께 비교하는 층 요약을 추가했다. 모양만 같고 메모가 다른 층은 합치지 않는다.
- `src/lib/phase4Export.ts`에서 현재 브라우저가 그린 SVG를 PNG 이미지로 저장하고, 같은 스냅샷을 JPEG XObject로 넣은 1페이지 PDF를 생성한다. 작품을 내보내는 동안 다른 버전이 섞이지 않도록 시작 시 스냅샷을 고정한다.
- 높은 작품은 모든 층을 무리하게 축소하지 않고 대표 층 범위와 전체 층 수를 소개서에 표시한다. 실제 브라우저에서 파일을 열어 보는 검증은 브라우저 승인 제한으로 BLOCKED다.

## 12차시 — 진행·시도·피드백 계약

- `Lesson12ProgressRecord`와 `ProgressRepository`를 추가해 설치·학급·학생·차시·세트·문항 버전 범위, 현재 위치, 답안, 첫 시도 결과, 시도 횟수, 힌트 단계, 최종 결과, 보충 상태, 완료 시각, 자기평가를 한 계약으로 표현한다.
- `MemoryProgressRepository`는 학생과 세트별로 기록을 격리하고, `src/lib/phase4Progress.ts`의 `LocalProgressRepository`는 같은 키 범위로 세션·seed·문항 답안·연습 총량(5/10/15/20)을 재접속 시 복원한다.
- `ReviewPhase4` 제출은 첫 시도와 최종 결과를 분리해 저장하며, 연습 총량 선택과 자기평가를 점수와 별도로 보존한다. 서버 Edge/API 연결과 실제 기기 간 복원은 이번 단계 범위에서 검증하지 않았다.

## 검사

- `npm test`: PASS — 110 tests (2026-09-13, 현재 작업 트리)
- `npm run typecheck`: PASS
- `npm run lint`: PASS
- `npm run build`: PASS — Vite production build 생성
- `npm run typecheck:edge`: PASS — `student-api`, `student-auth`
- `npm run test:security`: PASS — 1 security test
- `npm run audit:problems`: PASS — 기본 30개 + 생성 5,600개, 애매한 방향 0개
- `npm run audit:presentation`: PASS — 14,030개
- `npm run qa:redesign`: BLOCKED. 자동 승인 검토의 사용량 한도 초과로 브라우저 실행이 거부되었으며, 승인 우회나 반복 재시도는 하지 않았다. 따라서 실제 학생 화면 조작, 다운로드 파일 열기, 다중 사용자 브라우저 흐름은 PASS로 집계하지 않는다.

## 원격 미검증

실제 Supabase 진행 저장·반 전체 공유·서버 정답 보호·RLS 권한 집행·다른 기기 복원·iPad/Safari·교사용 간편 설치는 검증하지 않았다. 원격 migration, Edge Function 배포, Cloudflare 배포, push, 운영 데이터 변경은 모두 수행하지 않았다.

## 변경 및 Git

- 새 파일: `shared/phase4Export.ts`, `src/lib/phase4Export.ts`, `src/lib/phase4Progress.ts`, `tests/phase4-export.test.ts`, 본 보고서.
- 기존 Phase 4C 관련 수정은 `shared/phase4.ts`, `tests/phase4.test.ts`, `src/features/learning/Phase4Page.tsx`에 작업 트리로 보존되어 있다. 다른 선행 미커밋 파일도 건드리거나 되돌리지 않았다.
- 로컬 commit: 이번 단계에서는 기존 미커밋 변경과의 혼입을 피하기 위해 생성하지 않았다.
- 최종 HEAD: `622eb7afde878e41bdbe1ba780de56ce1a4ee6a9` (작업 트리 변경 포함)
- push: NO
- deploy: NO
- remote migration: NO
