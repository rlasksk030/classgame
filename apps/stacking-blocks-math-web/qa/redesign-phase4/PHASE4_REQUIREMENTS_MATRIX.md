# Phase 4B 요구사항 대응표

상태는 구현과 검증을 분리한다. 브라우저 검증은 자동 승인 한도 차단으로 실행하지 못했다.

| ID | 진입 화면 | 구현 파일·경로 | 연결 경로 | 구현 | 검증 | 남은 작업 |
|---|---|---|---|---|---|---|
| L9-01 | `/student/lesson/9/redesign` | `src/pages/PeerChallengePage.tsx`, `shared/phase4.ts` | Builder → 카드/힌트 생성 → `activity:challenge:create` | PARTIAL | UNIT_VERIFIED / BROWSER BLOCKED | 실제 다중 context 게시·목록·풀이 연결 |
| L9-02 | 9차시 제작 단계 | `PeerChallengePage`, `ActivityBuilder` | 4단계 상태와 10개 gate | IMPLEMENTED | UNIT_VERIFIED / BROWSER BLOCKED | 실제 drag/tap 게시 확인 |
| L9-03 | 친구 문제 풀이 | `PeerChallengePage`, `_shared/activities.ts` | `challenge:get` → `challenge:hint` → `challenge:attempt` | PARTIAL | UNIT_VERIFIED / REMOTE NOT_VERIFIED | 원본과 다른 유효 해·중복 보상 브라우저 확인 |
| L10-01 | `/student/lesson/10/redesign` | `src/features/learning/Phase4Page.tsx` | 10×10 Builder → scoped draft 저장 | IMPLEMENTED | STATIC_VERIFIED / BROWSER BLOCKED | 네 모서리·12×12 실제 조작 확인 |
| L10-02 | 10차시 재료·이력 | 기존 `ActivityBuilder`, `BlockWorld` | 기존 material picker와 builder history | PARTIAL | STATIC_VERIFIED | appearance와 좌표의 원자적 undo/redo 보완 |
| L10-03 | 10차시 저장 | `Phase4Page` | localStorage scoped key | PARTIAL | UNIT/STATIC | 원격 저장·다기기 복원은 Phase 5 후보 |
| L11-01 | `/student/lesson/11/redesign` | `Phase4Page` | 같은 scoped project → representations | IMPLEMENTED | STATIC_VERIFIED / BROWSER BLOCKED | 실제 projectId 연결과 교사 조회 |
| L11-02 | 소개서 출력 | 없음 | 없음 | NOT_IMPLEMENTED | NOT_RUN | 한 장 PDF/이미지 export 필요 |
| L11-03 | 층별 용도 | `Phase4Page` layerNotes | 층별 메모 입력 → draft | PARTIAL | STATIC_VERIFIED | 점유 셀별 usage zone 필요 |
| L12-01 | `/student/lesson/12/redesign` | `Phase4Page`, `shared/phase4.ts` | seed → 공통6+맞춤4 → 입력/제출 | PARTIAL | UNIT_VERIFIED / BROWSER BLOCKED | 모든 피드백 단계·안정적 서버 배정 |
| L12-02 | 12차시 답안 UI | `MathGrid`, `Phase4Page` | 숫자·방향·투영·층별 DOM 입력 | IMPLEMENTED | TYPE/LINT/UNIT / BROWSER BLOCKED | 실제 클릭·채점 확인 |
| L12-03 | 보충·자기평가 | `Phase4Page` | 5/10/15/20 선택·self 저장 | PARTIAL | STATIC_VERIFIED | 실제 progress/교사 집계 연결 |
| ISO-01 | 공유 기기 | `scopedKey` | installation/class/student 범위 local key | IMPLEMENTED | UNIT/STATIC | A→B→A 브라우저 증거 필요 |
| QA-01 | Phase 4 QA | `e2e/redesign-phase4.spec.ts`, `scripts/run-redesign-qa.mjs` | production build → Playwright | IMPLEMENTED | TYPECHECK PASS / BROWSER BLOCKED | 자동 승인 한도 해소 후 실행 |

## 실행 기록

- 시작 HEAD: `df62b01abc0100db80216459cf94f84ae14b87f3`
- 검증 작업 트리 HEAD: `aea2f449296427376166825df74a862b074418fa` (Builder 외형 이력 보완은 미커밋 작업 트리)
- 기존 미커밋 변경은 보존했다.
- 원격 Supabase·migration·deploy·push: 실행하지 않았다.
