// 관리자 페이지 문지기 — 학생이 선생님 화면을 못 보게.
// 선생님 화면(관리자) HTML의 <head> 맨 위에 이 파일 하나만 넣으면 됩니다:
//   <script src="/mini/admin-guard.js"></script>
// 잠금 해제(비밀번호 확인)는 admin.html 에서 하고, 여기서는 통과 여부만 봅니다.
(function () {
  var ok = false;
  try { ok = localStorage.getItem('mini_admin') === '1'; } catch (e) {}
  if (ok) return;                       // 이미 잠금 해제됨 → 그대로 진행
  var here = location.pathname + location.search + location.hash;
  location.replace('/mini/admin.html?next=' + encodeURIComponent(here));   // 아니면 관리자 로그인으로
})();
