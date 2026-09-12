# 현재 요구사항 기준표

이 문서는 2026-09-12 최신 사용자 지시를 기준으로 작성했다. 상태는 코드/단위 검증과 실제 브라우저·Supabase 검증을 구분한다.

| 요구 ID | 최신 요구 | 폐기한 이전 요구 | 실제 구현 파일 | 완료 확인 방법 | 상태 |
|---|---|---|---|---|---|
| DIR-01 | 이 단원의 ‘옆’은 오른쪽에서 본 모양이다. | 화면 오른쪽 면을 옆으로 해석하는 표현 | `shared/blocks.ts`, `shared/spatialConventions.ts`, `src/features/block-world/BlockScene.ts` | 비대칭 fixture의 오른쪽 투영·side 계산·카메라 버튼을 독립 확인 | VERIFIED_LOCAL (브라우저 BLOCKED) |
| DIR-02 | 옆 자료와 답안은 오른쪽 관찰 기준을 사용하고 한글 기준을 안내한다. | side enum/영문 표시만으로 완료 처리 | `src/pages/LessonPage.tsx`, `src/features/activities/Representations.tsx`, `shared/problemPresentation.ts` | DOM 자료·제목·답안 격자 확인 | IMPLEMENTED (브라우저 BLOCKED) |
| DIR-03 | 위·높이 지도·층별 지도·답안 격자는 앞/옆 기준을 일관되게 표시한다. | 3D 판 바깥 화살표와 2D 관찰자 화살표 혼용 | `src/features/activities/ProjectionGrid.tsx`, `src/styles/index.css`, `src/components/world/BlockWorld.tsx` | 3·4·8·12차시 자료의 방향 표식 스크린샷 | BLOCKED |
| REWARD-01 | XP는 실제 해금 가능한 보상에만 사용하고 별은 성취 기록으로 유지한다. | 화면에 XP/별 숫자만 표시 | `shared/rewards.ts`, `src/pages/RewardsPage.tsx` | 카탈로그 임계값 단위 테스트와 보상 공방 화면 | VERIFIED_LOCAL |
| REWARD-02 | 해금 재료는 10차시에서 새 블록·선택 블록에 실제 적용되고 저장/복원된다. | 보상 화면만 있고 건축 화면에서 사용할 수 없음 | `src/components/world/BlockWorld.tsx`, `src/features/block-world/BlockScene.ts`, `src/pages/ArchitecturePage.tsx`, `supabase/migrations/202609110016_rewards_loadout.sql` | 재료 선택→배치/기존 블록 적용→저장→11차시 복원 | IMPLEMENTED (실제 Supabase/브라우저 BLOCKED) |
| ARCH-01 | 신규 10차시 기본 작업판은 10×10×3이며 기존 5×5·8×8 작품은 보존한다. | 8×8을 신규 기본값으로 보고하거나 4×4를 기본으로 사용 | `shared/activities.ts`, `supabase/schema.sql`, `supabase/migrations/202609110016_rewards_loadout.sql` | 신규 EMPTY_BUILDING와 서버 기본값·좌표 경계 테스트 | VERIFIED_LOCAL |
| ARCH-02 | 큰 화면에서 넓은 판과 문제 자료를 함께 보여주며 내용을 숨기지 않는다. | 카메라 확대만으로 작은 판을 크게 보이게 처리 | `src/pages/ArchitecturePage.tsx`, `src/styles/index.css` | 1366×768 실제 화면 캡처 | BLOCKED |
| DATA-01 | 외형 metadata는 좌표/개수/투영/채점과 분리한다. | 외형을 수학 정답 데이터에 포함 | `shared/activities.ts`, `shared/rewards.ts`, `shared/grading.ts` | 외형 변경 전후 동일 좌표 채점 테스트 | VERIFIED_LOCAL |
| DATA-02 | 보상/작품 저장은 서버에서 잠금과 권한을 재검증한다. | 클라이언트 XP 또는 외형 값을 신뢰 | `student-api/index.ts`, `supabase/functions/_shared/activities.ts`, `supabase/migrations/202609110016_rewards_loadout.sql` | Edge typecheck, RLS/security 테스트, 실제 RPC 검증 | IMPLEMENTED (원격 migration BLOCKED) |
| QA-01 | generator와 grader 동일 함수 비교만으로 PASS하지 않고 고정 기대값·실제 화면을 분리한다. | 무작위 seed 결과만으로 화면 기능 완료 처리 | `tests/activities.test.ts`, `scripts/audit-*.ts`, `QA_REPORT.md` | 고정 fixture·audit·브라우저 캡처를 별도 기록 | IMPLEMENTED (브라우저 BLOCKED) |
| QA-02 | 운영자 맥에서 실행 가능한 합성 데이터 브라우저 QA 명령을 제공한다. | 샌드박스에서 반복 실패하거나 존재하지 않는 명령 안내 | `package.json`, `e2e/`, `QA_CHECKLIST.md` | 명령 실제 실행 및 캡처 산출물 확인 | BLOCKED |

## 판정 원칙

- `IMPLEMENTED`: 코드 경로가 존재하나 화면 또는 실제 서버 관통 확인이 남아 있다.
- `VERIFIED_LOCAL`: 현재 커밋에서 자동 검사/순수 로직 검증이 통과했다.
- `VERIFIED_LIVE`: 실제 브라우저 또는 실제 Supabase에서 현재 커밋을 확인한 경우에만 사용한다.
- `BLOCKED`: 환경 제약으로 증거를 만들지 못한 경우다. 과거 커밋의 PASS는 현재 검증으로 재사용하지 않는다.
- `NOT_STARTED`: 코드 경로가 아직 없다.

현재 브라우저 QA는 이 환경의 Vite/Playwright 포트 바인딩 제한으로 BLOCKED다. 원격 migration 016 적용과 Supabase 관통 검증도 운영자 승인·접속이 필요한 별도 작업이다.

## 긴급 학생 화면 오류 기준 (2026-09-12)

| 요구 ID | 최신 요구 | 폐기한 이전 요구 | 실제 구현 파일 | 완료 확인 방법 | 상태 |
|---|---|---|---|---|---|
| R01 | 3차시 그리기 문항은 실제 입력 격자를 mount하고, 면 정보가 없으면 제출/오답을 막는다. | `gridSpec` 데이터만 있으면 화면도 정상이라고 판정 | `src/pages/LessonPage.tsx`, `shared/problemPresentation.ts` | Renderer 계약 및 실제 DOM QA (`qa:renderer`) | IMPLEMENTED (브라우저 BLOCKED) |
| R02 | 5차시 정보 충분성 선택과 ‘숨은 블록 없음’ 숫자 세기를 분리한다. | 앞모습 자료를 원본 3D 총개수로 채점 | `shared/seedProblems.ts`, `shared/practiceGenerator.ts`, `shared/grading.ts` | 고정 대표값·생성 seed 독립 테스트 | VERIFIED_LOCAL |
| R03 | 답안 유형에 맞는 정답 공개/후속 활동만 제공한다. | 모든 오답에 ‘다시 쌓기’ 공통 문구 | `shared/attempts.ts`, `supabase/functions/student-api/index.ts`, `src/pages/LessonPage.tsx` | 비쌓기 `requiresRebuild=false`, 쌓기 재구성 상태 기계 | VERIFIED_LOCAL |
| R04 | 학생 표시는 `앞`·`옆`으로 단순화하고 기준 안내를 짧게 제공한다. | `앞쪽 경계`·긴 관찰자 문구 반복 | `src/components/world/BlockWorld.tsx`, `src/components/world/ProjectionGrid.tsx`, `src/pages/LessonPage.tsx` | 소스/DOM 문자열 및 화면 캡처 | IMPLEMENTED (브라우저 BLOCKED) |
| R05 | 보관함은 세 면이 맞붙은 닫힌 정육면체이며 기존 드래그·탭 배치를 유지한다. | 펼쳐진 CSS 전개도 형태 | `src/components/world/BlockWorld.tsx`, `src/styles/index.css` | SVG 꼭짓점 검사·화면 조작 | IMPLEMENTED (브라우저 BLOCKED) |
| R06 | 학생 단계는 `① 개념 배우기 → ② 문제로 익히기 → ③ 더 풀어보기`이며 단계별 위치를 보존한다. | `전체 학습 / 개념 익히기 / 개념 확인` 혼합 표시 | `src/pages/LessonPage.tsx`, `src/pages/StudentWorld.tsx` | 단계별 인덱스/복원 회귀 및 화면 확인 | IMPLEMENTED (브라우저 BLOCKED) |
