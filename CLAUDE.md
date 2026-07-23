# 미니 원서 앱 (mini-reader)

원서 학습 앱 — Vercel(정적 HTML + 서버리스 API 1개) + Supabase. 수강생이 바이브 코딩으로 자기 학원에 맞게 고쳐 쓰는 프로젝트.

## 구조 (아주 단순 — 이 단순함을 유지할 것)

- `api/mini-reader.js` — **서버 전부가 이 파일 하나.** npm 패키지 없이 순수 fetch로 Supabase REST 호출. 새 기능도 이 파일에 action 추가로 구현 (파일 분리·프레임워크 도입 금지)
- `public/mini/*.html` — 페이지별 독립 HTML (빌드 없음). 공통 스타일은 `mini.css`
- `sql/mini-setup.sql` — 전체 스키마. 테이블 추가 시 이 파일에도 반영

## 규칙 (★ 어기면 앱이 망가지거나 위험함)

1. **API 키·비밀값은 Vercel 환경변수에만** (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `NOTION_TOKEN`). HTML/브라우저 코드에 키를 절대 넣지 말 것 — 학생·학부모가 소스를 볼 수 있음
2. Supabase 호출은 반드시 `api/mini-reader.js`를 거칠 것 (브라우저에서 Supabase 직접 호출 금지)
3. 테이블 이름은 `mini_` 접두사 유지 (다른 시스템과 한 Supabase를 같이 쓸 수 있음)
4. 한국어 주석·한국어 커밋 메시지, 파일 상단의 설명 주석은 지우지 말 것

## 자주 하는 수정 위치

| 수정 | 위치 |
|---|---|
| 학원 이름 | `report.html`·`worksheet.html`의 `var ACADEMY` |
| 대표 색 | 각 HTML `:root`의 `--brand` |
| 통과 점수 | `reader.html`의 `--pass-score` |
| 레벨/시리즈 목록 | `books.html`의 `var LEVELS` / `var SERIES` |
| AI 생성 프롬프트·문항 수 | `api/mini-reader.js`의 `generate` action |
