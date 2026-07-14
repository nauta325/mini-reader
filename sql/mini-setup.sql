-- ============================================================
-- 미니 원서 앱 — 세팅 SQL (한 번에 복사·붙여넣기 → 실행)
-- Supabase → SQL Editor → New query → 전체 붙여넣기 → Run
-- 여러 번 실행해도 안전 (이미 있으면 무시).
-- ============================================================

-- 1) 책 (제목/레벨/시리즈 + 단어카드 words / 원서퀴즈1 q1 / 원서퀴즈2 q2)
create table if not exists mini_books (
  id        bigint generated always as identity primary key,
  title     text not null,
  level     text,
  series    text,
  words     jsonb not null default '[]',   -- [{english,korean,word_class,example}]
  q1        jsonb not null default '[]',   -- [{question,options,answer}]  원서퀴즈1
  q2        jsonb not null default '[]',   -- [{question,options,answer}]  원서퀴즈2
  questions jsonb not null default '[]'    -- (구버전 호환) = q1
);
-- 이미 mini_books가 있던 경우 새 컬럼 보강
alter table mini_books add column if not exists level    text;
alter table mini_books add column if not exists series   text;
alter table mini_books add column if not exists words    jsonb default '[]';
alter table mini_books add column if not exists q1       jsonb default '[]';
alter table mini_books add column if not exists q2       jsonb default '[]';
alter table mini_books add column if not exists questions jsonb default '[]';
alter table mini_books add column if not exists passage  text;   -- 워크시트 재생성용 원문
alter table mini_books add column if not exists chapter  int;    -- 챕터북: 챕터 번호 (null=책 전체/그림책)
alter table mini_books add column if not exists video_url text;  -- 유튜브 읽어주기 영상 링크 (선택)

-- 2) 반
create table if not exists mini_classes (
  id   bigint generated always as identity primary key,
  name text not null
);

-- 3) 학생 (note = 반 이름, student_id = 로그인용 아이디)
create table if not exists mini_students (
  id         bigint generated always as identity primary key,
  name       text not null,
  note       text,
  student_id text,
  phone      text,
  level      text,
  created_at timestamptz not null default now()
);
-- 이미 mini_students가 있던 경우 새 컬럼 보강
alter table mini_students add column if not exists student_id text;
alter table mini_students add column if not exists phone      text;
alter table mini_students add column if not exists level      text;

-- 4) 배정 (학생 ↔ 책)
create table if not exists mini_assignments (
  id         bigint generated always as identity primary key,
  student    text not null,
  book_id    bigint not null,
  created_at timestamptz not null default now(),
  unique (student, book_id)
);

-- 5) 결과 (quiz_type: 0=단어, 1=원서퀴즈1, 2=원서퀴즈2)
create table if not exists mini_results (
  id         bigint generated always as identity primary key,
  student    text not null,
  book_id    bigint not null,
  score      int,
  total      int,
  quiz_type  int default 1,
  created_at timestamptz not null default now()
);
alter table mini_results add column if not exists quiz_type int default 1;

-- 6) 녹음 메타 (실제 파일은 Storage 'recordings' 버킷)
create table if not exists mini_recordings (
  id         bigint generated always as identity primary key,
  student    text not null,
  book_id    bigint not null,
  path       text not null,
  created_at timestamptz not null default now()
);

-- 6-1) 워크시트 저장 (한 번 만들면 보관 — 다시 열기/인쇄)
create table if not exists mini_worksheets (
  id         bigint generated always as identity primary key,
  book_id    bigint,
  type       text not null,          -- reading | writing | vocab
  stage      text,                   -- 기초 | 중급 | 심화
  title      text,
  items      jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- 6-2) 앱 설정 (key/value) — 예: english_level = 영어 출제 시작 레벨
create table if not exists mini_settings (
  key   text primary key,
  value text
);

-- 7) 녹음 저장용 스토리지 버킷 (Private)
insert into storage.buckets (id, name, public) values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- ============================================================
-- 샘플 책 (표가 비어있을 때만 넣음) — 바로 데모되게 3종 퀴즈 포함
-- ============================================================
insert into mini_books (title, level, series, words, q1, q2, questions)
select
  'Biscuit Goes to School', 'AR 1.0~1.5', 'Biscuit',
  '[{"english":"school","korean":"학교","word_class":"명사","example":"Biscuit goes to school."},
    {"english":"puppy","korean":"강아지","word_class":"명사","example":"Biscuit is a little puppy."},
    {"english":"friend","korean":"친구","word_class":"명사","example":"Biscuit makes a new friend."}]',
  '[{"question":"What is Biscuit?","options":["A dog","A cat","A boy","A bird"],"answer":0},
    {"question":"Where does Biscuit go?","options":["Park","School","Home","Shop"],"answer":1}]',
  '[{"question":"How does Biscuit feel at school?","options":["Happy","Sad","Angry","Sleepy"],"answer":0}]',
  '[{"question":"What is Biscuit?","options":["A dog","A cat","A boy","A bird"],"answer":0},
    {"question":"Where does Biscuit go?","options":["Park","School","Home","Shop"],"answer":1}]'
where not exists (select 1 from mini_books);
