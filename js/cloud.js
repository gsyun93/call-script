// 수퍼베이스 저장: 로그인하면 통화 기록, 고친 멘트, 화면 편집 내용을 서버에 같이 저장한다.
// 앱(app.js)은 지금처럼 브라우저 저장소만 쓰고, 이 파일이 그 값을 서버와 맞춰준다.
//   1. 로그인 확인 → 서버 값을 브라우저 저장소로 가져오기 → app.js 실행
//   2. 앱이 저장소에 쓰면 잠시 뒤 서버에도 올리기
(function () {
  'use strict';

  var CFG = {
    url: 'https://cofxqgzmmkzgalecozjm.supabase.co',
    // 공개용 키 (브라우저에 넣어도 되는 키, 데이터는 로그인한 본인 것만 보이게 막혀 있음)
    key: 'sb_publishable_wM5ifw-gKkVSbRG4YNAJ1w_dwjeXVyh'
  };
  var KEYS = ['records', 'edits', 'custom'];
  var PREFIX = 'callscript.';
  var SKIP = 'callscript.localOnly';

  var me = document.currentScript;
  var ver = (me && me.src.split('?')[1]) || '';
  var client = null, user = null;

  function lsGet(k) {
    try { var v = localStorage.getItem(PREFIX + k); return v === null ? null : JSON.parse(v); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { rawSet.call(localStorage, PREFIX + k, JSON.stringify(v)); } catch (e) { /* 무시 */ }
  }

  function loadApp() {
    var s = document.createElement('script');
    s.src = 'js/app.js' + (ver ? '?' + ver : '');
    s.onload = addAccountBar;
    document.body.appendChild(s);
  }

  // ---------- 서버로 올리기 ----------
  var rawSet = Storage.prototype.setItem;
  var timers = {};
  function push(k) {
    if (!client || !user) return;
    var value = lsGet(k);
    if (value === null) return;
    client.from('user_store')
      .upsert({ user_id: user.id, key: k, value: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' })
      .then(function (r) { setSync(r.error ? '저장 실패, 다시 시도 중' : '서버에 저장됨', !!r.error); if (r.error) schedule(k, 5000); });
  }
  function schedule(k, ms) {
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () { push(k); }, ms || 800);
  }
  // 앱이 브라우저 저장소에 쓸 때 서버에도 올라가게
  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === localStorage && k.indexOf(PREFIX) === 0 && KEYS.indexOf(k.slice(PREFIX.length)) !== -1) {
      setSync('저장 중');
      schedule(k.slice(PREFIX.length));
    }
  };

  // ---------- 서버에서 가져오기 ----------
  function pull() {
    return client.from('user_store').select('key,value').then(function (r) {
      if (r.error) throw r.error;
      var server = {};
      (r.data || []).forEach(function (row) { server[row.key] = row.value; });

      // 통화 기록은 양쪽을 합친다 (같은 기록은 id로 구분)
      var local = lsGet('records') || [];
      var remote = server.records || [];
      var ids = {};
      remote.forEach(function (x) { ids[x.id] = true; });
      var onlyLocal = local.filter(function (x) { return x && x.id && !ids[x.id]; });
      var merged = remote.concat(onlyLocal).sort(function (a, b) { return b.ts - a.ts; });
      lsSet('records', merged);
      if (onlyLocal.length || !server.records) schedule('records', 100);

      // 고친 멘트, 화면 편집은 서버에 있으면 서버 값, 없으면 이 기기 값을 올린다
      ['edits', 'custom'].forEach(function (k) {
        if (server[k]) lsSet(k, server[k]);
        else if (lsGet(k)) schedule(k, 100);
      });
    });
  }

  // ---------- 로그인 화면 ----------
  function gate(msg) {
    var g = document.createElement('div');
    g.className = 'gate';
    g.innerHTML = '<form class="gate-card" novalidate>' +
      '<h1>테이블오더 통화 스크립트</h1>' +
      '<p class="gate-sub">로그인하면 통화 기록과 고친 멘트가 어느 기기에서나 같이 보입니다.</p>' +
      '<label><span>이메일</span><input type="email" name="email" autocomplete="username" required></label>' +
      '<label><span>비밀번호</span><input type="password" name="pw" autocomplete="current-password" minlength="6" required></label>' +
      '<p class="gate-msg"></p>' +
      '<button type="submit" class="btn">로그인</button>' +
      '<div class="gate-alt"><button type="button" data-a="signup">처음이면 가입</button>' +
      '<button type="button" data-a="skip">로그인 없이 이 기기에만 저장</button></div>' +
      '</form>';
    document.body.appendChild(g);
    var f = g.querySelector('form'), m = g.querySelector('.gate-msg');
    function say(t, bad) { m.textContent = t; m.classList.toggle('is-bad', !!bad); }
    if (msg) say(msg, true);
    function creds() { return { email: f.email.value.trim(), password: f.pw.value }; }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var c = creds();
      if (!c.email || !c.password) { say('이메일과 비밀번호를 넣어주세요', true); return; }
      say('로그인 중');
      client.auth.signInWithPassword(c).then(function (r) {
        if (r.error) { say(r.error.message.indexOf('confirm') !== -1 ? '메일함에서 가입 인증 링크를 먼저 눌러주세요' : '이메일이나 비밀번호가 맞지 않습니다', true); return; }
        user = r.data.user;
        try { localStorage.removeItem(SKIP); } catch (err) { /* 무시 */ }
        say('기록을 불러오는 중');
        pull().then(function () { g.remove(); loadApp(); }, function () { g.remove(); loadApp(); });
      });
    });
    g.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a;
      if (a === 'skip') {
        try { rawSet.call(localStorage, SKIP, '1'); } catch (err) { /* 무시 */ }
        g.remove();
        loadApp();
      }
      if (a === 'signup') {
        var c = creds();
        if (!c.email || c.password.length < 6) { say('이메일과 6자 이상 비밀번호를 넣고 가입을 누르세요', true); return; }
        say('가입 중');
        client.auth.signUp({ email: c.email, password: c.password, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
          if (r.error) { say(r.error.message, true); return; }
          if (r.data.session) { user = r.data.user; pull().then(function () { g.remove(); loadApp(); }); return; }
          say('메일함으로 인증 링크를 보냈습니다. 링크를 누른 뒤 여기서 로그인하세요.');
        });
      }
    });
    setTimeout(function () { f.email.focus(); }, 30);
  }

  // ---------- 위쪽 메뉴: 계정, 저장 상태 ----------
  var syncEl = null;
  function setSync(t, bad) {
    if (!syncEl) return;
    syncEl.textContent = t;
    syncEl.classList.toggle('is-bad', !!bad);
  }
  function addAccountBar() {
    var bar = document.querySelector('.top-act');
    if (!bar) return;
    var box = document.createElement('span');
    box.className = 'acct';
    if (user) {
      box.innerHTML = '<span class="sync">서버에 저장됨</span><button type="button" class="btn-ghost" data-a="out">로그아웃</button>';
    } else {
      box.innerHTML = '<span class="sync is-bad">이 기기에만 저장 중</span><button type="button" class="btn-ghost" data-a="in">로그인</button>';
    }
    bar.insertBefore(box, bar.firstChild);
    syncEl = box.querySelector('.sync');
    box.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a;
      if (a === 'in') { try { localStorage.removeItem(SKIP); } catch (err) { /* 무시 */ } location.reload(); }
      if (a === 'out') {
        if (!confirm('로그아웃할까요? 이 기기에 남은 통화 기록은 지웁니다 (서버에는 그대로 있습니다).')) return;
        client.auth.signOut().then(function () {
          KEYS.forEach(function (k) { try { localStorage.removeItem(PREFIX + k); } catch (err) { /* 무시 */ } });
          location.reload();
        });
      }
    });
  }

  // ---------- 시작 ----------
  var localOnly = false;
  try { localOnly = localStorage.getItem(SKIP) === '1'; } catch (e) { /* 무시 */ }
  if (!window.supabase || !window.supabase.createClient) { loadApp(); return; }
  client = window.supabase.createClient(CFG.url, CFG.key);
  client.auth.getSession().then(function (r) {
    user = r.data.session && r.data.session.user;
    if (user) return pull().then(loadApp, loadApp);
    if (localOnly) return loadApp();
    gate();
  }, function () { loadApp(); });
})();
