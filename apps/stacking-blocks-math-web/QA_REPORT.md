# 자동 QA 보고서

현재 코드 기준 자동 점검 결과입니다. 이 보고서는 실제 Supabase 운영 데이터나 실제 iPad Safari 실행을 대신하지 않습니다.

## Core quality gate

| 항목 | 결과 |
|---|---|
| 문제 좌표·정답 감사 | PASS — 기본 30개 + 생성 5,600개, invalid 0 |
| Presentation 감사 | PASS — 기본/생성 14,030개, 누락 0 |
| Curriculum QA | PASS — 1~12차시 route·단계·Renderer 계약 |
| Unit | PASS — 34개 |
| Security | PASS — PIN hash 범위 및 session 위변조 검사 |
| TypeScript / ESLint | PASS |
| Edge Function typecheck | PASS |
| Production build | PASS |

## 차시별 점검

| 차시 | 자동 확인 |
|---|---|
| 1 | 위치·층·개수 문제와 답안 Renderer |
| 2 | 방향 투영과 모호한 방향 0건 |
| 3 | 실제 투영 크기 격자와 셀 입력 |
| 4 | 높이 지도·층별 자료 표시 계약 |
| 5 | 제한 카메라 정책과 추가 정보 단계 |
| 6 | 위·앞·옆 조건과 constraint 채점 |
| 7 | 높이 지도 입력/생성 |
| 8 | 층별 지도 입력/생성 |
| 9 | 10개 Builder, 문제·힌트 카드, 미리보기 |
| 10 | 4×4 건축 설계 화면 |
| 11 | 소개서 편집·미리보기 화면 및 Builder 보조 진입 |
| 12 | 종합 문제와 투영 격자 |

## 실제 브라우저 확인이 필요한 항목

- 실제 Mac Chromium에서 로그인 후 대표 화면의 문구와 시각적 균형
- Chromebook/WhaleBook과 iPadOS Safari의 터치 drag, tap-to-place, pinch, orientation 변경
- 실제 Supabase Auth/RLS/Edge Function 관통 흐름
- QR 코드 생성은 아직 구현하지 않았고 현재는 링크 복사 방식
- Playwright webServer는 샌드박스의 `listen EPERM`으로 실행되지 않음

재실행 명령:

```bash
npm run qa:curriculum
npm run audit:problems
npm run audit:presentation
npm test
npm run test:security
npm run typecheck
npm run lint
npm run typecheck:edge
npm run build
npm run test:e2e
```
