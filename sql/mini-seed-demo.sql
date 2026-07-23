-- ============================================================
-- 미니 원서 앱 — 데모(샘플) 데이터
-- Supabase → SQL Editor → New query → 전체 붙여넣기 → Run
-- ⚠️ 먼저 mini-setup.sql 로 테이블을 만든 뒤에 실행하세요.
-- 여러 번 실행해도 중복 안 생김 (이미 있으면 건너뜀).
-- 세미나 데모용 가짜 데이터입니다. 실제로 쓸 땐 지우고 진짜 학생을 넣으세요.
-- 지우기: delete from mini_results; delete from mini_assignments; delete from mini_students; delete from mini_classes;
-- ============================================================

-- 1) 반
insert into mini_classes (name)
select v.name from (values ('초등 A반')) as v(name)
where not exists (select 1 from mini_classes c where c.name = v.name);

-- 2) 학생 6명 (note = 반 이름, student_id = 로그인 아이디)
--    로그인: 학생 화면에서 아이디(예: seojun) + 이름(예: 김서준)
insert into mini_students (name, note, student_id, level)
select v.name, v.note, v.sid, v.level
from (values
  ('김서준', '초등 A반', 'seojun', 'AR 2.5'),
  ('이하은', '초등 A반', 'haeun',  'AR 3.0'),
  ('박도윤', '초등 A반', 'doyun',  'AR 1.5'),
  ('최지우', '초등 A반', 'jiwoo',  'AR 2.0'),
  ('정시아', '초등 A반', 'sia',    'AR 3.5'),
  ('강민준', '초등 A반', 'minjun', 'AR 1.0')
) as v(name, note, sid, level)
where not exists (select 1 from mini_students s where s.name = v.name);

-- 이미 아이디 없이 넣었던 데모 학생에게 아이디 채워주기 (재실행 안전)
update mini_students set student_id='seojun' where name='김서준' and coalesce(student_id,'')='';
update mini_students set student_id='haeun'  where name='이하은' and coalesce(student_id,'')='';
update mini_students set student_id='doyun'  where name='박도윤' and coalesce(student_id,'')='';
update mini_students set student_id='jiwoo'  where name='최지우' and coalesce(student_id,'')='';
update mini_students set student_id='sia'    where name='정시아' and coalesce(student_id,'')='';
update mini_students set student_id='minjun' where name='강민준' and coalesce(student_id,'')='';

-- 3) 책 4권 (단어/원서퀴즈1/원서퀴즈2 개수를 채워 구성 pill 이 보이게 — 내용은 짧게)
insert into mini_books (title, level, series, words, q1, q2, questions)
select v.title, v.level, v.series, v.words::jsonb, v.q1::jsonb, v.q2::jsonb, v.q1::jsonb
from (values
  ('Biscuit Finds a Friend', 'AR 1.0~1.5', 'Biscuit',
    '[{"english":"friend","korean":"친구"},{"english":"play","korean":"놀다"},{"english":"happy","korean":"행복한"}]',
    '[{"question":"Q1","options":["a","b","c","d"],"answer":0},{"question":"Q2","options":["a","b","c","d"],"answer":1}]',
    '[{"question":"Q1","options":["a","b","c","d"],"answer":1}]'),
  ('Frog and Toad Are Friends', 'AR 2.5~2.9', 'Frog and Toad',
    '[{"english":"spring","korean":"봄"},{"english":"wake","korean":"깨우다"},{"english":"garden","korean":"정원"}]',
    '[{"question":"Q1","options":["a","b","c","d"],"answer":1},{"question":"Q2","options":["a","b","c","d"],"answer":0}]',
    '[{"question":"Q1","options":["a","b","c","d"],"answer":1}]'),
  ('Nate the Great', 'AR 2.0~2.9', 'Nate the Great',
    '[{"english":"detective","korean":"탐정"},{"english":"missing","korean":"사라진"},{"english":"clue","korean":"단서"}]',
    '[{"question":"Q1","options":["a","b","c","d"],"answer":0},{"question":"Q2","options":["a","b","c","d"],"answer":1}]',
    '[{"question":"Q1","options":["a","b","c","d"],"answer":1}]'),
  ('Magic Tree House 1', 'AR 2.6~3.5', 'Magic Tree House',
    '[{"english":"treehouse","korean":"나무집"},{"english":"dinosaur","korean":"공룡"},{"english":"travel","korean":"여행하다"}]',
    '[{"question":"Q1","options":["a","b","c","d"],"answer":1},{"question":"Q2","options":["a","b","c","d"],"answer":1}]',
    '[{"question":"Q1","options":["a","b","c","d"],"answer":1}]')
) as v(title, level, series, words, q1, q2)
where not exists (select 1 from mini_books b where b.title = v.title);

-- 4) 배정 (학생 ↔ 책, 이름으로 연결)
insert into mini_assignments (student, book_id)
select v.student, b.id
from (values
  ('김서준','Biscuit Finds a Friend'),
  ('김서준','Frog and Toad Are Friends'),
  ('이하은','Biscuit Finds a Friend'),
  ('이하은','Frog and Toad Are Friends'),
  ('이하은','Nate the Great'),
  ('박도윤','Biscuit Finds a Friend'),
  ('최지우','Biscuit Finds a Friend'),
  ('최지우','Nate the Great'),
  ('정시아','Magic Tree House 1'),
  ('정시아','Frog and Toad Are Friends'),
  ('강민준','Biscuit Finds a Friend')
) as v(student, btitle)
join mini_books b on b.title = v.btitle
on conflict (student, book_id) do nothing;

-- 5) 결과 (quiz_type 0=단어 1=원서1 2=원서2, 점수/10) — 결과 표가 비어있을 때만 넣음
insert into mini_results (student, book_id, score, total, quiz_type)
select v.student, b.id, v.score, v.total, v.quiz_type
from (values
  ('김서준','Biscuit Finds a Friend',10,10,0),
  ('김서준','Biscuit Finds a Friend', 9,10,1),
  ('김서준','Biscuit Finds a Friend', 8,10,2),
  ('김서준','Frog and Toad Are Friends',7,10,1),
  ('이하은','Biscuit Finds a Friend',10,10,0),
  ('이하은','Biscuit Finds a Friend',10,10,1),
  ('이하은','Biscuit Finds a Friend',10,10,2),
  ('이하은','Frog and Toad Are Friends',9,10,0),
  ('이하은','Frog and Toad Are Friends',9,10,1),
  ('이하은','Frog and Toad Are Friends',9,10,2),
  ('이하은','Nate the Great',8,10,1),
  ('박도윤','Biscuit Finds a Friend',8,10,0),
  ('박도윤','Biscuit Finds a Friend',6,10,1),
  ('최지우','Biscuit Finds a Friend',9,10,0),
  ('최지우','Biscuit Finds a Friend',8,10,1),
  ('최지우','Biscuit Finds a Friend',7,10,2),
  ('최지우','Nate the Great',5,10,1),
  ('정시아','Magic Tree House 1',10,10,0),
  ('정시아','Magic Tree House 1', 9,10,1),
  ('정시아','Magic Tree House 1', 9,10,2),
  ('정시아','Frog and Toad Are Friends',8,10,1),
  ('정시아','Frog and Toad Are Friends',8,10,2),
  ('강민준','Biscuit Finds a Friend',7,10,0)
) as v(student, btitle, score, total, quiz_type)
join mini_books b on b.title = v.btitle
where not exists (select 1 from mini_results);
