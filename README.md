# 우리 반 수업 도구

초등학교 수업에서 쓰는 웹 도구 모음입니다.

## 폴더 규칙

앱은 하나에 폴더 하나씩 `apps/` 아래에 둡니다.

```
index.html                포털 (앱 목록)
apps/
  mystery-sign/           미스터리 사인 — 숫자 규칙 찾기 놀이 (단일 HTML)
  gyeol-hap/              결! 합! — 세 장의 공통 규칙 찾기 놀이 (단일 HTML)
  stacking-blocks-math-web/  3D 쌓기나무 「공간과 입체」 학습앱 (Vite + Supabase)
```

루트의 `gyeol-hap.html` 과 `mystery-sign.html` 은 **옛 주소를 살려 두기 위한 리다이렉트**입니다.
학생이 북마크해 둔 링크가 깨지지 않도록 남겨 둔 것이니 지우지 마세요.

## 새 앱을 추가할 때

1. `apps/<앱이름>/` 폴더를 만듭니다.
2. 정적 HTML이면 `index.html` 하나로 끝내고, 빌드가 필요하면 그 폴더 안에서 완결되게 구성합니다.
3. 루트 `index.html` 포털에 카드를 한 장 추가합니다.

## 각 앱 안내

| 앱 | 형태 | 문서 |
|---|---|---|
| 미스터리 사인 | 단일 HTML (빌드 없음) | — |
| 결! 합! | 단일 HTML (빌드 없음) | — |
| 3D 쌓기나무 | Vite + React + Three.js + Supabase | [README](apps/stacking-blocks-math-web/README.md) · [인수인계서](apps/stacking-blocks-math-web/HANDOVER.md) |
