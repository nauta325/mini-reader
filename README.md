# 🎓 미니 원서 앱 (mini-reader)

터미널 없이 **브라우저만으로** 배포하고, **클로드에게 말해서 바꾸는(바이브 코딩)** 경험을 위한 가장 단순한 원서 학습 앱.
**Vercel + Supabase (+ Claude API)** 만 씁니다.

> 🧑‍🏫 **세미나 참가자라면:**
> - 📘 **혼자서도 처음~끝 (영상 없이) → [교재.md](교재.md)** ← 개념·왜·화면·막히면까지 다 설명한 **자습 교재**
> - ⚡ 빠른 요약본: **2부 [실습가이드.md](실습가이드.md)** · **3부 [실습가이드-3부.md](실습가이드-3부.md)**
>
> "Use this template"로 복사하면 이 교재가 **여러분 저장소에 그대로 남아** 영상이 만료돼도 혼자 볼 수 있어요.

## 무엇이 되는가

- **선생님**: 반 만들기 → 학생 등록 → 지문 붙여넣으면 **AI가 단어카드·원서퀴즈1·원서퀴즈2 자동 생성** → 학생/반에 배정 → **워크시트 출력** → 학생별 현황·리포트
- **학생**: 아이디+이름 로그인 → 배정된 책 → 단어 학습→퀴즈 3종 → 소리내어 읽고 녹음 → 통과/완독 배지
- **부모**: 학생별 학습 리포트(배정·완독·평균점수+녹음) 인쇄/PDF

---

## 🚀 세팅 (브라우저만, 터미널 X — 약 10분)

### 1) 코드 준비 — 내 저장소 만들기
- 이 페이지 우측 상단 **"Use this template" → "Create a new repository"** → 내 계정에 저장소 생성 (커밋 기록 없는 깨끗한 복사본)
- (버튼이 안 보이면 GitHub **로그인** 먼저)

### 2) Supabase (데이터베이스)
1. [supabase.com](https://supabase.com) → 새 프로젝트 생성
2. 왼쪽 **SQL Editor → New query** → `sql/mini-setup.sql` 내용 전체 붙여넣기 → **Run** (표·버킷·샘플책 한 번에 생성)
3. **Settings → API** 에서 두 값 복사:
   - `Project URL` → 나중에 `SUPABASE_URL`
   - `service_role` 키 → 나중에 `SUPABASE_SERVICE_KEY` (⚠️ 비밀키, 절대 공개 X)

### 3) Vercel (배포)
1. [vercel.com](https://vercel.com) → **Add New → Project** → 1)에서 만든 저장소 Import
2. **Environment Variables** 에 추가:

   | 이름 | 값 | 필수 |
   |---|---|---|
   | `SUPABASE_URL` | 2)에서 복사한 Project URL | ✅ |
   | `SUPABASE_SERVICE_KEY` | 2)에서 복사한 service_role 키 | ✅ |
   | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys | 선택 (AI 생성용) |

3. **Deploy** → 1~2분 후 `https://(내프로젝트).vercel.app/mini/` 열림

> `ANTHROPIC_API_KEY` 없어도 됨 — 그땐 "AI로 생성" 대신 수동 "책 추가"만 사용.
> 🔑 **모든 키는 서버(Vercel 환경변수)에만.** HTML/브라우저 코드에는 절대 넣지 않음.

### 4) 홈 화면 앱처럼 쓰기 (선택)
- 폰 브라우저에서 `/mini/` 열고 "홈 화면에 추가" → PWA로 앱처럼 실행.

---

## 구성 파일

| 파일 | 역할 |
|---|---|
| `api/mini-reader.js` | API 1개 — 이 파일이 서버 전부 (책·퀴즈·배정·결과·녹음·AI생성·리포트) |
| `public/mini/index.html` | **학생 홈** (학생 시작하기 + 맨 아래 🔑 선생님용 링크) |
| `public/mini/reader.html` | **학생**: 배정된 책(제목만) → 단어·녹음·퀴즈 메뉴 (완료 ✓ 표시) |
| `public/mini/admin.html` | **선생님 홈** (관리자 비밀번호 잠금) — 학생·배정·원서 관리로 이동 |
| `public/mini/students.html` | **선생님**: 반·학생·배정·현황 |
| `public/mini/assign.html` | **선생님**: 원서 배정 / 결과 대시보드 (탭) |
| `public/mini/books.html` | **선생님**: AI 생성·목록·수정·삭제 |
| `public/mini/report.html` | **부모용** 학습 리포트 (인쇄/PDF) |
| `public/mini/worksheet.html` | 워크시트 (리딩 이해·라이팅·단어) 출력 |
| `public/mini/admin-guard.js` | 관리 페이지 보호(비밀번호 없으면 admin.html로) |
| `sql/mini-setup.sql` | 세팅 SQL (한 번 실행) |

> 앱 주소: 학생 `/mini/`, 선생님 `/mini/admin.html` (여기서 학생·배정·원서 관리로 이동)
> 🔒 학생 홈에는 관리 메뉴가 안 보이고, 관리 페이지는 **관리자 비밀번호**로 잠글 수 있어요.

## 🎤 클로드에게 "말해서 바꾸기" 예시

| 말하기 | 바뀌는 곳 |
|---|---|
| "대표 색을 분홍색으로 바꿔줘" | 각 HTML `:root` 의 `--brand` |
| "통과 점수를 80점으로 바꿔줘" | `reader.html` `--pass-score` |
| "리포트 학원 이름을 우리 학원으로 바꿔줘" | `report.html` `var ACADEMY` |
| "레벨 목록을 우리 학원 레벨로 바꿔줘" | `books.html` `var LEVELS` |
| "시리즈 목록을 우리 책들로 바꿔줘" | `books.html` `var SERIES` |
| "퀴즈 다 풀면 축하 이모지 크게 보여줘" | `reader.html` 결과 화면 |

## 데이터 구조 요약

| 표 | 용도 |
|---|---|
| `mini_books` | 책 + 3종 퀴즈(words/q1/q2) |
| `mini_classes` | 반 |
| `mini_students` | 학생 |
| `mini_assignments` | 배정 (학생↔책) |
| `mini_results` | 결과 (quiz_type 0/1/2) |
| `mini_recordings` | 녹음 메타 (파일은 Storage `recordings` 버킷) |

전체 스키마는 `sql/mini-setup.sql` 참조.
