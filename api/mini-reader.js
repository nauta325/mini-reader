// ─────────────────────────────────────────────────────────────
// 미니 원서 앱 API — 이 파일 하나가 서버 전부입니다 (Vercel + Supabase)
// ─────────────────────────────────────────────────────────────
// 테이블 (생성 SQL: sql/mini-setup.sql):
//   mini_books       책/챕터 (단어카드 words · 원서퀴즈1 q1 · 원서퀴즈2 q2 · 지문 · 영상링크)
//   mini_classes     반
//   mini_students    학생 (아이디·전화·레벨·반)
//   mini_assignments 배정 (학생↔책)
//   mini_results     퀴즈 결과 (quiz_type: 0=단어 1=원서1 2=원서2)
//   mini_recordings  녹음 메타 (파일은 Storage 'recordings' 버킷)
//   mini_worksheets  워크시트 저장
//   mini_settings    설정 (영어 출제 시작 레벨, 시리즈 목록)
//
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY (필수) / ANTHROPIC_API_KEY (AI 생성용, 선택) / NOTION_TOKEN (노션 가져오기용, 선택)
//
// 액션 그룹:
//   설정      settings · set-settings · rename-series
//   관리자    admin-login(비번확인) · admin-set-pass(비번설정/변경) — 비번은 mini_settings.admin_pass 에 저장, 클라이언트로 절대 안 보냄
//   반        classes · add-class · update-class · delete-class
//   학생      students · add-student · bulk-students · notion-import(노션DB) · update-student · delete-student · student-login
//   배정      assign(wholeTitle=전체챕터) · unassign · assignments
//   책        books · book-list · book-detail · add-book · update-book · delete-book · generate(AI)
//   학습      quiz · submit · upload-recording · recordings · results · overview(현황/리포트)
//   워크시트  worksheet(생성+저장) · worksheet-list · worksheet-detail · delete-worksheet

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
// 노션 학생 DB 가져오기용 (선택) — Vercel 환경변수에만! HTML/브라우저에 넣지 말 것
const NOTION_TOKEN = process.env.NOTION_TOKEN;

// Supabase REST 호출 (아주 단순 — 데이터베이스 주소로 요청 보내기)
async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: opts.method || 'GET',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body,
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// 표시용 제목: 챕터북이면 "제목 Ch.3" (챕터별로 한 행씩 등록)
const dispTitle = (b) => (b ? String(b.title || '') + (b.chapter ? ' Ch.' + b.chapter : '') : '');

// ── 학생 일괄 삽입 (붙여넣기·노션 공용) ──
// opts.dedup=true 면 이미 있는 이름은 건너뜀 (노션 재가져오기 대비)
async function bulkInsertStudents(students, opts = {}) {
  let rows = (students || []).filter((s) => s && s.name).map((s) => ({
    name: String(s.name).trim(),
    student_id: s.student_id ? String(s.student_id).trim() : '',
    phone: s.phone ? String(s.phone).trim() : '',
    level: s.level ? String(s.level).trim() : '',
    note: s.note ? String(s.note).trim() : '',
  }));
  if (!rows.length) return { added: 0, skipped: 0 };
  let skipped = 0;
  if (opts.dedup) {
    const existing = await sb('mini_students?select=name');
    const have = new Set((existing || []).map((s) => (s.name || '').trim().toLowerCase()));
    const before = rows.length;
    rows = rows.filter((r) => !have.has(r.name.toLowerCase()));
    skipped = before - rows.length;
  }
  // 새로 등장한 반 이름은 자동 생성 (드롭다운에 바로 뜨게)
  const notes = Array.from(new Set(rows.map((r) => r.note).filter(Boolean)));
  if (notes.length) {
    const existing = await sb('mini_classes?select=name');
    const have = new Set((existing || []).map((c) => c.name));
    const toAdd = notes.filter((n) => !have.has(n)).map((n) => ({ name: n }));
    if (toAdd.length) await sb('mini_classes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(toAdd) });
  }
  if (rows.length) await sb('mini_students', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  return { added: rows.length, skipped };
}

// ── 노션 API 헬퍼 (순수 fetch, npm 패키지 없음) ──
// 노션 속성 1개 → 문자열 (title/rich_text/select/phone 등 흔한 타입 지원)
function notionText(prop) {
  if (!prop) return '';
  switch (prop.type) {
    case 'title': return (prop.title || []).map((t) => t.plain_text).join('').trim();
    case 'rich_text': return (prop.rich_text || []).map((t) => t.plain_text).join('').trim();
    case 'select': return prop.select ? prop.select.name : '';
    case 'status': return prop.status ? prop.status.name : '';
    case 'multi_select': return (prop.multi_select || []).map((o) => o.name).join(', ');
    case 'phone_number': return prop.phone_number || '';
    case 'email': return prop.email || '';
    case 'url': return prop.url || '';
    case 'number': return prop.number == null ? '' : String(prop.number);
    case 'people': return (prop.people || []).map((p) => p.name || '').join(', ');
    case 'formula': return prop.formula ? (prop.formula.string || (prop.formula.number != null ? String(prop.formula.number) : '')) : '';
    case 'rollup': {
      const r = prop.rollup;
      if (!r) return '';
      if (r.type === 'array') return (r.array || []).map(notionText).join(', ');
      if (r.type === 'number') return r.number == null ? '' : String(r.number);
      return '';
    }
    default: return '';
  }
}
// 노션 페이지 properties → {name, student_id, phone, level, note} (열 이름으로 자동 매핑)
function mapNotionRow(props) {
  const out = { name: '', student_id: '', phone: '', level: '', note: '' };
  Object.keys(props || {}).forEach((key) => {
    const p = props[key], val = notionText(p);
    if (p && p.type === 'title' && !out.name) { out.name = val; return; }  // 제목 열 = 이름
    if (!val) return;
    if (/이름|성함|name/i.test(key) && !out.name) out.name = val;
    else if (/아이디|로그인|login/i.test(key) || /^id$/i.test(key.trim())) { if (!out.student_id) out.student_id = val; }
    else if (/전화|연락처|폰|번호|phone|tel|hp/i.test(key)) { if (!out.phone) out.phone = val; }
    else if (/레벨|수준|level/i.test(key)) { if (!out.level) out.level = val; }
    else if (/반|클래스|그룹|class|group/i.test(key)) { if (!out.note) out.note = val; }
  });
  return out;
}
// URL 또는 ID 문자열에서 노션 DB id(32 hex) 추출 (뒤의 ?v=뷰id 제거)
function parseNotionDbId(input) {
  const s = String(input || '').trim().split('?')[0];
  const hex = s.replace(/-/g, '').match(/[0-9a-fA-F]{32}/g);
  return hex ? hex[hex.length - 1] : '';
}
// 노션 데이터베이스 전체 조회 (페이지네이션)
async function notionQueryDB(dbId) {
  let results = [], cursor = null, guard = 0;
  do {
    const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NOTION_TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
      body: JSON.stringify(cursor ? { start_cursor: cursor, page_size: 100 } : { page_size: 100 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Notion ' + r.status + ': ' + String((j && j.message) || JSON.stringify(j)).slice(0, 200));
    results = results.concat(j.results || []);
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor && ++guard < 20);
  return results;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.body && req.body.action);
  try {
    // ── 앱 설정 조회 / 저장 (key/value) ──
    if (req.method === 'GET' && action === 'settings') {
      const rows = await sb('mini_settings?select=key,value');
      const map = {}; (rows || []).forEach((r) => { if (r.key !== 'admin_pass') map[r.key] = r.value; });  // 관리자 비번은 절대 내보내지 않음
      return res.json({ ok: true, settings: map });
    }
    if (req.method === 'POST' && action === 'set-settings') {
      const { key, value } = req.body || {};
      if (!key) return res.status(400).json({ ok: false, message: 'key 필요' });
      await sb('mini_settings?on_conflict=key', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key, value: String(value == null ? '' : value) }),
      });
      return res.json({ ok: true });
    }

    // ── 관리자 비밀번호 확인 (학생이 선생님 화면 못 보게) ──
    //   비번은 mini_settings.admin_pass 에만 있고, 여기서 맞는지만 확인해 줌 (값은 안 돌려줌)
    if (req.method === 'POST' && action === 'admin-login') {
      const rows = await sb('mini_settings?key=eq.admin_pass&select=value');
      const need = (rows && rows[0] && rows[0].value) || '';
      if (!need) return res.json({ ok: true, open: true });   // 아직 비번 없음 = 잠금 없음(설정 권장)
      const got = (req.body && req.body.passcode) || '';
      if (got === need) return res.json({ ok: true });
      return res.json({ ok: false, message: '비밀번호가 달라요' });
    }
    // ── 관리자 비밀번호 설정/변경 ──
    if (req.method === 'POST' && action === 'admin-set-pass') {
      const rows = await sb('mini_settings?key=eq.admin_pass&select=value');
      const cur = (rows && rows[0] && rows[0].value) || '';
      const next = (req.body && req.body.passcode) || '';
      if (!next) return res.status(400).json({ ok: false, message: '새 비밀번호를 입력하세요' });
      if (cur && (req.body.current || '') !== cur) return res.status(403).json({ ok: false, message: '현재 비밀번호가 달라요' });
      await sb('mini_settings?on_conflict=key', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key: 'admin_pass', value: String(next) }),
      });
      return res.json({ ok: true });
    }

    // ── (선생님) 시리즈 이름 변경 → 기존 책들도 연동 ──
    if (req.method === 'POST' && action === 'rename-series') {
      const { from, to } = req.body || {};
      if (!from || !to) return res.status(400).json({ ok: false, message: 'from·to 필요' });
      await sb('mini_books?series=eq.' + encodeURIComponent(from), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ series: to }) });
      return res.json({ ok: true });
    }

    // ── 반 목록 / 추가 ──
    if (req.method === 'GET' && action === 'classes') {
      const classes = await sb('mini_classes?select=id,name&order=name.asc');
      return res.json({ ok: true, classes });
    }
    if (req.method === 'POST' && action === 'add-class') {
      const { name } = req.body || {};
      if (!name) return res.status(400).json({ ok: false, message: '반 이름이 필요해요' });
      await sb('mini_classes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name }) });
      return res.json({ ok: true });
    }
    // ── (선생님) 반 이름 수정 (반 이름 바뀌면 학생 소속도 연동) ──
    if (req.method === 'POST' && action === 'update-class') {
      const { id, name } = req.body || {};
      if (!id || !name) return res.status(400).json({ ok: false, message: 'id·반 이름 필요' });
      const cur = await sb('mini_classes?id=eq.' + encodeURIComponent(id) + '&select=name');
      const oldName = cur && cur[0] ? cur[0].name : null;
      await sb('mini_classes?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name }) });
      if (oldName && oldName !== name) {
        await sb('mini_students?note=eq.' + encodeURIComponent(oldName), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ note: name }) });
      }
      return res.json({ ok: true });
    }
    // ── (선생님) 반 삭제 (학생 소속은 비움) ──
    if (req.method === 'POST' && action === 'delete-class') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: 'id 필요' });
      const cur = await sb('mini_classes?id=eq.' + encodeURIComponent(id) + '&select=name');
      const nm = cur && cur[0] ? cur[0].name : null;
      await sb('mini_classes?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (nm) await sb('mini_students?note=eq.' + encodeURIComponent(nm), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ note: '' }) });
      return res.json({ ok: true });
    }

    // ── 학생 목록 ──
    if (req.method === 'GET' && action === 'students') {
      const students = await sb('mini_students?select=id,name,note,student_id,phone,level&order=name.asc');
      return res.json({ ok: true, students });
    }

    // ── (선생님) 학생 등록 ──
    if (req.method === 'POST' && action === 'add-student') {
      const { name, note, student_id, phone, level } = req.body || {};
      if (!name) return res.status(400).json({ ok: false, message: '학생 이름이 필요해요' });
      await sb('mini_students', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ name, note: note || '', student_id: student_id || '', phone: phone || '', level: level || '' }),
      });
      return res.json({ ok: true });
    }

    // ── (선생님) 학생 일괄 등록 (붙여넣기 — 전체학생DB에서 복사) ──
    if (req.method === 'POST' && action === 'bulk-students') {
      const { students } = req.body || {};
      if (!Array.isArray(students)) return res.status(400).json({ ok: false, message: '학생 목록이 필요해요' });
      const { added } = await bulkInsertStudents(students);
      if (!added) return res.status(400).json({ ok: false, message: '이름이 있는 행이 없어요' });
      return res.json({ ok: true, added });
    }

    // ── (선생님) 노션 학생 DB 가져오기 (dry_run=true면 미리보기만) ──
    if (req.method === 'POST' && action === 'notion-import') {
      if (!NOTION_TOKEN) return res.status(400).json({ ok: false, message: 'NOTION_TOKEN 환경변수가 없어요. Vercel에 노션 통합 토큰을 넣어주세요.' });
      const { database, dry_run } = req.body || {};
      const dbId = parseNotionDbId(database);
      if (!dbId) return res.status(400).json({ ok: false, message: '노션 데이터베이스 링크(또는 ID)를 확인해 주세요.' });
      const pages = await notionQueryDB(dbId);
      const students = pages.map((pg) => mapNotionRow(pg.properties || {})).filter((s) => s.name);
      if (!students.length) return res.status(400).json({ ok: false, message: '이름이 있는 학생을 못 찾았어요. 노션 표에 제목(이름) 열이 있고, 통합에 공유했는지 확인해 주세요.' });
      if (dry_run) return res.json({ ok: true, students, count: students.length });
      const { added, skipped } = await bulkInsertStudents(students, { dedup: true });
      return res.json({ ok: true, added, skipped });
    }

    // ── (선생님) 학생 정보 수정 (이름 바뀌면 배정·결과·녹음도 연동) ──
    if (req.method === 'POST' && action === 'update-student') {
      const { id, name, note, student_id, phone, level } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: 'id 필요' });
      const cur = await sb('mini_students?id=eq.' + encodeURIComponent(id) + '&select=name');
      const oldName = cur && cur[0] ? cur[0].name : null;
      const patch = {};
      if (name != null) patch.name = name;
      if (note != null) patch.note = note;
      if (student_id != null) patch.student_id = student_id;
      if (phone != null) patch.phone = phone;
      if (level != null) patch.level = level;
      await sb('mini_students?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      // 이름이 바뀌면 name을 키로 쓰는 데이터도 함께 갱신 (고아 방지)
      if (name != null && oldName && name !== oldName) {
        for (const t of ['mini_assignments', 'mini_results', 'mini_recordings']) {
          await sb(t + '?student=eq.' + encodeURIComponent(oldName), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ student: name }) });
        }
      }
      return res.json({ ok: true });
    }

    // ── 학생 로그인 (아이디 + 이름) ──
    if (req.method === 'POST' && action === 'student-login') {
      const { student_id, name } = req.body || {};
      const nm = (name || '').trim();
      if (!nm) return res.status(400).json({ ok: false, message: '이름을 입력하세요' });
      const rows = await sb('mini_students?name=ilike.' + encodeURIComponent(nm) + '&select=name,student_id');
      // 등록된 아이디가 있으면 일치해야 하고, 없으면 이름만으로 허용
      const found = (rows || []).find((r) => !r.student_id
        || String(r.student_id).trim().toLowerCase() === String(student_id || '').trim().toLowerCase());
      if (!found) return res.json({ ok: false, message: '아이디 또는 이름이 맞지 않아요' });
      return res.json({ ok: true, name: found.name });
    }

    // ── (선생님) 학생 삭제 (배정도 함께 삭제, 결과·녹음은 기록으로 남김) ──
    if (req.method === 'POST' && action === 'delete-student') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: 'id 필요' });
      const cur = await sb('mini_students?id=eq.' + encodeURIComponent(id) + '&select=name');
      const nm = cur && cur[0] ? cur[0].name : null;
      await sb('mini_students?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (nm) await sb('mini_assignments?student=eq.' + encodeURIComponent(nm), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return res.json({ ok: true });
    }

    // ── 책 배정 (학생 개별 또는 반 전체) ──
    if (req.method === 'POST' && action === 'assign') {
      const { book, student, cls, wholeTitle } = req.body || {};
      if (!book) return res.status(400).json({ ok: false, message: '책이 필요해요' });
      let names = [];
      if (student) names = [student];
      else if (cls) {
        const rows = await sb('mini_students?note=eq.' + encodeURIComponent(cls) + '&select=name');
        names = (rows || []).map((r) => r.name);
      }
      if (!names.length) return res.status(400).json({ ok: false, message: '배정 대상이 없어요' });
      // 챕터북: wholeTitle=true면 같은 제목의 모든 챕터를 한 번에 배정
      let bookIds = [book];
      if (wholeTitle) {
        const cur = await sb('mini_books?id=eq.' + encodeURIComponent(book) + '&select=title');
        if (cur && cur[0]) {
          const all = await sb('mini_books?title=eq.' + encodeURIComponent(cur[0].title) + '&select=id&order=chapter.asc');
          if (all && all.length) bookIds = all.map((r) => r.id);
        }
      }
      const pairs = [];
      names.forEach((n) => bookIds.forEach((id) => pairs.push({ student: n, book_id: id })));
      await sb('mini_assignments?on_conflict=student,book_id', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(pairs),
      });
      return res.json({ ok: true, count: pairs.length });
    }

    // ── 배정 취소 ──
    if (req.method === 'POST' && action === 'unassign') {
      const { student, book } = req.body || {};
      if (!student || !book) return res.status(400).json({ ok: false, message: 'student, book 필요' });
      await sb('mini_assignments?student=eq.' + encodeURIComponent(student) + '&book_id=eq.' + encodeURIComponent(book), {
        method: 'DELETE', headers: { Prefer: 'return=minimal' },
      });
      return res.json({ ok: true });
    }

    // ── 배정 조회: 학생 지정 시 그 학생 책, 없으면 전체 ──
    if (req.method === 'GET' && action === 'assignments') {
      const books = await sb('mini_books?select=id,title,level,chapter');
      const titleOf = {}; const infoOf = {};
      (books || []).forEach((b) => { titleOf[b.id] = dispTitle(b); infoOf[b.id] = b; });
      if (req.query.student) {
        const st = req.query.student;
        const [a, results, recs] = await Promise.all([
          sb('mini_assignments?student=eq.' + encodeURIComponent(st) + '&select=book_id'),
          sb('mini_results?student=eq.' + encodeURIComponent(st) + '&select=book_id,score,total,quiz_type,created_at&order=created_at.desc'),
          sb('mini_recordings?student=eq.' + encodeURIComponent(st) + '&select=book_id'),
        ]);
        // 책|종류(0/1/2)별 최신 결과
        const resMap = {}; (results || []).forEach((r) => {
          const t = r.quiz_type == null ? 1 : r.quiz_type;
          const k = r.book_id + '|' + t;
          if (!resMap[k]) resMap[k] = r;
        });
        const recSet = new Set((recs || []).map((r) => r.book_id));   // 녹음한 책 → 완료 ✓ 유지
        const books = (a || []).map((x) => {
          const info = infoOf[x.book_id]; if (!info) return null;
          const status = {};
          [0, 1, 2].forEach((t) => {
            const rr = resMap[x.book_id + '|' + t];
            status[t] = rr && rr.total ? { percent: Math.round(rr.score / rr.total * 100) } : null;
          });
          status.rec = recSet.has(x.book_id);
          return { id: info.id, title: dispTitle(info), level: info.level, chapter: info.chapter, status };
        }).filter(Boolean);
        return res.json({ ok: true, books });
      }
      const rows = await sb('mini_assignments?select=student,book_id,created_at&order=student.asc');
      return res.json({ ok: true, assignments: (rows || []).map((r) => ({ student: r.student, book_id: r.book_id, title: titleOf[r.book_id] || ('#' + r.book_id) })) });
    }

    // ── 학생별 현황: 배정된 책 + 결과 + 녹음 (반 필터) ──
    if (req.method === 'GET' && action === 'overview') {
      const cls = req.query.class;
      const one = req.query.student;   // 리포트: 학생 1명만
      let sPath = 'mini_students?select=name,note&order=name.asc';
      if (one) sPath += '&name=eq.' + encodeURIComponent(one);
      else if (cls) sPath += '&note=eq.' + encodeURIComponent(cls);
      const [students, assigns, results, recs, books] = await Promise.all([
        sb(sPath),
        sb('mini_assignments?select=student,book_id'),
        sb('mini_results?select=student,book_id,score,total,quiz_type,created_at&order=created_at.desc'),
        sb('mini_recordings?select=student,book_id,path,created_at&order=created_at.desc'),
        sb('mini_books?select=id,title,level,chapter'),
      ]);
      const infoOf = {}; (books || []).forEach((b) => { infoOf[b.id] = b; });
      // 퀴즈 종류(0/1/2)별로 최신 결과 (created_at.desc라 먼저 나오는 게 최신)
      const resMap = {}; (results || []).forEach((r) => {
        const t = r.quiz_type == null ? 1 : r.quiz_type;
        const k = r.student + '|' + r.book_id + '|' + t;
        if (!resMap[k]) resMap[k] = r;
      });
      const recMap = {}; (recs || []).forEach((x) => { const k = x.student + '|' + x.book_id; if (!recMap[k]) recMap[k] = x.path; });
      const asgMap = {}; (assigns || []).forEach((a) => { (asgMap[a.student] = asgMap[a.student] || []).push(a.book_id); });

      const out = [];
      for (const s of (students || [])) {
        const ids = {};
        (asgMap[s.name] || []).forEach((id) => { ids[id] = true; });
        (results || []).forEach((r) => { if (r.student === s.name) ids[r.book_id] = true; });
        const rows = [];
        for (const id of Object.keys(ids)) {
          const info = infoOf[id] || {}; const k = s.name + '|' + id;
          let audio = ''; const path = recMap[k];
          if (path) {
            try {
              const sg = await fetch(`${SB_URL}/storage/v1/object/sign/recordings/${path}`, {
                method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' },
                body: JSON.stringify({ expiresIn: 3600 }),
              });
              if (sg.ok) { const j = await sg.json(); audio = SB_URL + '/storage/v1' + j.signedURL; }
            } catch (e) { /* skip */ }
          }
          // 퀴즈 종류(0=단어,1=원서1,2=원서2)별 결과
          const quizzes = {};
          [0, 1, 2].forEach((t) => {
            const rr = resMap[s.name + '|' + id + '|' + t];
            quizzes[t] = rr && rr.total ? { percent: Math.round(rr.score / rr.total * 100), score: rr.score, total: rr.total } : null;
          });
          rows.push({
            book_id: Number(id), title: dispTitle(info) || ('#' + id), level: info.level || '',
            assigned: (asgMap[s.name] || []).indexOf(Number(id)) > -1 || (asgMap[s.name] || []).indexOf(id) > -1,
            quizzes, audio,
          });
        }
        // 월별 추이 — 원서 퀴즈(1·2)의 모든 시도를 달(YYYY-MM)별로 집계
        const mAcc = {};
        (results || []).forEach((r) => {
          if (r.student !== s.name) return;
          const t = r.quiz_type == null ? 1 : r.quiz_type;
          if (t !== 1 && t !== 2) return;      // 단어(0) 제외, 원서 퀴즈만
          if (!r.total) return;
          const m = (r.created_at || '').slice(0, 7);   // YYYY-MM
          if (!m) return;
          const p = Math.round(r.score / r.total * 100);
          const e = mAcc[m] || (mAcc[m] = { count: 0, sum: 0 });
          e.count++; e.sum += p;
        });
        const monthly = Object.keys(mAcc).sort().map((m) => ({
          month: m, count: mAcc[m].count, avg: Math.round(mAcc[m].sum / mAcc[m].count),
        }));
        out.push({ student: s.name, cls: s.note || '', books: rows, monthly });
      }
      return res.json({ ok: true, students: out });
    }

    // ── 책 목록 (학생 화면) ──
    if (req.method === 'GET' && action === 'books') {
      const rows = await sb('mini_books?select=id,title,level,series,chapter&order=title.asc,chapter.asc');
      // title=표시용(챕터 포함), rawTitle=원제목 (전체 챕터 배정 그룹용)
      const books = (rows || []).map((b) => ({ id: b.id, title: dispTitle(b), rawTitle: b.title, chapter: b.chapter, level: b.level, series: b.series || '' }));
      return res.json({ ok: true, books });
    }

    // ── (선생님) 책 목록 + 문제 수 ──
    if (req.method === 'GET' && action === 'book-list') {
      const rows = await sb('mini_books?select=id,title,level,series,chapter,words,q1,q2,questions&order=title.asc,chapter.asc');
      return res.json({ ok: true, books: (rows || []).map(function (b) {
        return { id: b.id, title: b.title, level: b.level, series: b.series, chapter: b.chapter,
          words: (b.words || []).length, q1: (b.q1 || b.questions || []).length, q2: (b.q2 || []).length };
      }) });
    }

    // ── (선생님) 책 상세 (수정용) ──
    // select=* 로 읽어서, DB에 video_url·passage 같은 선택 열이 아직 없어도 에러 안 나게 함
    // (열을 콕 집으면 스키마 캐시가 어긋날 때 42703이 남)
    if (req.method === 'GET' && action === 'book-detail') {
      const rows = await sb('mini_books?id=eq.' + encodeURIComponent(req.query.id) + '&select=*');
      if (!rows || !rows.length) return res.status(404).json({ ok: false, message: '책 없음' });
      const b = rows[0];
      return res.json({ ok: true, book: { id: b.id, title: b.title, level: b.level, series: b.series, chapter: b.chapter, video_url: b.video_url || '', words: b.words || [], q1: (b.q1 && b.q1.length ? b.q1 : b.questions) || [], q2: b.q2 || [], passage: b.passage || '' } });
    }

    // ── (선생님) 책 수정 저장 ──
    if (req.method === 'POST' && action === 'update-book') {
      const { id, title, level, series, chapter, video_url, words, q1, q2 } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: 'id 필요' });
      const patch = {};
      if (video_url !== undefined) patch.video_url = video_url || null;
      if (title != null) patch.title = title;
      if (level != null) patch.level = level;
      if (series != null) patch.series = series;
      if (chapter !== undefined) patch.chapter = chapter === '' || chapter === null ? null : parseInt(chapter);
      if (words != null) patch.words = words;
      if (q1 != null) { patch.q1 = q1; patch.questions = q1; }
      if (q2 != null) patch.q2 = q2;
      await sb('mini_books?id=eq.' + encodeURIComponent(id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
      return res.json({ ok: true });
    }

    // ── (선생님) 책 삭제 ──
    if (req.method === 'POST' && action === 'delete-book') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: 'id 필요' });
      await sb('mini_books?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return res.json({ ok: true });
    }

    // ── 책 1개 + 문제 (퀴즈 풀기) ──
    if (req.method === 'GET' && action === 'quiz') {
      const rows = await sb(`mini_books?id=eq.${encodeURIComponent(req.query.book)}&select=id,title,level,questions`);
      if (!rows || !rows.length) return res.status(404).json({ ok: false, message: '책을 찾을 수 없어요' });
      return res.json({ ok: true, book: rows[0] });
    }

    // ── 결과 저장 ──
    if (req.method === 'POST' && action === 'submit') {
      const { student, book, score, total, quiz_type } = req.body || {};
      if (!student || !book) return res.status(400).json({ ok: false, message: '이름과 책이 필요해요' });
      // quiz_type: 0=단어, 1=원서퀴즈1, 2=원서퀴즈2 (미지정이면 1)
      await sb('mini_results', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ student, book_id: book, score, total, quiz_type: quiz_type != null ? quiz_type : 1 }),
      });
      return res.json({ ok: true });
    }

    // ── 녹음 업로드 (학생) → Supabase 스토리지 'recordings' 버킷 ──
    if (req.method === 'POST' && action === 'upload-recording') {
      const { student, book, audioBase64 } = req.body || {};
      if (!student || !book || !audioBase64) return res.status(400).json({ ok: false, message: 'student, book, 오디오 필요' });
      const b64 = audioBase64.indexOf(',') > -1 ? audioBase64.split(',')[1] : audioBase64;
      const buf = Buffer.from(b64, 'base64');
      const path = 'rec_' + book + '_' + Date.now() + '.webm';
      const up = await fetch(`${SB_URL}/storage/v1/object/recordings/${path}`, {
        method: 'POST',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'audio/webm' },
        body: buf,
      });
      if (!up.ok) return res.status(500).json({ ok: false, message: '업로드 실패(버킷 확인): ' + up.status + ' ' + (await up.text()).slice(0, 120) });
      await sb('mini_recordings', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ student, book_id: book, path }),
      });
      return res.json({ ok: true });
    }

    // ── (선생님) 녹음 목록 (재생용 서명 URL 포함) ──
    if (req.method === 'GET' && action === 'recordings') {
      const rows = await sb('mini_recordings?select=student,book_id,path,created_at&order=created_at.desc&limit=200');
      const books = await sb('mini_books?select=id,title,chapter');
      const titleOf = {};
      (books || []).forEach((b) => { titleOf[b.id] = dispTitle(b); });
      const out = [];
      for (const r of (rows || [])) {
        let url = '';
        try {
          const s = await fetch(`${SB_URL}/storage/v1/object/sign/recordings/${r.path}`, {
            method: 'POST',
            headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({ expiresIn: 3600 }),
          });
          if (s.ok) { const j = await s.json(); url = SB_URL + '/storage/v1' + j.signedURL; }
        } catch (e) { /* URL 실패해도 목록은 보여줌 */ }
        out.push({ student: r.student, title: titleOf[r.book_id] || ('#' + r.book_id), date: r.created_at, url });
      }
      return res.json({ ok: true, recordings: out });
    }

    // ── (선생님) 결과 목록 (+ 해당 학생·책 녹음 재생 URL) ──
    if (req.method === 'GET' && action === 'results') {
      const results = await sb('mini_results?select=student,book_id,score,total,created_at&order=created_at.desc&limit=500');
      const books = await sb('mini_books?select=id,title,chapter');
      const recs = await sb('mini_recordings?select=student,book_id,path,created_at&order=created_at.desc&limit=500');
      const titleOf = {};
      (books || []).forEach((b) => { titleOf[b.id] = dispTitle(b); });
      // 학생|책 → 최신 녹음 path (내림차순이라 처음 것이 최신)
      const recMap = {};
      (recs || []).forEach((x) => { const k = x.student + '|' + x.book_id; if (!recMap[k]) recMap[k] = x.path; });

      const out = [];
      for (const r of (results || [])) {
        let audio = '';
        const path = recMap[r.student + '|' + r.book_id];
        if (path) {
          try {
            const s = await fetch(`${SB_URL}/storage/v1/object/sign/recordings/${path}`, {
              method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json' },
              body: JSON.stringify({ expiresIn: 3600 }),
            });
            if (s.ok) { const j = await s.json(); audio = SB_URL + '/storage/v1' + j.signedURL; }
          } catch (e) { /* URL 실패해도 결과는 보여줌 */ }
        }
        out.push({ ...r, title: titleOf[r.book_id] || ('#' + r.book_id), audio });
      }
      return res.json({ ok: true, results: out });
    }

    // ── (선생님) 책 추가 ──
    if (req.method === 'POST' && action === 'add-book') {
      const { title, level, series, chapter, questions } = req.body || {};
      if (!title) return res.status(400).json({ ok: false, message: '책 제목이 필요해요' });
      await sb('mini_books', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ title, level: level || '', series: series || '', chapter: chapter ? parseInt(chapter) : null, questions: questions || [] }),
      });
      return res.json({ ok: true });
    }

    // ── (선생님) AI로 퀴즈 자동 생성 → 책 저장 ──
    if (req.method === 'POST' && action === 'generate') {
      const { title, level, series, chapter, video, text, count } = req.body || {};
      if (!title || !text) return res.status(400).json({ ok: false, message: '책 제목과 지문이 필요해요' });
      const AI_KEY = process.env.ANTHROPIC_API_KEY;
      if (!AI_KEY) return res.status(500).json({ ok: false, message: 'ANTHROPIC_API_KEY 미설정 (Vercel 환경변수 추가)' });

      const clamp = (v, dft) => Math.min(Math.max(parseInt(v) || dft, 1), 15);
      const b = req.body || {};
      const nW = clamp(b.nWords != null ? b.nWords : count, 8);
      const n1 = clamp(b.nQ1 != null ? b.nQ1 : count, 5);
      const n2 = clamp(b.nQ2 != null ? b.nQ2 : count, 5);

      // ── 퀴즈 언어 기준 (화면에서 설정) ──
      // langMode: 'en'=전부영어, 'ko'=전부한글, 그 외='auto'(레벨 기준)
      // auto 기준값(영어 시작 레벨)은 mini_settings.english_level (기본 2.5)
      let threshold = 2.5;
      try {
        const srows = await sb('mini_settings?key=eq.english_level&select=value');
        if (srows && srows[0] && srows[0].value) threshold = parseFloat(srows[0].value) || 2.5;
      } catch (e) { /* 설정 없으면 기본값 */ }
      let allEnglish;
      if (b.langMode === 'en') allEnglish = true;
      else if (b.langMode === 'ko') allEnglish = false;
      else {
        const lvNum = (String(level || '').match(/(\d+(\.\d+)?)/) || [])[1];
        allEnglish = lvNum != null && parseFloat(lvNum) >= threshold;
      }
      const langRule = allEnglish
        ? '- quiz1·quiz2의 질문(question)과 보기(options)는 모두 영어로.\n'
        : '- quiz1·quiz2의 질문(question)과 보기(options)는 모두 한글로 (초급자용). 단, 영어 단어 자체를 묻는 보기라면 그 단어만 영어로.\n';

      // 프로덕션과 동일: 단어카드(words) + 원서퀴즈1 + 원서퀴즈2. 단어퀴즈는 단어카드에서 자동 생성.
      // words(단어카드)는 레벨과 무관하게 항상 english+korean.
      const prompt = '다음 영어 원서 지문을 읽고 아래 3가지를 만들어줘.\n'
        + '1) words: 지문 속 핵심 단어 ' + nW + '개. 각 {"english":"단어","korean":"한글 뜻","word_class":"품사","example":"지문 속 예문"}\n'
        + '2) quiz1: 단어·표현 위주 4지선다 ' + n1 + '개. 각 {"question":"질문","options":["보기1","보기2","보기3","보기4"],"answer":0}\n'
        + '3) quiz2: 내용 이해 4지선다 ' + n2 + '개. 각 {"question":"질문","options":["보기1","보기2","보기3","보기4"],"answer":0}\n'
        + '- answer는 정답 보기 번호(0부터).\n'
        + '- ⭐ quiz1과 quiz2는 각각 반드시 위 개수만큼 채워라. 절대 비워두지 마. 지문이 짧으면 지문 속 단어·표현·제목·기본 내용(누가/무엇/어디)으로라도 문제를 만들어라. (지문이 거의 없어 정말 불가능할 때만 개수를 줄여라.)\n'
        + langRule
        + '- 설명·코드펜스 없이 JSON 객체만 출력.\n'
        + '- 형식: {"words":[...],"quiz1":[...],"quiz2":[...]}\n\n지문:\n' + text;

      async function askAI(pr) {
        const rr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001', // 더 똑똑하게: 'claude-sonnet-5'
            max_tokens: 4000,
            messages: [{ role: 'user', content: pr }],
          }),
        });
        if (!rr.ok) throw new Error('Claude ' + rr.status + ': ' + (await rr.text()).slice(0, 150));
        const dd = await rr.json();
        const oo = (dd.content && dd.content[0] && dd.content[0].text) || '';
        try { return JSON.parse(oo.slice(oo.indexOf('{'), oo.lastIndexOf('}') + 1)); }
        catch (e) { throw new Error('AI 응답을 못 읽었어요: ' + oo.slice(0, 120)); }
      }

      let gen;
      try { gen = await askAI(prompt); }
      catch (e) { return res.status(500).json({ ok: false, message: e.message }); }
      let words = gen.words || [], q1 = gen.quiz1 || [], q2 = gen.quiz2 || [];

      // 안전장치: 지문이 충분한데 퀴즈가 비면 한 번 더 강하게 재시도
      if ((q1.length === 0 || q2.length === 0) && (text || '').length > 150) {
        try {
          const g2 = await askAI(prompt + '\n\n(중요) 방금 quiz1 또는 quiz2가 비어 있었다. 이번엔 quiz1은 ' + n1 + '개, quiz2는 ' + n2 + '개를 반드시 채워라. 지문 속 단어·표현·제목·기본 사실로라도 만들어라.');
          if (q1.length === 0 && (g2.quiz1 || []).length) q1 = g2.quiz1;
          if (q2.length === 0 && (g2.quiz2 || []).length) q2 = g2.quiz2;
          if (!words.length && (g2.words || []).length) words = g2.words;
        } catch (e) { /* 재시도 실패해도 원본 결과로 진행 */ }
      }

      await sb('mini_books', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ title, level: level || '', series: series || '', chapter: chapter ? parseInt(chapter) : null, video_url: video || null, words, q1, q2, questions: q1, passage: text }),
      });
      return res.json({ ok: true, words: words.length, q1: q1.length, q2: q2.length });
    }

    // ── (선생님) 저장된 워크시트 목록 / 상세 / 삭제 ──
    if (req.method === 'GET' && action === 'worksheet-list') {
      let p = 'mini_worksheets?select=id,book_id,type,stage,title,created_at&order=created_at.desc&limit=100';
      if (req.query.book) p += '&book_id=eq.' + encodeURIComponent(req.query.book);
      const rows = await sb(p);
      return res.json({ ok: true, worksheets: rows || [] });
    }
    if (req.method === 'GET' && action === 'worksheet-detail') {
      const rows = await sb('mini_worksheets?id=eq.' + encodeURIComponent(req.query.id) + '&select=id,book_id,type,stage,title,items');
      if (!rows || !rows.length) return res.status(404).json({ ok: false, message: '워크시트 없음' });
      return res.json({ ok: true, worksheet: rows[0] });
    }
    if (req.method === 'POST' && action === 'delete-worksheet') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, message: 'id 필요' });
      await sb('mini_worksheets?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return res.json({ ok: true });
    }

    // ── (선생님) 워크시트 생성 (리딩 이해 / 라이팅 / 단어) — 만들면 자동 저장 ──
    // 난이도 설계: 책의 AR 레벨로 밴드(A~D)를 정하고, 선택한 단계(기초/중급/심화)로 밴드 안에서 조절.
    //   밴드 A (~AR 1.5)  : 사실확인·참거짓, 답 1~3단어. 서술형 없음.
    //   밴드 B (~AR 2.5)  : 사실확인 + 단순추론(왜/어떻게) + 순서 1문항.
    //   밴드 C (~AR 3.5)  : 추론·인과·주제 + 순서 + 서술형 1~2.
    //   밴드 D (AR 3.5+)  : 주제·추론·의도·예측 중심, 서술형 2(2~3문장 답).
    //   단계: 기초=한글 질문·힌트/단어상자, 중급=쉬운 영어, 심화=영어·추론/자유서술 비중↑.
    if (req.method === 'POST' && action === 'worksheet') {
      const { book_id, type, stage, count } = req.body || {};
      let book = null;
      if (book_id) {
        const rows = await sb('mini_books?id=eq.' + encodeURIComponent(book_id) + '&select=*');
        book = rows && rows[0];
      }
      const title = (book && dispTitle(book)) || '워크시트';
      const level = (book && book.level) || '';
      const words = (book && book.words) || [];
      const text = (req.body && req.body.passage) || (book && book.passage) || '';
      // 붙여넣은 지문을 책에 저장 → 다음엔 자동으로 채워짐 (한 번만 넣으면 됨)
      const pasted = req.body && req.body.passage ? String(req.body.passage).trim() : '';
      if (pasted && book_id) {
        try {
          await sb('mini_books?id=eq.' + encodeURIComponent(book_id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ passage: pasted }) });
        } catch (e) { /* 지문 저장 실패해도 워크시트 생성은 계속 */ }
      }
      const n = Math.min(Math.max(parseInt(count) || 8, 1), 20);
      const st = (stage === '기초' || stage === '심화') ? stage : '중급';
      const arNum = parseFloat((String(level).match(/(\d+(\.\d+)?)/) || [])[1]);
      const band = isNaN(arNum) ? 'B' : (arNum < 1.5 ? 'A' : arNum < 2.5 ? 'B' : arNum < 3.5 ? 'C' : 'D');

      const saveWs = async (items) => {
        const rows = await sb('mini_worksheets', {
          method: 'POST', headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ book_id: book_id || null, type, stage: st, title, items }),
        });
        return rows && rows[0] ? rows[0].id : null;
      };

      // ── 단어 워크시트: 저장된 단어카드로 즉시 구성 (AI 불필요) ──
      if (type === 'vocab') {
        if (!words.length) return res.json({ ok: false, message: '이 책엔 단어카드가 없어요' });
        const shuffled = words.slice().sort(() => Math.random() - 0.5);
        const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const cloze = words.filter((w) => w.example && w.english).map((w) => ({
          q: String(w.example).replace(new RegExp(escRe(w.english), 'i'), '________'), a: w.english,
        }));
        let sections;
        if (st === '기초') {
          // 인지 부담 낮게: 연결하기 + 단어상자 보고 쓰기
          sections = [
            { kind: 'match', title: '① 알맞은 뜻을 선으로 연결하세요', en: words.map((w) => w.english), ko: shuffled.map((w) => w.korean), key: words.map((w) => w.english + ' → ' + w.korean) },
            { kind: 'write', title: '② 뜻을 보고 영어를 골라 쓰세요', rows: words.map((w) => ({ q: w.korean, a: w.english })), bank: shuffled.map((w) => w.english) },
          ];
        } else if (st === '중급') {
          // 회상 단계: 뜻 쓰기 + 예문 빈칸(상자 있음)
          sections = [
            { kind: 'write', title: '① 영어를 보고 뜻을 쓰세요', rows: words.map((w) => ({ q: w.english, a: w.korean })) },
            { kind: 'cloze', title: '② 문장의 빈칸을 채우세요 (단어 상자)', rows: cloze, bank: shuffled.map((w) => w.english) },
          ];
        } else {
          // 산출 단계: 뜻→영어(상자 없음) + 빈칸(상자 없음) + 작문
          sections = [
            { kind: 'write', title: '① 뜻을 보고 영어로 쓰세요', rows: words.map((w) => ({ q: w.korean, a: w.english })) },
            { kind: 'cloze', title: '② 문장의 빈칸을 채우세요', rows: cloze },
            { kind: 'sentence', title: '③ 단어로 나만의 문장을 만드세요', rows: words.slice(0, 3).map((w) => ({ q: w.english })) },
          ];
        }
        const id = await saveWs(sections);
        return res.json({ ok: true, worksheet: { id, title, type, stage: st, level, items: sections } });
      }

      // ── 리딩/라이팅: 지문 필요 → AI ──
      if (!text) return res.json({ ok: false, needPassage: true, message: '지문이 없어요. 지문을 붙여넣어 주세요.' });
      const AI_KEY = process.env.ANTHROPIC_API_KEY;
      if (!AI_KEY) return res.status(500).json({ ok: false, message: 'ANTHROPIC_API_KEY 미설정' });

      let prompt;
      if (type === 'reading') {
        // education.com 관례 반영: 객관식(mc) 포함, 스킬 위계(사실확인→추론→주제)
        const mix = {
          A: '객관식(mc) 3~4개(그림 없이 풀 수 있는 쉬운 사실확인) + 참거짓 2~3개 + 사건순서(seq) 1개. 서술형(essay) 금지. 답은 1~3단어.',
          B: '객관식(mc) 2~3개 + 사실확인 단답 + 단순 추론(왜/어떻게) + 참거짓 2개 + 사건순서(seq) 1개. 답은 2~5단어.',
          C: '객관식(mc) 2개(어휘 문맥·세부사항) + 추론·인과·주제(main idea) 단답 + 사건순서(seq) 1개 + 서술형(essay) ' + (st === '심화' ? '2' : '1') + '개.',
          D: '주제·추론·인물 의도·예측 중심. 객관식(mc)은 주제 찾기 1~2개만 + 서술형(essay) 2개(답 2~3문장). 참거짓 최소화.',
        }[band];
        const lang = st === '기초'
          ? '질문은 한글로, 답·보기는 지문 속 영어 단어·짧은 표현으로.'
          : (st === '중급' ? '질문·답 모두 쉬운 영어로.' : '질문·답 모두 영어로. 추론 비중을 높여.');
        prompt = '다음 영어 지문으로 리딩 이해(reading comprehension) 워크시트를 만들어줘.\n'
          + '- 워크시트에 지문은 인쇄되지 않는다(저작권). 학생은 실제 책을 보며 푼다 — "위 지문에서" 같은 표현 금지, 책 내용으로 질문.\n'
          + '- 총 ' + n + '문항. 구성: ' + mix + '\n- ' + lang + '\n'
          + '- 유형 kind: "mc"(4지선다) | "tf"(참거짓) | "short"(단답) | "seq"(사건 순서) | "essay"(서술형)\n'
          + '- 각 항목 {"q":"질문","kind":"...","answer":"정답/모범답안"}.\n'
          + '  mc는 {"q":"...","kind":"mc","options":["보기1","보기2","보기3","보기4"],"answer":0} — answer는 0부터 번호.\n'
          + '  seq는 {"q":"순서대로 번호를 쓰세요","kind":"seq","events":["사건1","사건2","사건3","사건4"],"answer":"3,1,4,2"} — events는 순서를 섞어서.\n'
          + '- 설명·코드펜스 없이 {"items":[...]} 만 출력.\n\n지문:\n' + text;
      } else {
        // education.com 관례 반영: 그래픽 오거나이저(주제문/세부/결론) 포함
        const mix = {
          A: '단어 채우기·문장 완성 수준 (한 항목당 빈칸 1개). 자유서술(free)은 1개만, 한 문장 쓰기.',
          B: '책의 문형(pattern)을 활용한 문장 완성 + 질문에 완전한 문장으로 답하기. 자유서술(free) ' + (st === '심화' ? '2' : '1') + '개.' + (st !== '기초' ? ' 마지막에 오거나이저(organizer) 1개: 처음/가운데/끝(Beginning/Middle/End) 상자.' : ''),
          C: '문장 완성 + 프레임 제공 짧은 문단(3~4문장) 유도. 자유서술(free) 2개 (요약 1, 의견+이유 1). 오거나이저(organizer) 1개: 주제문/세부1/세부2/맺음(Topic/Detail 1/Detail 2/Conclusion) 상자.',
          D: '요약 문단·의견(근거 포함)·결말 바꿔쓰기 중심. 프레임 최소화. 자유서술(free) 2~3개. 서술 전에 오거나이저(organizer) 1개로 계획 세우게.',
        }[band];
        const lang = st === '기초'
          ? '지시문은 한글로, 빈칸에 들어갈 말은 영어. hint에 단어·표현 힌트를 꼭 제공.'
          : (st === '중급' ? '지시문은 쉬운 영어로, hint는 절반 정도만.' : '지시문은 영어로, hint 없이.');
        prompt = '다음 영어 지문의 내용·문형으로 라이팅(writing) 워크시트를 만들어줘.\n'
          + '- 워크시트에 지문은 인쇄되지 않는다(저작권). 지문 문장을 그대로 베끼지 말고, 문형·주제만 활용해 새 문장으로 출제.\n'
          + '- 총 ' + n + '항목. 구성: ' + mix + '\n- ' + lang + '\n'
          + '- 각 항목 {"prompt":"지시문/문장","kind":"complete"(완성형) | "free"(자유서술) | "organizer"(계획 상자),"hint":"힌트(선택)","model":"모범답안"}.\n'
          + '  organizer는 {"prompt":"지시문","kind":"organizer","boxes":["Topic sentence","Detail 1","Detail 2","Conclusion"],"model":"각 상자 모범답안 요약"} — boxes 라벨은 난이도에 맞게.\n'
          + '- 설명·코드펜스 없이 {"items":[...]} 만 출력.\n\n지문:\n' + text;
      }

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok) return res.status(500).json({ ok: false, message: 'Claude ' + r.status + ': ' + (await r.text()).slice(0, 150) });
      const data = await r.json();
      const out = (data.content && data.content[0] && data.content[0].text) || '';
      let gen;
      try { gen = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)); }
      catch (e) { return res.status(500).json({ ok: false, message: 'AI 응답을 못 읽었어요', raw: out.slice(0, 200) }); }
      const items = gen.items || [];
      const id = await saveWs(items);
      return res.json({ ok: true, worksheet: { id, title, type, stage: st, level, items } });
    }

    return res.status(400).json({ ok: false, message: 'action: students | add-student | books | quiz | submit | results | add-book | generate | worksheet' });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
};
