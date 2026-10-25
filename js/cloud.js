// 로그인과 수퍼베이스 저장: 로그인해야 툴이 열린다.
// 로그인하면 통화 기록, 고친 멘트, 화면 편집 내용을 서버에도 같이 저장한다.
//   1. 로그인돼 있으면 서버 값을 브라우저 저장소로 가져온 뒤 app.js 실행, 아니면 로그인 화면
//   2. 앱이 저장소에 쓰면 잠시 뒤 서버에도 올리기
(function () {
  'use strict';

  var CFG = {
    url: 'https://cofxqgzmmkzgalecozjm.supabase.co',
    // 공개용 키 (브라우저에 넣어도 되는 키, 데이터는 로그인한 본인 것만 보이게 막혀 있음)
    key: 'sb_publishable_wM5ifw-gKkVSbRG4YNAJ1w_dwjeXVyh'
  };
  var KEYS = ['records', 'edits', 'custom'];
  // 아이디 → 수퍼베이스 로그인 계정(이메일 형식). 비밀번호는 여기 두지 않고 수퍼베이스에만 있다
  var IDS = { '윤기성': 'yoon@call-script.example' };
  var PREFIX = 'callscript.';

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
      '<label><span>아이디</span><input type="text" name="email" autocomplete="username" required></label>' +
      '<label><span>비밀번호</span><input type="password" name="pw" autocomplete="current-password" required></label>' +
      '<p class="gate-msg"></p>' +
      '<button type="submit" class="btn">로그인</button>' +
      '</form>';
    document.body.appendChild(g);
    var f = g.querySelector('form'), m = g.querySelector('.gate-msg');
    function say(t, bad) { m.textContent = t; m.classList.toggle('is-bad', !!bad); }
    if (msg) say(msg, true);
    function creds() {
      var id = f.email.value.trim();
      return { email: IDS[id] || id, password: f.pw.value };
    }
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var c = creds();
      if (!c.email || !c.password) { say('아이디와 비밀번호를 넣어주세요', true); return; }
      say('로그인 중');
      client.auth.signInWithPassword(c).then(function (r) {
        if (r.error) { say('아이디나 비밀번호가 맞지 않습니다', true); return; }
        user = r.data.user;
        say('기록을 불러오는 중');
        // 이 기기 기록과 서버 기록을 합친 뒤 새로 연다
        pull().then(function () { location.reload(); }, function () { location.reload(); });
      });
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
    box.innerHTML = '<span class="sync">서버에 저장됨</span><button type="button" class="btn-ghost" data-a="out">로그아웃</button>';
    bar.insertBefore(box, bar.firstChild);
    syncEl = box.querySelector('.sync');
    box.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a;
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
  try { localStorage.removeItem(PREFIX + 'localOnly'); } catch (e) { /* 예전 설정 정리 */ }
  if (!window.supabase || !window.supabase.createClient) {
    document.body.insertAdjacentHTML('beforeend', '<div class="gate"><div class="gate-card"><h1>연결할 수 없습니다</h1><p class="gate-sub">인터넷 연결을 확인하고 새로고침 해주세요.</p></div></div>');
    return;
  }
  client = window.supabase.createClient(CFG.url, CFG.key);
  client.auth.getSession().then(function (r) {
    user = r.data.session && r.data.session.user;
    if (user) return pull().then(loadApp, loadApp);
    gate();
  }, function () { gate('연결이 불안정합니다. 다시 시도해 주세요'); });
})();
