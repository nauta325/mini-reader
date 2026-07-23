-- ============================================================
-- 미니 원서 앱 — 데모(샘플) 데이터
-- Supabase → SQL Editor → New query → 전체 붙여넣기 → Run
-- ⚠️ 먼저 mini-setup.sql 로 테이블을 만든 뒤에 실행하세요.
-- 여러 번 실행해도 중복 안 생김 (이미 있으면 건너뜀).
-- 세미나 데모용 가짜 데이터입니다 — 실제로 쓸 땐 지우고 진짜 학생을 넣으세요.
--   지우기:  delete from mini_results; delete from mini_assignments;
--            delete from mini_students; delete from mini_classes;
--            delete from mini_books where series in ('Biscuit','Frog and Toad','Nate the Great','Magic Tree House');
-- ============================================================

-- 1) 반
insert into mini_classes (name)
select v.name from (values ('초등 A반')) as v(name)
where not exists (select 1 from mini_classes c where c.name = v.name);

-- 2) 학생 6명 (note = 반 이름)
insert into mini_students (name, note, level)
select v.name, v.note, v.level
from (values
  ('김서준', '초등 A반', 'AR 2.5'),
  ('이하은', '초등 A반', 'AR 3.0'),
  ('박도윤', '초등 A반', 'AR 1.5'),
  ('최지우', '초등 A반', 'AR 2.0'),
  ('정시아', '초등 A반', 'AR 3.5'),
  ('강민준', '초등 A반', 'AR 1.0')
) as v(name, note, level)
where not exists (select 1 from mini_students s where s.name = v.name);

-- 3) 책 4권 (단어카드/원서퀴즈1/원서퀴즈2 채워서 구성 pill 이 보이게)
insert into mini_books (title, level, series, words, q1, q2, questions)
select v.title, v.level, v.series, v.words::jsonb, v.q1::jsonb, v.q2::jsonb, v.q1::jsonb
from (values
  ('Biscuit Finds a Friend', 'AR 1.0~1.5', 'Biscuit',
    '[{"english":"friend","korean":"친구","word_class":"명사","example":"Biscuit finds a new friend."},{"english":"play","korean":"놀다","word_class":"동사","example":"They play together."},{"english":"happy","korean":"행복한","word_class":"형용사","example":"Biscuit is happy."}]',
    '[{"question":"Who does Biscuit find?","options":["A friend","A bone","A ball","A hat"],"answer":0},{"question":"How does Biscuit feel?","options":["Sad","Happy","Angry","Tired"],"answer":1}]',
    '[{"question":"What do they do together?","options":["Sleep","Play","Cry","Eat"],"answer":1}]'),
  ('Frog and Toad Are Friends', 'AR 2.5~2.9', 'Frog and Toad',
    '[{"english":"spring","korean":"봄","word_class":"명사","example":"It is spring now."},{"english":"wake","korean":"깨우다","word_class":"동사","example":"Frog wants to wake Toad."},{"english":"garden","korean":"정원","word_class":"명사","example":"They work in the garden."}]',
    '[{"question":"What season is it?","options":["Winter","Spring","Summer","Fall"],"answer":1},{"question":"Who wants to wake up Toad?","options":["Frog","Bird","Mouse","Snake"],"answer":0}]',
    '[{"question":"How did Frog help Toad?","options":["Sang a song","Tore the calendar pages","Made soup","Ran away"],"answer":1}]'),
  ('Nate the Great', 'AR 2.0~2.9', 'Nate the Great',
    '[{"english":"detective","korean":"탐정","word_class":"명사","example":"Nate is a great detective."},{"english":"missing","korean":"사라진","word_class":"형용사","example":"The picture is missing."},{"english":"clue","korean":"단서","word_class":"명사","example":"Nate looks for a clue."}]',
    '[{"question":"What is Nate?","options":["A detective","A teacher","A chef","A pilot"],"answer":0},{"question":"What is missing?","options":["A dog","A picture","A book","A coin"],"answer":1}]',
    '[{"question":"What does Nate look for?","options":["Food","A clue","A friend","A hat"],"answer":1}]'),
  ('Magic Tree House: Dinosaurs', 'AR 2.6~3.5', 'Magic Tree House',
    '[{"english":"tree house","korean":"나무집","word_class":"명사","example":"They climb into the tree house."},{"english":"dinosaur","korean":"공룡","word_class":"명사","example":"They meet a dinosaur."},{"english":"travel","korean":"여행하다","word_class":"동사","example":"They travel through time."}]',
    '[{"question":"Where do Jack and Annie go?","options":["The moon","The dinosaur time","The ocean","The desert"],"answer":1},{"question":"What do they climb into?","options":["A car","A tree house","A boat","A plane"],"answer":1}]',
    '[{"question":"How do they travel?","options":["By bus","Through time","By train","On foot"],"answer":1}]')
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
  ('정시아','Magic Tree House: Dinosaurs'),
  ('정시아','Frog and Toad Are Friends'),
  ('강민준','Biscuit Finds a Friend')
) as v(student, btitle)
join mini_books b on b.title = v.btitle
on conflict (student, book_id) do nothing;

-- 5) 결과 (quiz_type 0=단어 1=원서1 2=원서2, 점수/10) — 결과 표가 비어있을 때만 넣음
insert into mini_results (student, book_id, score, total, quiz_type)
select v.student, b.id, v.score, v.total, v.quiz_type
from (values
  -- 김서준: Biscuit 완독(80), Frog 진행중
  ('김서준','Biscuit Finds a Friend',10,10,0),
  ('김서준','Biscuit Finds a Friend', 9,10,1),
  ('김서준','Biscuit Finds a Friend', 8,10,2),
  ('김서준','Frog and Toad Are Friends',7,10,1),
  -- 이하은: 우등생, 2권 완독
  ('이하은','Biscuit Finds a Friend',10,10,0),
  ('이하은','Biscuit Finds a Friend',10,10,1),
  ('이하은','Biscuit Finds a Friend',10,10,2),
  ('이하은','Frog and Toad Are Friends',9,10,0),
  ('이하은','Frog and Toad Are Friends',9,10,1),
  ('이하은','Frog and Toad Are Friends',9,10,2),
  ('이하은','Nate the Great',8,10,1),
  -- 박도윤: 시작 단계, 원서1 미통과
  ('박도윤','Biscuit Finds a Friend',8,10,0),
  ('박도윤','Biscuit Finds a Friend',6,10,1),
  -- 최지우: Biscuit 완독(70), Nate 진행중
  ('최지우','Biscuit Finds a Friend',9,10,0),
  ('최지우','Biscuit Finds a Friend',8,10,1),
  ('최지우','Biscuit Finds a Friend',7,10,2),
  ('최지우','Nate the Great',5,10,1),
  -- 정시아: 2권 완독
  ('정시아','Magic Tree House: Dinosaurs',10,10,0),
  ('정시아','Magic Tree House: Dinosaurs', 9,10,1),
  ('정시아','Magic Tree House: Dinosaurs', 9,10,2),
  ('정시아','Frog and Toad Are Friends',8,10,1),
  ('정시아','Frog and Toad Are Friends',8,10,2),
  -- 강민준: 단어만 시작
  ('강민준','Biscuit Finds a Friend',7,10,0)
) as v(student, btitle, score, total, quiz_type)
join mini_books b on b.title = v.btitle
where not exists (select 1 from mini_results);
