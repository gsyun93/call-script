(function () {
  'use strict';

  var D = window.TOOL_DATA;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  // ---------- 저장소 (브라우저에서 막혀 있어도 화면은 동작하게) ----------
  var store = {
    get: function (k, def) {
      try {
        var v = localStorage.getItem('callscript.' + k);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set: function (k, v) {
      try { localStorage.setItem('callscript.' + k, JSON.stringify(v)); return true; }
      catch (e) { return false; }
    }
  };

  // 페이지를 열 때마다 새 통화로 시작한다 (저장 안 한 입력값은 남기지 않음)
  ['step', 'vars', 'paths', 'answers', 'hist'].forEach(function (k) {
    try { localStorage.removeItem('callscript.' + k); } catch (e) { /* 무시 */ }
  });
  var state = {
    step: D.steps[0].id,
    vars: {},
    records: store.get('records', []),
    paths: {},
    answers: {},
    edits: store.get('edits', {}),
    // 이전 버튼용: 지나온 화면들
    hist: [],
    editing: null
  };

  // 화면 편집으로 바꾼 버튼과 질문. 키는 '단계.노드'
  //   nodes: 원래 있던 노드에서 바뀐 부분(이름, 버튼 목록, 순서)
  //   added: 새로 만든 노드 전체
  var custom = store.get('custom', null) || { nodes: {}, added: {} };
  function applyCustom() {
    Object.keys(custom.added).forEach(function (k) {
      var a = k.split('.'), st = findStep(a[0]);
      if (st) st.nodes[a[1]] = custom.added[k];
    });
    Object.keys(custom.nodes).forEach(function (k) {
      var a = k.split('.'), st = findStep(a[0]);
      if (st && st.nodes[a[1]]) {
        var o = custom.nodes[k], n = st.nodes[a[1]];
        ['label', 'nextLabel', 'options', 'choices'].forEach(function (f) { if (o[f] !== undefined) n[f] = o[f]; });
        // 예전에 편집해 둔 목록에 지금은 없어진 화면이 들어 있으면 뺀다
        if (n.choices) n.choices = n.choices.filter(function (id) { return st.nodes[id]; });
      }
    });
  }
  function saveNode(st, id) {
    var k = st.id + '.' + id, n = st.nodes[id];
    if (custom.added[k]) custom.added[k] = n;
    else custom.nodes[k] = { label: n.label, nextLabel: n.nextLabel, options: n.options, choices: n.choices };
    store.set('custom', custom);
  }
  function addNode(st, node) {
    var id = 'c' + Date.now().toString(36);
    st.nodes[id] = node;
    custom.added[st.id + '.' + id] = node;
    store.set('custom', custom);
    return id;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('is-on'); }, 1600);
  }

  function copyText(text) {
    var done = function () { toast('복사했습니다'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
    document.body.removeChild(ta);
  }

  // ---------- 날짜 ----------
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function fmtKoDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return Number(p[1]) + '월 ' + Number(p[2]) + '일';
  }
  function fmtKoTime(hhmm) {
    if (!hhmm) return '';
    var p = hhmm.split(':');
    var h = Number(p[0]), m = Number(p[1]);
    var ampm = h < 12 ? '오전' : '오후';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return ampm + ' ' + h12 + '시' + (m ? ' ' + m + '분' : '');
  }
  // '10/28', '10.28', '1028', '10월 28일', '내일', '모레' → 'YYYY-MM-DD'
  function parseDateText(t) {
    t = String(t || '').trim();
    if (!t) return '';
    var d = new Date(); d.setHours(0, 0, 0, 0);
    var rel = { '오늘': 0, '내일': 1, '모레': 2 };
    if (rel[t] !== undefined) { d.setDate(d.getDate() + rel[t]); return iso(d); }
    var m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
    var y = d.getFullYear(), mo, da;
    if (m) { y = +m[1]; mo = +m[2]; da = +m[3]; }
    else if ((m = t.match(/^(\d{1,2})\s*[-./월 ]\s*(\d{1,2})\s*일?$/))) { mo = +m[1]; da = +m[2]; }
    else if ((m = t.match(/^(\d{2})(\d{2})$/))) { mo = +m[1]; da = +m[2]; }
    else return null;
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    var out = new Date(y, mo - 1, da);
    // 연도 없이 쓴 날짜가 한참 지났으면 내년으로 본다
    if (!m[3] && out < d && (d - out) > 30 * 864e5) out.setFullYear(y + 1);
    return iso(out);
  }
  // '15:30', '1530', '3시', '3시 반', '오후 3시 20분', '15' → 'HH:MM'. 1~8시는 오후로 본다
  function parseTimeText(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    var m = t.match(/^(오전|오후)?\s*(\d{1,2})(?:\s*[:시]\s*(반|\d{1,2})?\s*분?)?$/) || t.match(/^()(\d{2})(\d{2})$/);
    if (!m) return null;
    var h = +m[2], mi = m[3] === '반' ? 30 : (+m[3] || 0);
    if (m[1] === '오후' && h < 12) h += 12;
    else if (!m[1] && h >= 1 && h <= 8) h += 12;
    if (h > 23 || mi > 59) return null;
    return pad(h) + ':' + pad(mi);
  }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function shortDate(v) { if (!v) return ''; var p = v.split('-'); return Number(p[1]) + '/' + Number(p[2]); }

  function fmtStamp(ts) {
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ---------- 스크립트 변수 ----------
  function won(x) { return Math.round(x).toLocaleString('ko-KR'); }

  // 견적 단가. 금액표에서 고친 값이 있으면 그걸 쓴다
  function prices() {
    var Q = D.quote, r = {};
    ['post', 'pre', 'pos'].forEach(function (k) {
      var e = parseInt(String(state.edits['quote.' + k] || '').replace(/[^0-9]/g, ''), 10);
      r[k] = e > 0 ? e : Q[k];
    });
    return r;
  }

  // 견적 계산. 후불/선불 대수를 안 넣었으면 상황 파악에서 받은 대수를 후불로 본다
  function quoteCalc() {
    var v = state.vars, Q = prices();
    var post = parseInt(v.qPost, 10) || 0, pre = parseInt(v.qPre, 10) || 0;
    if (!post && !pre) {
      if (String(v.order || '').indexOf('선불') === 0) pre = parseInt(v.n, 10) || 0;
      else post = parseInt(v.n, 10) || 0;
    }
    var units = post + pre;
    var free = v.qFree === undefined || v.qFree === '' ? 1 : (parseInt(v.qFree, 10) || 0);
    free = Math.min(free, units);
    // 무상 대수는 대수가 더 많은 쪽 단가로 뺀다
    var freePrice = pre > post ? Q.pre : Q.post;
    var table = post * Q.post + pre * Q.pre - free * freePrice;
    var pos = v.qBundle ? 0 : Q.pos;
    var total = table + pos;
    var picked = (v.qBen || []).map(function (id) {
      return D.quote.benefits.filter(function (b) { return b.id === id; })[0];
    }).filter(Boolean);
    return {
      post: post, pre: pre, units: units, free: free, paid: units - free,
      table: table, unit: units ? table / units : 0, pos: pos, total: total,
      sum: total * D.quote.months, picked: picked, bundle: !!v.qBundle
    };
  }

  function varValues() {
    var v = state.vars;
    var c = quoteCalc();
    var ok = c.units > 0;
    return {
      name: D.myName,
      store: v.store || '',
      source: v.source || '',
      n: ok ? String(c.units) : '',
      free: ok ? String(c.free) : '',
      paid: ok ? String(c.paid) : '',
      table: ok ? won(c.table) : '',
      unit: ok ? won(c.unit) : '',
      total: ok ? won(c.total) : '',
      postPrice: won(prices().post),
      prePrice: won(prices().pre),
      posPrice: won(prices().pos),
      posLine: c.bundle ? '포스기랑 카드 단말기, 주방 프린터는 인터넷 결합으로 무상으로 들어가요. ' : '포스기랑 카드 단말기, 주방 프린터는 세트로 월 ' + won(prices().pos) + '원이에요. ',
      powerLine: powerLine(),
      standLine: standLine(),
      printerLine: printerLine(),
      benefits: c.picked.length ? '여기에 ' + c.picked.map(function (b) { return b.say; }).join(', ') + '까지 넣어드릴게요. ' : '',
      open: fmtKoDate(v.open),
      date: fmtKoDate(v.date),
      time: fmtKoTime(v.time)
    };
  }
  var varLabels = { name: '내 이름', store: '매장명', region: '지역', source: '유입 경로', n: '대수', free: '무상 대수', paid: '유료 대수', table: '테이블오더 월 금액', unit: '대당 금액', total: '월 합계', open: '오픈일', date: '날짜', time: '시간' };
  // 비어 있으면 자리표시 없이 그냥 빼는 값
  var optionalVars = { benefits: true, posLine: true, powerLine: true, standLine: true, printerLine: true };

  function int(k) { return parseInt(state.vars[k], 10) || 0; }
  function powerLine() {
    var w = int('nWire'), b = int('nBatt');
    if (w && b) return D.lines.powerMix;
    if (w) return textOf('talk', 'n3_wire') + ' ';
    if (b) return textOf('talk', 'n3_batt') + ' ';
    return '';
  }
  function standLine() {
    if (!int('sFix') && !int('sDesk') && !int('sCover') && !int('sWall')) return '';
    return (int('sCover') ? D.lines.cover : '') + (int('sWall') ? D.lines.wall : '') + D.lines.standOk;
  }
  function printerLine() {
    var n = int('printers');
    if (n > 1) return D.lines.printerMore.replace('{printers}', n);
    return n === 1 ? D.lines.printerOne : '';
  }

  // html: 값은 강조, 비어 있으면 [라벨]
  function fill(text, asHtml) {
    var vals = varValues();
    if (!asHtml) {
      return text.replace(/\{([a-zA-Z0-9-]+)\}/g, function (m, k) {
        if (optionalVars[k]) return vals[k] || '';
        return vals[k] ? vals[k] : '[' + (varLabels[k] || k) + ']';
      });
    }
    return esc(text).replace(/\{([a-zA-Z0-9-]+)\}/g, function (m, k) {
      if (optionalVars[k]) return esc(vals[k] || '');
      if (vals[k]) return '<span class="v">' + esc(vals[k]) + '</span>';
      return '<span class="v empty">[' + esc(varLabels[k] || k) + ']</span>';
    });
  }

  // ---------- 상단 ----------
  function renderHeader() {
    $('#baseDate').textContent = '금액 기준 ' + D.priceBaseDate;
    $('#me').textContent = D.myName + ' 매니저';
    $$('.tab').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); });
    });
  }

  function showTab(id) {
    $$('.tab').forEach(function (b) { b.classList.toggle('is-on', b.dataset.tab === id); });
    $$('.panel').forEach(function (p) { p.classList.toggle('is-on', p.dataset.panel === id); });
    if (id === 'log') renderLog();
  }

  // 새 통화: 입력값, 답변, 지나온 화면을 다 비우고 첫 화면으로
  function resetCall() {
    state.vars = {};
    state.paths = {};
    state.answers = {};
    state.hist = [];
    store.set('vars', state.vars);
    store.set('answers', state.answers);
    savePaths();
    openObj = {};
    $('#objSearch').value = '';
    showTab('script');
    setStep(D.steps[0].id);
    showScene(true);
    renderObjections();
    renderMessages();
  }

  function bindTop() {
    $('#newCall').addEventListener('click', function () {
      var started = Object.keys(state.vars).length || Object.keys(state.answers).length;
      if (started && !confirm('지금 통화 내용을 지우고 새 통화를 시작할까요?')) return;
      resetCall();
    });
    $('#openRecord').addEventListener('click', function () { openDrawer(); });
  }

  // ---------- 스크립트 ----------
  // 화면마다 버튼만 보여준다. 버튼에는 누르고 나서 읽을 멘트가 같이 적혀 있다.
  function setStep(id) {
    state.step = id;
    store.set('step', id);
  }

  function findStep(id) {
    return D.steps.filter(function (x) { return x.id === id; })[0];
  }
  function curStep() {
    return findStep(state.step) || D.steps[0];
  }
  function stepPath(s) {
    var p = state.paths[s.id];
    var st0 = stepStart(s);
    var valid = p && p.length && p[0] === st0 && p.every(function (id) { return s.nodes[id] || objOf(id); });
    if (!valid) p = state.paths[s.id] = [st0];
    return p;
  }

  // 'obj:price' 또는 'obj:price:1' → { ob, i }
  function objOf(id) {
    if (!id || id.indexOf('obj:') !== 0) return null;
    var k = id.slice(4).split(':');
    var ob = D.objections.filter(function (x) { return x.id === k[0]; })[0];
    return ob ? { ob: ob, i: Number(k[1] || 0) } : null;
  }

  // 직접 고친 멘트가 있으면 그걸 쓴다 (키: 단계.노드)
  function textByKey(key) {
    var k = key.split('.');
    if (k[0] === 'obj') return objText(k[1], Number(k[2]));
    if (k[2]) return state.edits[key] != null ? state.edits[key] : origByKey(key);
    return textOf(k[0], k[1]);
  }
  function origByKey(key) {
    var k = key.split('.');
    if (k[0] === 'obj') {
      var ob = D.objections.filter(function (x) { return x.id === k[1]; })[0];
      return ob ? ob.answers[Number(k[2])] : null;
    }
    var st = findStep(k[0]);
    var n = st && st.nodes[k[1]];
    if (n && k[2]) { var g = n.form && n.form[Number(k[2].slice(1))]; return g ? g.say : null; }
    return n ? n.text : null;
  }
  function objText(id, i) {
    var e = state.edits['obj.' + id + '.' + i];
    if (e != null) return e;
    var ob = D.objections.filter(function (x) { return x.id === id; })[0];
    return ob ? ob.answers[i] : '';
  }
  function textOf(stepId, nodeId) {
    var e = state.edits[stepId + '.' + nodeId];
    if (e != null) return e;
    var st = findStep(stepId);
    return st && st.nodes[nodeId] ? st.nodes[nodeId].text : '';
  }
  function saveEdits() { store.set('edits', state.edits); }
  // 단계의 첫 화면. 운영 중 매장용 시작 화면이 따로 있으면 그쪽으로
  function stepStart(s) {
    var st = state.vars.status;
    return s.startRunning && st && st !== '오픈 준비 중' ? s.startRunning : s.start;
  }
  function savePaths() { store.set('paths', state.paths); store.set('hist', state.hist); }
  function saveVars() { store.set('vars', state.vars); }

  // 이동할 곳의 단계와 노드. 목록 화면이면 kind가 pick
  function resolve(target) {
    if (!target || target === 'end' || target.indexOf('obj:') === 0) return null;
    var s = curStep(), id = target;
    if (target.indexOf('step:') === 0) {
      var parts = target.slice(5).split('#');
      s = findStep(parts[0]);
      if (!s) return null;
      id = parts[1] || stepStart(s);
    }
    var n = s.nodes[id];
    return n ? { step: s, id: id, node: n } : null;
  }

  // 버튼에 붙일 멘트
  function sayOf(target) {
    var o = objOf(target);
    if (o) return { key: 'obj.' + o.ob.id + '.' + o.i, text: objText(o.ob.id, o.i) };
    var r = resolve(target);
    // 목록 화면으로 가는 버튼에는 그 안에 있는 항목 이름을 적는다
    if (r && r.node.kind === 'pick') return { list: r.node.choices.filter(function (id) { return r.step.nodes[id] && shown(r.step.nodes[id]); }).map(function (id) { return r.step.nodes[id].label; }).join(' · ') };
    if (!r || !r.node.text) return null;
    return { key: r.step.id + '.' + r.id, text: textOf(r.step.id, r.id) };
  }

  // 목록 화면에서 아직 안 채운 칸
  function missingSlots(st, pick) {
    var miss = [];
    if (!pick.needSlots) return miss;
    pick.choices.forEach(function (id) {
      var n = st.nodes[id];
      if (!n || !shown(n)) return;
      (n.slots || []).forEach(function (sl) { if (!slotValue(sl)) miss.push(sl.label); });
    });
    return miss;
  }
  // 칸이 다 채워진 목록이면 실제로 가게 될 다음 화면
  function autoTarget(target) {
    for (var guard = 0; guard < 5; guard++) {
      var r = resolve(target);
      if (!r || r.node.kind !== 'pick' || !r.node.autoNext || !r.node.next || missingSlots(r.step, r.node).length) return target;
      var nx = r.node.next;
      target = nx.indexOf('step:') === 0 || nx === 'end' || r.step.id === curStep().id ? nx : 'step:' + r.step.id + '#' + nx;
    }
    return target;
  }
  // 목록으로 돌아가는 버튼 하나만 남는 멘트 화면인지
  function passThrough(n) {
    // pass: 멘트는 앞 화면 버튼에서 읽고 화면은 건너뛴다
    if (n && n.pass && n.next) return true;
    if (!n || n.kind !== 'say' || (n.options && n.options.length) || n.fields || n.calc || !n.next) return false;
    var r = resolve(n.next);
    return !!(r && r.node.kind === 'pick');
  }

  // 이동한 화면이 건너뛸 화면이거나 다 채워진 목록이면 바로 그 다음으로
  function afterMove() {
    var st = curStep(), pp = stepPath(st), n = st.nodes[pp[pp.length - 1]];
    if (passThrough(n) && !state.editMode) { go(n.next, true); return; }
    if (n && n.kind === 'pick' && n.autoNext && n.next && !missingSlots(st, n).length) { go(n.next, true); return; }
    showScene();
  }

  // 지금 보고 있는 화면(단계와 지나온 길)을 쌓아둔다. 이전 버튼은 이걸 하나씩 꺼내 바로 앞 화면으로 간다
  function remember() {
    state.hist.push({ step: state.step, paths: JSON.parse(JSON.stringify(state.paths)) });
    if (state.hist.length > 100) state.hist.shift();
  }

  // 노드 이동: 같은 단계 노드, 'step:id', 'step:id#노드', 'obj:id', 'end'
  // auto: 건너뛰는 화면에서 저절로 넘어가는 이동 (화면을 보여준 적이 없으니 쌓지 않는다)
  function go(target, auto) {
    if (target === 'end') { openDrawer(); return; }
    if (!auto) remember();
    if (target.indexOf('obj:') === 0) {
      var o = objOf(target);
      if (!o) return;
      stepPath(curStep()).push(target);
      savePaths();
      openObjection(o.ob.id);
      showScene();
      return;
    }
    if (target.indexOf('step:') === 0) {
      var parts = target.slice(5).split('#');
      var ts = findStep(parts[0]);
      if (!ts) return;
      if (parts[1]) {
        var tp = stepPath(ts);
        if (tp[tp.length - 1] !== parts[1]) tp.push(parts[1]);
      }
      savePaths();
      setStep(parts[0]);
      afterMove();
      return;
    }
    var s = curStep();
    var n = s.nodes[target];
    // 오프닝에서 고른 연결 경로를 기록에 남긴다
    if (n && n.source) { state.vars.source = n.source; saveVars(); }
    stepPath(s).push(target);
    savePaths();
    afterMove();
  }

  function canBack() {
    return state.hist.length > 0;
  }

  // 이전: 단계가 바뀌었든 아니든 바로 앞에 보던 화면으로
  function back() {
    if (!state.hist.length) return;
    var h = state.hist.pop();
    state.paths = h.paths;
    savePaths();
    setStep(h.step);
    showScene(true);
  }

  // 처음으로: 입력한 값은 두고 흐름만 첫 화면으로
  function restart() {
    state.paths = {};
    state.hist = [];
    savePaths();
    setStep(D.steps[0].id);
    showScene(true);
  }

  // 받침에 맞춰 '로'/'으로'
  function ro(word) {
    var c = word.charCodeAt(word.length - 1) - 0xAC00;
    if (c < 0 || c > 11171) return word + '로';
    var jong = c % 28;
    return word + (jong === 0 || jong === 8 ? '로' : '으로');
  }

  function nextLabel(target, cur) {
    if (cur.nextLabel) return cur.nextLabel;
    if (target === 'end') return '통화 끝, 결과 기록';
    var r = resolve(target);
    if (r && target.indexOf('step:') === 0) return ro(r.step.title);
    if (r && r.node.kind === 'pick' && r.node.label) return ro(r.node.label);
    return '다음';
  }

  function answerOf(id) { return (state.answers[id] || '').trim(); }

  // when: 'new'는 오픈 준비 중 매장만, 'running'은 그 외 매장만 보여준다
  function shown(n) {
    if (!n || !n.when) return true;
    var isNew = state.vars.status === '오픈 준비 중';
    return n.when === 'new' ? isNew : !isNew;
  }
  function slotValue(sl) {
    var v = state.vars[sl.key];
    if (sl.key === 'n') v = parseInt(v, 10) > 0 ? String(parseInt(v, 10)) : '';
    else if (sl.key === 'open' && v) v = fmtKoDate(v);
    if (!v && sl.or) v = state.vars[sl.or];
    if (/^\d+$/.test(String(v || ''))) v += '대';
    return v || '';
  }
  function slotsFilled(n) {
    return !!(n.slots && n.slots.every(function (sl) { return slotValue(sl); }));
  }
  // 이 단계에서 이미 지나온 화면인지
  function visited(id) {
    var s = curStep();
    return stepPath(s).slice(0, -1).indexOf(id) !== -1 || !!answerOf(id);
  }

  function sayHtml(say) {
    if (!say) return '';
    if (say.list) return '<span class="say list">' + esc(say.list) + '</span>';
    return '<span class="say"' + (say.key ? ' data-say="' + say.key + '"' : '') + '>' + fill(say.text, true) + '</span>';
  }

  function choiceBtn(key, target, label, cls, tag, extra) {
    var eff = autoTarget(target);
    if (eff !== target) {
      var pr = resolve(target);
      label = esc(pr.node.nextLabel || nextLabel(pr.node.next, pr.node));
    }
    var say = sayOf(eff);
    return '<button type="button" class="choice ' + (cls || '') + (say ? ' has-say' : '') + '" data-go="' + esc(target) + '" data-key="' + key + '"' + (extra || '') +
      (say && say.key ? ' data-edit="' + say.key + '"' : '') + '>' +
      '<kbd>' + key + '</kbd><span class="c-body"><b>' + label + (tag || '') + '</b>' + sayHtml(say) + '</span></button>';
  }

  // 이 화면에서 그 버튼을 눌러 갔다 온 적이 있는지 (흐리게 보여줄 때)
  function wentFrom(p, from, to) {
    for (var i = 0; i < p.length - 1; i++) if (p[i] === from && p[i + 1] === to) return true;
    return false;
  }

  function navRow() {
    var html = '<div class="nav-row">';
    if (canBack()) html += '<button type="button" class="nav-btn back" id="backBtn">이전</button>';
    var p0 = state.step === D.steps[0].id && stepPath(curStep()).length === 1;
    if (!p0) html += '<button type="button" class="nav-btn home" id="homeBtn">처음으로</button>';
    html += '<span class="nav-gap"></span>';
    if (state.editMode) html += '<button type="button" class="nav-btn ghost" id="editReset">편집 전체 되돌리기</button>';
    html += '<button type="button" class="nav-btn ghost' + (state.editMode ? ' is-on' : '') + '" id="editToggle">' + (state.editMode ? '저장' : '화면 편집') + '</button>';
    return html + '</div>';
  }

  // 이 화면과, 기본 진행으로 이어질 멘트에 들어가는 입력칸
  function sceneFields(s, cur) {
    var list = (cur.fields || []).slice();
    var r = cur.next && resolve(cur.next);
    if (r && r.node.fields && r.node.kind !== 'pick') list = list.concat(r.node.fields);
    var seen = {};
    return list.filter(function (f) { if (seen[f.key]) return false; seen[f.key] = true; return true; });
  }

  function renderFields(list) {
    if (!list.length) return '';
    return '<div class="fields">' + list.map(function (f) {
      var v = state.vars[f.key] || '';
      if (f.type === 'date' || f.type === 'time') {
        var disp = f.type === 'date' ? shortDate(v) : v;
        return '<label class="field"><span>' + esc(f.label) + '</span><input type="text" autocomplete="off" data-var="' + f.key + '" data-kind="' + f.type + '"' +
          ' placeholder="' + (f.type === 'date' ? '예: 10/28, 내일' : '예: 3시, 15:30') + '" value="' + esc(disp) + '"></label>';
      }
      return '<label class="field"><span>' + esc(f.label) + '</span><input type="' + f.type + '" data-var="' + f.key + '"' +
        (f.type === 'number' ? ' min="1" max="99" inputmode="numeric"' : '') +
        ' value="' + esc(v) + '"></label>';
    }).join('') + '</div>';
  }

  // 묶음 합계를 다시 계산해서 대수(sum)와 요약 문장(set)에 넣는다
  function formRecalc(cur) {
    (cur.form || []).forEach(function (g) {
      var total = 0, parts = [];
      g.items.forEach(function (it) {
        if (state.vars[it.key] === undefined && it.def) state.vars[it.key] = it.def;
        var v = int(it.key);
        total += v;
        if (v) parts.push(it.label + ' ' + v);
      });
      // 아직 아무것도 안 넣었으면 앞에서 받은 대수는 그대로 둔다
      if (g.sum && total) state.vars[g.sum] = String(total);
      if (g.set) state.vars[g.set] = parts.join(' · ');
    });
    saveVars();
  }
  function formGroupTotal(g) {
    return g.items.reduce(function (t, it) { return t + int(it.key); }, 0);
  }
  function formOk(cur) {
    return (cur.form || []).every(function (g) { return formGroupTotal(g) > 0; });
  }
  function formSumText(g) {
    var t = formGroupTotal(g);
    var txt = '합계 ' + t + '대';
    if (g.match && int(g.match) && t && t !== int(g.match)) txt += ' (테이블오더 ' + int(g.match) + '대와 다름)';
    return txt;
  }
  function renderForm(s, cur, curId) {
    formRecalc(cur);
    return '<div class="fgroups">' + cur.form.map(function (g, gi) {
      var key = s.id + '.' + curId + '.g' + gi;
      return '<div class="fgroup" data-g="' + gi + '"><div class="fg-head"><b>' + esc(g.label) + '</b>' +
        (g.items.length > 1 ? '<span class="fg-sum" data-sum="' + gi + '">' + esc(formSumText(g)) + '</span>' : '') + '</div>' +
        (g.say ? '<div class="fg-say" data-edit="' + key + '" title="꾹 누르면 수정">' + sayHtml({ key: key, text: textByKey(key) }) + '</div>' : '') +
        '<div class="fg-items">' + g.items.map(function (it, ii) {
          var ph = ii === 0 && g.sum && !formGroupTotal(g) && state.vars[g.sum] ? state.vars[g.sum] : '0';
          return '<label class="fitem"><span class="fi-label">' + esc(it.label) + (it.note ? '<small>' + esc(it.note) + '</small>' : '') + '</span>' +
            '<span class="fi-num"><input type="number" min="0" max="99" inputmode="numeric" data-fv="' + it.key + '" data-g="' + gi + '" value="' + esc(state.vars[it.key] || '') + '" placeholder="' + esc(ph) + '"><em>대</em></span></label>';
        }).join('') + '</div></div>';
    }).join('') + '</div>';
  }

  // 견적에 들어갈 내용을 한눈에
  function renderSummary() {
    var v = state.vars, c = quoteCalc();
    var rows = [
      ['매장', [v.store, v.region, v.status, v.biz].filter(Boolean).join(' · ')],
      ['주문 방식', v.order],
      ['테이블오더', c.units ? c.units + '대' + (v.power ? ' (' + v.power + ')' : '') : ''],
      ['거치대', v.stand],
      ['주방 프린터', int('printers') ? int('printers') + '대' : ''],
      ['인터넷·CCTV', v.net],
      ['포스', v.posNow],
      ['혜택', [v.qBundle ? '인터넷 결합 (포스 세트 무상)' : ''].concat(c.picked.map(function (b) { return b.label; })).filter(Boolean).join(', ')],
      ['월 합계', c.units ? won(c.total) + '원 (36개월)' : '']
    ].filter(function (r) { return r[1]; });
    if (!rows.length) return '';
    return '<div class="summary">' + rows.map(function (r) {
      return '<div class="sm-row' + (r[0] === '월 합계' ? ' total' : '') + '"><span>' + r[0] + '</span><b>' + esc(r[1]) + '</b></div>';
    }).join('') + '</div>';
  }

  // 견적 계산기: 대수, 무상 대수, 결합, 혜택을 고르면 금액 멘트가 바로 바뀐다
  function renderCalc() {
    var v = state.vars, Q = D.quote;
    var ben = v.qBen || [];
    function num(key, label, ph) {
      return '<label class="field"><span>' + label + '</span><input type="number" min="0" max="99" inputmode="numeric" data-q="' + key + '"' +
        ' value="' + esc(v[key] || '') + '" placeholder="' + esc(ph) + '"></label>';
    }
    return '<div class="calc">' +
      '<div class="calc-row">' +
        num('qPost', '후불형 대수', v.n && !v.qPre && String(v.order || '').indexOf('선불') !== 0 ? v.n : '0') +
        num('qPre', '선불형 대수', v.n && !v.qPost && String(v.order || '').indexOf('선불') === 0 ? v.n : '0') +
        num('qFree', '무상 대수', '1') +
      '</div>' +
      '<div class="togs">' +
        '<button type="button" class="tog' + (v.qBundle ? ' is-on' : '') + '" data-qt="qBundle">인터넷 결합 (포스 세트 무상)</button>' +
        Q.benefits.map(function (b) {
          return '<button type="button" class="tog' + (ben.indexOf(b.id) !== -1 ? ' is-on' : '') + '" data-qb="' + b.id + '">' + esc(b.label) +
            (b.approve ? '<small>승인</small>' : '') + '</button>';
        }).join('') +
      '</div>' +
      '<div class="calc-sum" id="calcSum">' + calcSum() + '</div>' +
    '</div>';
  }

  function calcSum() {
    var c = quoteCalc(), Q = D.quote;
    if (!c.units) return '<span class="cs-empty">월 합계 -</span>';
    var parts = [];
    if (c.post) parts.push('후불 ' + c.post + '대');
    if (c.pre) parts.push('선불 ' + c.pre + '대');
    return '<div class="cs-item"><span>테이블오더</span><b>월 ' + won(c.table) + '원</b><small>' + parts.join(' + ') +
        (c.free ? ' 중 ' + c.free + '대 무상' : '') + ', 대당 ' + won(c.unit) + '원</small></div>' +
      '<div class="cs-item"><span>포스·단말기·프린터</span><b>' + (c.pos ? '월 ' + won(c.pos) + '원' : '무상') + '</b><small>' + (c.pos ? '인터넷 결합 시 무상' : '인터넷 결합') + '</small></div>' +
      '<div class="cs-item total"><span>월 합계</span><b>' + won(c.total) + '원</b><small>' + Q.months + '개월 ' + won(c.sum) + '원</small></div>';
  }

  function bindCalc(box) {
    function changed() {
      saveVars();
      var cs = $('#calcSum', box);
      if (cs) cs.innerHTML = calcSum();
      var sb = $('#summaryBox', box);
      if (sb) sb.innerHTML = renderSummary();
      updateSays();
      renderMessages();
    }
    $$('[data-q]', box).forEach(function (inp) {
      inp.addEventListener('input', function () {
        state.vars[inp.dataset.q] = inp.value;
        // 다른 멘트에서 쓰는 대수도 같이 맞춘다
        var c = quoteCalc();
        if (inp.dataset.q !== 'qFree' && c.units) state.vars.n = String(c.units);
        changed();
      });
    });
    $$('[data-qt]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        state.vars[b.dataset.qt] = !state.vars[b.dataset.qt];
        b.classList.toggle('is-on', !!state.vars[b.dataset.qt]);
        changed();
      });
    });
    $$('[data-qb]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var list = (state.vars.qBen || []).slice(), id = b.dataset.qb, at = list.indexOf(id);
        if (at === -1) list.push(id); else list.splice(at, 1);
        state.vars.qBen = list;
        b.classList.toggle('is-on', at === -1);
        changed();
      });
    });
  }

  function renderPick(s, p, cur) {
    var html = '<div class="tiles' + (cur.choices.length <= 3 ? ' few' : '') + '">';
    var no = 0;
    html += cur.choices.map(function (id, ci) {
      var n = s.nodes[id];
      if (!n || !shown(n)) return '';
      no++;
      var filled = slotsFilled(n);
      var done = filled || (!n.slots && (p.indexOf(id) !== -1 || answerOf(id)));
      var say = n.kind === 'pick' ? { list: n.choices.filter(function (c) { return s.nodes[c] && shown(s.nodes[c]); }).map(function (c) { return s.nodes[c].label; }).join(' · ') }
        : filled ? { list: n.slots.map(function (sl) { return (sl.prefix || '') + slotValue(sl); }).join(' · ') }
        : (n.text ? { key: s.id + '.' + id, text: textOf(s.id, id) } : null);
      return '<button type="button" class="tile' + (say ? ' has-say' : '') + (done ? ' is-done' : '') + (filled ? ' is-filled' : '') + '" data-go="' + id + '" data-key="' + no + '" data-ci="' + ci + '"' +
        (say && say.key ? ' data-edit="' + say.key + '"' : '') + '>' +
        '<span class="t-head"><kbd>' + no + '</kbd><b>' + esc(n.label || '') + '</b></span>' +
        sayHtml(say) + '</button>';
    }).join('');
    html += '</div>';
    if (state.editMode) html += '<button type="button" class="add-btn" id="addItem">+ 항목 추가</button>';
    // 빈칸이 남았으면 다음 버튼은 잠가두고 남은 항목을 보여준다
    var missing = missingSlots(s, cur);
    if (cur.next && missing.length) {
      html += '<div class="choices"><button type="button" class="choice primary is-locked" disabled><kbd>Enter</kbd><span class="c-body"><b>' +
        esc(nextLabel(cur.next, cur)) + '</b><span class="say list">남은 항목: ' + esc(missing.join(' · ')) + '</span></span></button></div>';
    } else if (cur.next) {
      html += '<div class="choices">' + choiceBtn('Enter', cur.next, esc(nextLabel(cur.next, cur)), 'primary', '', ' data-nx="1"') + '</div>';
    }
    return html + navRow();
  }

  function renderCard(s, cur, curId) {
    var p = stepPath(s);
    var html = cur.label && cur.kind === 'ask' ? '<p class="scene-tag">' + esc(cur.label) + '</p>' : '';
    if (cur.calc || cur.summary) html += '<div class="summary-wrap" id="summaryBox">' + renderSummary() + '</div>';
    // 버튼 없이 끝나는 화면(재통화 예정일 등)은 읽을 멘트를 카드로
    if (cur.text && !cur.next && !(cur.options || []).length) {
      var own = { key: s.id + '.' + curId, text: textOf(s.id, curId) };
      html += '<div class="refs top"><div class="ref-card" data-edit="' + own.key + '" title="꾹 누르면 수정">' + sayHtml(own) + '</div></div>';
    }
    html += cur.calc ? renderCalc() : renderFields(sceneFields(s, cur));
    if (cur.form) html += renderForm(s, cur, curId);
    if (cur.refs) html += '<div class="refs top">' + cur.refs.map(function (r) {
      var key = 'obj.' + r.obj + '.0';
      return '<div class="ref-card" data-edit="' + key + '" title="꾹 누르면 수정"><b>' + esc(r.label) + '</b>' + sayHtml({ key: key, text: objText(r.obj, 0) }) + '</div>';
    }).join('') + '</div>';
    if (cur.kind === 'ask' && cur.memo !== false) {
      html += '<textarea class="answer" rows="2" data-ans="' + curId + '" placeholder="고객 답변 메모">' +
        esc(state.answers[curId] || '') + '</textarea>';
    }

    // 목록으로 가는 버튼은 아래 좌우로: 이 화면이 돌아갈 목록(기본 진행)은 왼쪽(←), 다른 목록은 오른쪽(→)
    function listDir(t, isNext) {
      var r = resolve(t);
      if (!r || r.node.kind !== 'pick') return '';
      return isNext && t.indexOf('step:') !== 0 ? 'prev' : 'next';
    }
    var key = 1, list = '', prev = '', next = '', reads = '';
    var nextDir = cur.next ? listDir(cur.next, true) : '';
    // 숫자 칸 묶음 화면의 완료 버튼은 가운데 정렬, 다 채우기 전엔 눌리지 않게
    if (cur.next && !nextDir) list += choiceBtn(key++, cur.next, esc(nextLabel(cur.next, cur)), 'primary' + (cur.form ? ' form-done' : ''), '', ' data-nx="1"' + (cur.form && !formOk(cur) ? ' disabled' : ''));
    var dirs = [];
    (cur.options || []).forEach(function (o, i) {
      var ins = optInputs(o);
      if (ins) {
        list += '<div class="choice has-input' + (ins.length > 1 ? ' multi' : '') + '" data-key="' + key + '" data-opt="' + i + '" data-oi="' + i + '">' +
          '<kbd>' + (key++) + '</kbd><b>' + esc(o.label) + (o.note ? '<small>' + esc(o.note) + '</small>' : '') + '</b>' +
          ins.map(function (it) {
            var num = it.type === 'number', v = state.vars[it.key] || '';
            if (it.kind === 'date') v = shortDate(v);
            return '<input type="' + (num ? 'number' : 'text') + '"' + (num ? ' min="1" max="99" inputmode="numeric"' : '') +
              (it.kind ? ' data-kind="' + it.kind + '"' : '') + ' autocomplete="off" data-optvar="' + it.key + '" placeholder="' + esc(it.placeholder) + '" value="' + esc(v) + '">';
          }).join('') +
          '<button type="button" class="go-btn" data-optgo="' + i + '">다음</button></div>';
        return;
      }
      var d = listDir(o.to);
      // 칸만 채우고 목록으로 돌아가는 고객 답은 화살표 대신 멘트 없는 버튼으로
      if (d && o.set) {
        list += '<button type="button" class="choice' + (o.say ? ' has-say' : '') + (wentFrom(p, curId, o.to) ? ' is-done' : '') + '" data-go="' + esc(o.to) + '" data-key="' + key + '" data-oi="' + i + '" data-opt="' + i + '">' +
          '<kbd>' + (key++) + '</kbd><span class="c-body"><b>' + esc(o.label) + '</b>' + (o.say ? sayHtml({ text: o.say }) : '') + '</span></button>';
        return;
      }
      if (d) { dirs.push({ dir: d, to: o.to, label: o.label, extra: ' data-oi="' + i + '"' + (o.set ? ' data-opt="' + i + '"' : '') }); return; }
      // 읽기 전용 화면: 고객 답별 안내를 누르지 않는 카드로 (편집 중에는 버튼으로 보여서 고칠 수 있게)
      if (cur.readOnly && !state.editMode) {
        var sy = sayOf(o.to);
        reads += '<div class="ref-card"' + (sy && sy.key ? ' data-edit="' + sy.key + '" title="꾹 누르면 수정"' : '') + '><b>' + esc(o.label) + '</b>' + sayHtml(sy) + '</div>';
        return;
      }
      var isObj = o.to.indexOf('obj:') === 0;
      var cls = (isObj ? 'is-obj' : '') + (wentFrom(p, curId, o.to) ? ' is-done' : '');
      var cb = choiceBtn(key++, o.to, esc(o.label), cls, isObj ? '<em class="obj">반론 답변</em>' : '', ' data-oi="' + i + '"' + (o.set ? ' data-opt="' + i + '"' : ''));
      // then: 멘트는 to 화면 것을 보여주고, 누르면 then으로 간다 (예: 바로 결과 기록)
      if (o.then) cb = cb.replace('data-go="' + esc(o.to) + '"', 'data-go="' + esc(o.then) + '"');
      list += cb;
    });
    if (nextDir) dirs.push({ dir: nextDir, to: cur.next, label: nextLabel(cur.next, cur), extra: ' data-nx="1" data-enter="1"' });
    // 번호는 왼쪽(←)부터
    dirs.sort(function (a, b) { return (a.dir === 'prev' ? 0 : 1) - (b.dir === 'prev' ? 0 : 1); });
    dirs.forEach(function (d) {
      var b = choiceBtn(key++, d.to, esc(d.label), 'dir dir-' + d.dir, '', d.extra);
      if (d.dir === 'prev') prev += b; else next += b;
    });
    if (reads) html += '<div class="refs top">' + reads + '</div>';
    html += '<div class="choices' + (key <= 4 ? ' few' : '') + '">' + list;
    if (state.editMode) html += '<button type="button" class="add-btn" id="addOption">+ 버튼 추가</button>';
    html += '</div>';
    if (prev || next) html += '<div class="dir-row"><div class="dir-col">' + prev + '</div><div class="dir-col">' + next + '</div></div>';
    return html + navRow();
  }

  // 반론 화면: 해결되면 원래 하던 흐름으로, 계속 망설이면 다음 답변으로
  function renderObj(s, p, curId) {
    var o = objOf(curId);
    var parent = null;
    for (var j = p.length - 1; j >= 0; j--) { if (s.nodes[p[j]]) { parent = s.nodes[p[j]]; break; } }
    var key = 1, list = '';
    if (parent && parent.next) list += choiceBtn(key++, parent.next, '해결됐어요, ' + esc(nextLabel(parent.next, parent)), 'primary');
    if (o.i + 1 < o.ob.answers.length) {
      var nx = 'obj:' + o.ob.id + ':' + (o.i + 1);
      list += '<div class="choice has-input obj-input" data-key="' + key + '" data-objgo="' + nx + '">' +
        '<kbd>' + (key++) + '</kbd><b>그래도 망설인대요</b>' +
        '<input type="text" data-objnote="' + o.ob.id + '" placeholder="고객이 한 말" value="' + esc(state.answers['obj.' + o.ob.id] || '') + '">' +
        '<button type="button" class="go-btn">다음</button></div>' +
        '<div class="obj-next">' + sayHtml(sayOf(nx)) + '</div>';
    }
    var refs = '';
    (parent && parent.options || []).forEach(function (op) {
      var oo = objOf(op.to);
      if (oo && oo.ob.id !== o.ob.id) {
        refs += '<div class="ref-card"><b>' + esc(op.label) + '</b><span class="say">' + fill(objText(oo.ob.id, oo.i), true) + '</span></div>';
      }
    });
    if (refs) list += '<div class="refs">' + refs + '</div>';
    return '<p class="scene-tag">' + esc(o.ob.title) + '</p><div class="choices' + (key <= 4 ? ' few' : '') + '">' + list + '</div>' + navRow();
  }

  function optInputs(o) { return o.inputs || (o.input ? [o.input] : null); }

  // 입력칸이 달린 선택지: 입력값과 상태를 저장하고 이동
  function pickOption(cur, i) {
    var o = cur.options[i];
    var ins = optInputs(o) || [];
    if (o.required && ins.some(function (it) { return !String(state.vars[it.key] || '').trim(); })) {
      var inp = $('#script [data-opt="' + i + '"] input');
      if (inp) { inp.classList.add('is-bad'); inp.focus(); }
      return;
    }
    // 비워두고 넘어가면 기본 문구로 채운다
    if (o.empty) ins.forEach(function (it) { if (!String(state.vars[it.key] || '').trim()) state.vars[it.key] = o.empty; });
    Object.keys(o.set || {}).forEach(function (k) { state.vars[k] = o.set[k]; });
    saveVars();
    go(o.to);
  }

  // 화면 전환: 지금 화면을 살짝 내리고, 새 화면을 올린다
  var sceneBusy = false;
  function showScene(isBack) {
    var box = $('#script');
    if (sceneBusy) return;
    sceneBusy = true;
    box.classList.remove('enter', 'enter-back');
    box.classList.add('leave');
    setTimeout(function () {
      renderScript();
      box.classList.remove('leave');
      void box.offsetWidth;
      box.classList.add(isBack ? 'enter-back' : 'enter');
      window.scrollTo(0, 0);
      sceneBusy = false;
    }, 140);
  }

  function updateSays() {
    $$('#script [data-say]').forEach(function (el) {
      el.innerHTML = fill(textByKey(el.dataset.say), true);
    });
  }

  function renderScript() {
    var s = curStep(), p = stepPath(s);
    var curId = p[p.length - 1];
    var cur = s.nodes[curId];

    var box = $('#script');
    if (!cur) cur = {};
    box.innerHTML = objOf(curId) ? renderObj(s, p, curId) : cur.kind === 'pick' ? renderPick(s, p, cur) : renderCard(s, cur, curId);
    $$('[data-go]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.lp) { delete b.dataset.lp; return; }
        // 숫자 칸 묶음이 있는 화면은 다 채워야 앞으로 간다 (목록으로 돌아가는 건 그냥)
        if (cur.form && !b.classList.contains('dir') && !formOk(cur)) {
          cur.form.forEach(function (g, gi) {
            if (!formGroupTotal(g)) $('.fgroup[data-g="' + gi + '"]', box).classList.add('is-bad');
          });
          var first = $('.fgroup.is-bad input', box);
          if (first) first.focus();
          return;
        }
        if (b.dataset.opt && cur.options) {
          var set = cur.options[Number(b.dataset.opt)].set || {};
          Object.keys(set).forEach(function (k) { state.vars[k] = set[k]; });
          saveVars();
        }
        go(b.dataset.go);
      });
      if (b.dataset.edit) bindLongPress(b, function () { b.dataset.lp = '1'; editLine(b.dataset.edit); });
    });
    bindCalc(box);
    $$('[data-fv]', box).forEach(function (inp) {
      inp.addEventListener('input', function () {
        state.vars[inp.dataset.fv] = inp.value;
        formRecalc(cur);
        var g = cur.form[Number(inp.dataset.g)];
        var sum = $('[data-sum="' + inp.dataset.g + '"]', box);
        if (sum) sum.textContent = formSumText(g);
        // 대수가 바뀌면 거치대 합계 안내도 다시
        $$('[data-sum]', box).forEach(function (el) { el.textContent = formSumText(cur.form[Number(el.dataset.sum)]); });
        $('.fgroup[data-g="' + inp.dataset.g + '"]', box).classList.remove('is-bad');
        var nx = $('.choice.primary[data-nx]', box);
        if (nx) nx.disabled = !formOk(cur);
        updateSays();
        renderMessages();
      });
    });
    $$('.obj-input', box).forEach(function (row) {
      var inp = $('input', row);
      function next() {
        var v = inp.value.trim();
        if (v) state.answers['obj.' + inp.dataset.objnote] = v;
        store.set('answers', state.answers);
        go(row.dataset.objgo);
      }
      row.addEventListener('click', function (e) {
        if (e.target.closest('.go-btn')) next();
        else if (e.target !== inp) inp.focus();
      });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); next(); } });
    });
    var bb = $('#backBtn', box);
    if (bb) bb.addEventListener('click', back);
    var hb = $('#homeBtn', box);
    if (hb) hb.addEventListener('click', restart);
    $('#editToggle', box).addEventListener('click', function () {
      state.editMode = !state.editMode;
      renderScript();
      if (!state.editMode) toast('저장했습니다');
    });
    var er = $('#editReset', box);
    if (er) er.addEventListener('click', function () {
      if (!confirm('화면 편집으로 추가하거나 바꾼 버튼을 모두 처음 상태로 되돌릴까요? (멘트 수정은 그대로 둡니다)')) return;
      store.set('custom', { nodes: {}, added: {} });
      location.reload();
    });
    if (state.editMode && !objOf(curId)) bindEditBars(box, s, cur, curId);
    var ta = $('[data-ans]', box);
    if (ta) ta.addEventListener('input', function () {
      state.answers[ta.dataset.ans] = ta.value;
      store.set('answers', state.answers);
    });
    $$('[data-var]', box).forEach(function (inp) {
      inp.addEventListener('input', function () {
        var v = inp.value;
        if (inp.dataset.kind) {
          v = inp.dataset.kind === 'date' ? parseDateText(v) : parseTimeText(v);
          inp.classList.toggle('is-bad', v === null);
          if (v === null) return;
        }
        state.vars[inp.dataset.var] = v;
        saveVars();
        // 버튼 안 멘트의 값만 다시 그린다 (입력칸 포커스 유지)
        updateSays();
        renderMessages();
      });
    });
    $$('.has-input', box).forEach(function (row) {
      if (row.classList.contains('obj-input')) return;
      var i = Number(row.dataset.opt);
      var inputs = $$('input', row);
      row.addEventListener('click', function (e) {
        if (e.target.closest('.go-btn')) pickOption(cur, i);
        else if (e.target.tagName !== 'INPUT') inputs[0].focus();
      });
      inputs.forEach(function (inp) {
        inp.addEventListener('input', function () {
          var v = inp.value;
          if (inp.dataset.kind === 'date') {
            v = parseDateText(v);
            inp.classList.toggle('is-bad', v === null);
            if (v === null) return;
          } else {
            inp.classList.remove('is-bad');
          }
          state.vars[inp.dataset.optvar] = v;
          saveVars();
          // 같은 값을 받는 다른 버튼의 칸도 맞춘다
          $$('[data-optvar="' + inp.dataset.optvar + '"]', box).forEach(function (o) { if (o !== inp) o.value = inp.value; });
          updateSays();
        });
        inp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); pickOption(cur, i); }
        });
      });
    });
    // 묶음 멘트, 안내 카드도 꾹 눌러 수정
    $$('.fg-say[data-edit], .ref-card[data-edit]', box).forEach(function (el) {
      bindLongPress(el, function () { editLine(el.dataset.edit); });
    });
  }

  // ---------- 화면 편집 ----------
  // 각 버튼 아래에 위로/아래로/이름/삭제를 붙이고, 버튼 추가 창을 띄운다
  function bindEditBars(box, s, cur, curId) {
    box.classList.add('editing');
    function bar(el, tools) {
      var wrap = document.createElement('div');
      wrap.className = 'edit-cell';
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(el);
      var b = document.createElement('div');
      b.className = 'edit-bar';
      b.innerHTML = tools.map(function (t) { return '<button type="button" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('');
      wrap.appendChild(b);
      return b;
    }
    function done() { saveNode(s, curId); renderScript(); }
    function move(arr, i, d) {
      var j = i + d;
      if (j < 0 || j >= arr.length) return;
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      done();
    }
    var tools = [['up', '위로'], ['down', '아래로'], ['name', '이름'], ['del', '삭제']];
    $$('[data-oi]', box).forEach(function (el) {
      var i = Number(el.dataset.oi);
      bar(el, tools).addEventListener('click', function (e) {
        var t = e.target.dataset.t, o = cur.options[i];
        if (!t) return;
        if (t === 'up') move(cur.options, i, -1);
        else if (t === 'down') move(cur.options, i, 1);
        else if (t === 'del') { if (confirm('"' + o.label + '" 버튼을 지울까요?')) { cur.options.splice(i, 1); done(); } }
        else if (t === 'name') openForm('버튼 이름', [{ key: 'label', label: '버튼 이름', value: o.label }], function (v) { o.label = v.label; done(); });
      });
    });
    $$('[data-ci]', box).forEach(function (el) {
      var i = Number(el.dataset.ci);
      bar(el, tools).addEventListener('click', function (e) {
        var t = e.target.dataset.t, id = cur.choices[i], n = s.nodes[id];
        if (!t) return;
        if (t === 'up') move(cur.choices, i, -1);
        else if (t === 'down') move(cur.choices, i, 1);
        else if (t === 'del') { if (confirm('"' + (n.label || '') + '" 항목을 목록에서 뺄까요?')) { cur.choices.splice(i, 1); done(); } }
        else if (t === 'name') openForm('항목 이름', [{ key: 'label', label: '항목 이름', value: n.label || '' }], function (v) { n.label = v.label; saveNode(s, id); renderScript(); });
      });
    });
    $$('[data-nx]', box).forEach(function (el) {
      bar(el, [['name', '이름']]).addEventListener('click', function (e) {
        if (e.target.dataset.t !== 'name') return;
        openForm('버튼 이름', [{ key: 'label', label: '버튼 이름', value: nextLabel(cur.next, cur) }], function (v) { cur.nextLabel = v.label; done(); });
      });
    });
    var ao = $('#addOption', box);
    if (ao) ao.addEventListener('click', function () {
      var dests = destOptions(s, curId, cur);
      openForm('버튼 추가', [
        { key: 'label', label: '버튼 이름 (고객 반응)', value: '' },
        { key: 'text', label: '누르면 읽을 멘트 (비워두면 바로 이동)', type: 'textarea', value: '' },
        { key: 'to', label: '그다음 갈 화면', type: 'select', options: dests, value: dests[0][0] }
      ], function (v) {
        if (!v.label) return;
        var to = v.to;
        if (v.text) to = addNode(s, { kind: 'say', text: v.text, next: v.to });
        cur.options = cur.options || [];
        cur.options.push({ label: v.label, to: to });
        done();
      });
    });
    var ai = $('#addItem', box);
    if (ai) ai.addEventListener('click', function () {
      openForm('항목 추가', [
        { key: 'label', label: '항목 이름', value: '' },
        { key: 'text', label: '읽을 멘트 (질문)', type: 'textarea', value: '' }
      ], function (v) {
        if (!v.label) return;
        var id = addNode(s, { label: v.label, kind: 'ask', text: v.text || v.label, next: curId, options: [] });
        cur.choices.push(id);
        done();
      });
    });
  }

  // 새 버튼이 갈 수 있는 화면: 이 화면, 원래 다음 멘트, 각 목록, 통화 끝
  function destOptions(s, curId, cur) {
    var list = [[curId, '이 화면으로 돌아오기']];
    if (cur.next && !resolve(cur.next) || cur.next && resolve(cur.next).node.kind !== 'pick') list.push([cur.next, '원래 다음 멘트']);
    D.steps.forEach(function (st) {
      Object.keys(st.nodes).forEach(function (id) {
        var n = st.nodes[id];
        if (n.kind !== 'pick') return;
        list.push([st.id === s.id ? id : 'step:' + st.id + '#' + id, st.title + ' · ' + (n.label || '처음 화면')]);
      });
    });
    list.push(['end', '통화 끝 (결과 기록)']);
    return list;
  }

  // 간단한 입력 창 (이름 바꾸기, 버튼 추가)
  function openForm(title, fields, onSave) {
    var m = $('#formModal');
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal';
      m.id = 'formModal';
      m.innerHTML = '<div class="modal-card" role="dialog"><h2></h2><div class="form-body"></div>' +
        '<div class="modal-act"><button type="button" class="btn-ghost" data-f="cancel">취소</button><button type="button" class="btn" data-f="save">저장</button></div></div>';
      document.body.appendChild(m);
      m.addEventListener('click', function (e) {
        var f = e.target.dataset && e.target.dataset.f;
        if (f === 'cancel' || e.target === m) m.classList.remove('is-on');
        if (f === 'save') {
          var vals = {};
          $$('[data-fk]', m).forEach(function (el) { vals[el.dataset.fk] = el.value.trim(); });
          m.classList.remove('is-on');
          if (m._save) m._save(vals);
        }
      });
      m.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.stopPropagation(); m.classList.remove('is-on'); }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); $('[data-f="save"]', m).click(); }
      });
    }
    $('h2', m).textContent = title;
    $('.form-body', m).innerHTML = fields.map(function (f) {
      var lab = '<span>' + esc(f.label) + '</span>';
      if (f.type === 'textarea') return '<label class="form-field">' + lab + '<textarea rows="4" data-fk="' + f.key + '">' + esc(f.value) + '</textarea></label>';
      if (f.type === 'select') return '<label class="form-field">' + lab + '<select data-fk="' + f.key + '">' + f.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === f.value ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></label>';
      return '<label class="form-field">' + lab + '<input type="text" data-fk="' + f.key + '" value="' + esc(f.value) + '"></label>';
    }).join('');
    m._save = onSave;
    m.classList.add('is-on');
    setTimeout(function () { var first = $('[data-fk]', m); if (first) first.focus(); }, 30);
  }

  // 버튼 누를 때 짧은 딸깍 소리
  var audio = null;
  function tick() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var t = audio.currentTime;
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(1700, t);
      o.frequency.exponentialRampToValueAtTime(500, t + 0.03);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.10, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.connect(g);
      g.connect(audio.destination);
      o.start(t);
      o.stop(t + 0.06);
    } catch (e) { /* 소리가 막혀 있어도 동작에는 영향 없음 */ }
  }
  function bindTick() {
    $('#script').addEventListener('pointerdown', function (e) {
      if (e.button === 0 && e.target.closest('button, .choice')) tick();
    });
  }

  // 0.6초 이상 누르고 있으면 실행 (마우스, 터치 공통)
  function bindLongPress(el, fn) {
    var timer = null, x = 0, y = 0;
    function cancel() { clearTimeout(timer); timer = null; el.classList.remove('is-pressing'); }
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      x = e.clientX; y = e.clientY;
      el.classList.add('is-pressing');
      timer = setTimeout(function () { cancel(); fn(); }, 600);
    });
    el.addEventListener('pointermove', function (e) {
      if (timer && (Math.abs(e.clientX - x) > 8 || Math.abs(e.clientY - y) > 8)) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('contextmenu', function (e) { if (timer) e.preventDefault(); });
  }

  // 멘트 직접 고치기 (창으로 띄움). {store} 같은 자리표시는 그대로 두면 값이 들어간다
  function editLine(key) {
    var orig = origByKey(key);
    if (orig == null) return;
    var m = $('#editModal');
    var ta = $('textarea', m);
    ta.value = textByKey(key);
    $('[data-e="reset"]', m).hidden = state.edits[key] == null;
    m.dataset.key = key;
    m.dataset.orig = orig;
    m.classList.add('is-on');
    setTimeout(function () { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 30);
  }
  function closeEdit(msg) {
    $('#editModal').classList.remove('is-on');
    if (msg) { renderScript(); renderObjections(); toast(msg); }
  }
  function bindEdit() {
    var m = $('#editModal');
    var ta = $('textarea', m);
    m.addEventListener('click', function (e) {
      var act = e.target.dataset && e.target.dataset.e;
      var key = m.dataset.key;
      if (act === 'save') {
        var v = ta.value.trim();
        if (!v || v === m.dataset.orig) delete state.edits[key];
        else state.edits[key] = v;
        saveEdits();
        closeEdit('멘트를 저장했습니다');
      } else if (act === 'reset') {
        delete state.edits[key];
        saveEdits();
        closeEdit('원래 멘트로 돌렸습니다');
      } else if (act === 'cancel' || e.target === m) {
        closeEdit();
      }
    });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('[data-e="save"]', m).click(); }
      if (e.key === 'Escape') { e.stopPropagation(); closeEdit(); }
    });
  }

  // 현재 화면의 n번째 선택지 실행 (Enter는 기본 진행)
  function pressKey(k) {
    var b = $('#script [data-key="' + k + '"]') || (k === 'Enter' ? $('#script [data-enter]') : null);
    if (!b) return false;
    tick();
    b.classList.add('is-hit');
    setTimeout(function () { b.click(); }, 90);
    return true;
  }

  // 결과 기록 매장명: 매장명이 있으면 매장명(지역), 없으면 지역·업종으로 만든다
  function autoStoreName() {
    var v = state.vars;
    if (v.store) return v.store + (v.region ? ' (' + v.region + ')' : '');
    var name = [v.region, v.biz].filter(Boolean).join(' ');
    if (name && v.status === '오픈 준비 중') name += ' 오픈 준비';
    return name || v.statusNote || '';
  }

  // 통화 중 받은 정보와 답변을 결과 기록 메모용 문장으로
  function answersMemo() {
    var v = state.vars, lines = [];
    if (v.status) {
      var st = [v.status, v.biz, v.region, v.statusNote].filter(Boolean).join(', ');
      lines.push('매장 상황: ' + st);
    }
    D.steps.forEach(function (s) {
      Object.keys(s.nodes).forEach(function (id) {
        (shown(s.nodes[id]) && s.nodes[id].slots || []).forEach(function (sl) {
          var sv = slotValue(sl);
          if (sv) lines.push(sl.label + ': ' + sv);
        });
      });
    });
    D.objections.forEach(function (ob) {
      var a = (state.answers['obj.' + ob.id] || '').trim();
      if (a) lines.push(ob.title + ': ' + a);
    });
    D.steps.forEach(function (s) {
      Object.keys(s.nodes).forEach(function (id) {
        var a = answerOf(id);
        if (a) lines.push((s.nodes[id].label || '메모') + ': ' + a);
      });
    });
    return lines.join('\n');
  }

  function openObjection(id) {
    var q = $('#objSearch');
    if (q.value) { q.value = ''; }
    openObj = {};
    openObj[id] = true;
    renderObjections();
    var el = $('#objList .o[data-id="' + id + '"]');
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(function () { el.classList.remove('flash'); }, 1200);
  }

  // ---------- 반론 ----------
  var openObj = {};
  function renderObjections() {
    var q = ($('#objSearch').value || '').trim().replace(/\s+/g, ' ');
    var terms = q ? q.split(' ') : [];
    var list = D.objections.filter(function (o) {
      if (!terms.length) return true;
      var hay = (o.title + ' ' + o.keywords + ' ' + o.answers.map(function (a, i) { return objText(o.id, i); }).join(' ')).toLowerCase();
      return terms.every(function (t) { return hay.indexOf(t.toLowerCase()) !== -1; });
    });
    var box = $('#objList');
    if (!list.length) {
      box.innerHTML = '<p class="o-none">맞는 항목이 없습니다. 다른 단어로 찾아보세요.</p>';
      return;
    }
    box.innerHTML = list.map(function (o) {
      var isOpen = openObj[o.id] || (terms.length && list.length <= 2);
      return '<div class="o' + (isOpen ? ' is-open' : '') + '" data-id="' + o.id + '">' +
        '<button class="o-q" type="button">' + esc(o.title) + '</button>' +
        '<div class="o-a">' +
          (o.lostCount ? '<div class="stat">' + esc(o.lostCount) + '</div>' : '') +
          '<ol>' + o.answers.map(function (a, i) {
            var key = 'obj.' + o.id + '.' + i;
            return '<li data-edit="' + key + '"' + (state.edits[key] != null ? ' class="is-edited"' : '') + ' title="꾹 누르면 수정">' + fill(objText(o.id, i), true) + '</li>';
          }).join('') + '</ol>' +
          (o.tip ? '<div class="tip">' + esc(o.tip) + '</div>' : '') +
        '</div></div>';
    }).join('');
    $$('li[data-edit]', box).forEach(function (li) {
      bindLongPress(li, function () { editLine(li.dataset.edit); });
    });
    $$('.o-q', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var el = b.parentNode, id = el.dataset.id;
        openObj[id] = !el.classList.contains('is-open');
        el.classList.toggle('is-open', openObj[id]);
      });
    });
  }

  // ---------- 금액표 ----------
  // 칸을 눌러 바로 고친다. 고친 값은 이 브라우저에 저장 (키: price.그룹.줄.칸)
  function priceCell(gi, ri, ci, orig) {
    var key = 'price.' + gi + '.' + ri + '.' + ci;
    var v = state.edits[key] != null ? state.edits[key] : orig;
    return '<td contenteditable="true" spellcheck="false" data-pk="' + key + '" data-orig="' + esc(orig) + '"' +
      (state.edits[key] != null ? ' class="is-edited"' : '') + '>' + esc(v) + '</td>';
  }

  function renderPrices() {
    var P = prices();
    var unit = [['post', '후불형 대당 월'], ['pre', '선불형 대당 월'], ['pos', '포스·단말기·프린터 세트 월']];
    var html = '<div class="ptable"><h3>견적 계산 단가</h3><div class="unit-row">' +
      unit.map(function (u) {
        return '<label class="field"><span>' + u[1] + '</span><input type="text" inputmode="numeric" data-qp="' + u[0] + '" value="' + won(P[u[0]]) + '"></label>';
      }).join('') + '</div></div>';
    html += D.prices.map(function (g, gi) {
      return '<div class="ptable"><h3>' + esc(g.group) + '</h3><table><tbody>' +
        g.rows.map(function (r, ri) {
          return '<tr>' + priceCell(gi, ri, 0, r[0]) + priceCell(gi, ri, 1, r[1]) + priceCell(gi, ri, 2, r[2]) + '</tr>';
        }).join('') +
        '</tbody></table>' + (g.note ? '<div class="pnote">' + esc(g.note) + '</div>' : '') + '</div>';
    }).join('');
    html += '<div class="price-foot"><button type="button" class="btn-ghost" id="priceReset">금액표 원래대로</button></div>';
    var box = $('#priceTables');
    box.innerHTML = html;
    $$('[data-pk]', box).forEach(function (td) {
      td.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); td.blur(); } });
      td.addEventListener('blur', function () {
        var v = td.textContent.trim();
        if (v === td.dataset.orig) delete state.edits[td.dataset.pk];
        else state.edits[td.dataset.pk] = v;
        td.classList.toggle('is-edited', state.edits[td.dataset.pk] != null);
        saveEdits();
      });
    });
    $$('[data-qp]', box).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var k = inp.dataset.qp;
        var n = parseInt(inp.value.replace(/[^0-9]/g, ''), 10);
        if (!n || n === D.quote[k]) delete state.edits['quote.' + k];
        else state.edits['quote.' + k] = String(n);
        saveEdits();
        inp.value = won(prices()[k]);
        renderScript();
        toast('단가를 바꿨습니다');
      });
    });
    $('#priceReset', box).addEventListener('click', function () {
      if (!confirm('금액표와 단가를 처음 값으로 되돌릴까요?')) return;
      Object.keys(state.edits).forEach(function (k) {
        if (k.indexOf('price.') === 0 || k.indexOf('quote.') === 0) delete state.edits[k];
      });
      saveEdits();
      renderPrices();
      renderScript();
    });
  }

  // ---------- 카톡 문구 ----------
  function renderMessages() {
    var box = $('#msgs');
    box.innerHTML = D.messages.map(function (m, i) {
      return '<div class="msg"><div class="msg-head"><h3>' + esc(m.title) + '</h3>' +
        '<button class="btn-ghost" data-i="' + i + '" type="button">복사</button></div>' +
        '<pre>' + fill(m.text, true) + '</pre></div>';
    }).join('');
    $$('button', box).forEach(function (b) {
      b.addEventListener('click', function () { copyText(fill(D.messages[b.dataset.i].text, false)); });
    });
  }

  // ---------- 결과 기록 ----------
  function fillSelect(sel, items, value) {
    sel.innerHTML = items.map(function (x) {
      return '<option' + (x === value ? ' selected' : '') + '>' + esc(x) + '</option>';
    }).join('');
  }

  function renderSensOpts() {
    $('#sensOpts').innerHTML = ['상', '중', '하'].map(function (k) {
      return '<label class="s-' + k + '"><input type="radio" name="sens" value="' + k + '" required>' +
        k + ' <small>성사 ' + D.sensitivity[k].rate + '</small></label>';
    }).join('');
    $$('#sensOpts input').forEach(function (r) {
      r.addEventListener('change', function () { renderReasons(r.value, []); });
    });
  }

  function renderReasons(level, checked) {
    var s = D.sensitivity[level];
    $('#sensDesc').textContent = s ? s.desc : '';
    if (!s) {
      $('#reasonChips').innerHTML = '<p class="muted">감도를 먼저 고르세요.</p>';
      return;
    }
    $('#reasonChips').innerHTML = s.reasons.map(function (r) {
      return '<label class="chip"><input type="checkbox" name="reason" value="' + esc(r) + '"' +
        (checked.indexOf(r) !== -1 ? ' checked' : '') + '><span>' + esc(r) + '</span></label>';
    }).join('');
  }

  function openDrawer(rec) {
    var f = $('#recordForm');
    f.reset();
    state.editing = rec ? rec.id : null;
    $('#drawerTitle').textContent = rec ? '통화 기록 수정' : '통화 결과 기록';

    var defStage = state.step === 'recall' ? '재컨택' : (state.step === 'close' || state.step === 'quote' ? '견적 후속' : '1차 컨택');
    fillSelect($('#rStage'), D.callStages, rec ? rec.stage : defStage);
    fillSelect($('#rNext'), D.nextActions, rec ? rec.next : D.nextActions[0]);

    f.store.value = rec ? rec.store : autoStoreName();
    f.recallDate.value = rec ? (rec.recallDate || '') : (state.vars.date || '');
    f.memo.value = rec ? (rec.memo || '') : answersMemo();
    f.reasonText.value = rec ? (rec.reasonText || '') : '';

    if (rec && rec.sens) {
      var r = f.querySelector('input[name="sens"][value="' + rec.sens + '"]');
      if (r) r.checked = true;
      renderReasons(rec.sens, rec.reasons || []);
    } else {
      renderReasons(null, []);
    }

    $('#drawer').classList.add('is-on');
    $('#drawer').setAttribute('aria-hidden', 'false');
    setTimeout(function () { (f.store.value ? f.querySelector('input[name="sens"]') : f.store).focus(); }, 30);
  }

  function closeDrawer() {
    $('#drawer').classList.remove('is-on');
    $('#drawer').setAttribute('aria-hidden', 'true');
    state.editing = null;
  }

  function saveRecords() {
    if (!store.set('records', state.records)) {
      toast('저장하지 못했습니다. 브라우저 저장소가 막혀 있는지 확인하세요.');
      return false;
    }
    updateCount();
    return true;
  }

  function bindDrawer() {
    renderSensOpts();
    $$('[data-close]').forEach(function (el) { el.addEventListener('click', closeDrawer); });

    var f = $('#recordForm');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var sens = (f.querySelector('input[name="sens"]:checked') || {}).value;
      if (!sens) { toast('고객감도를 골라주세요'); return; }
      var rec = {
        id: state.editing || ('r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
        ts: Date.now(),
        store: f.store.value.trim(),
        stage: f.stage.value,
        source: state.vars.source || '',
        sens: sens,
        reasons: $$('input[name="reason"]:checked', f).map(function (c) { return c.value; }),
        reasonText: f.reasonText.value.trim(),
        next: f.next.value,
        recallDate: f.recallDate.value,
        memo: f.memo.value.trim()
      };
      var isNew = !state.editing;
      if (state.editing) {
        var old = state.records.filter(function (r) { return r.id === state.editing; })[0];
        if (old) { rec.ts = old.ts; rec.source = old.source || ''; }
        state.records = state.records.map(function (r) { return r.id === rec.id ? rec : r; });
      } else {
        state.records.unshift(rec);
      }
      if (saveRecords()) {
        closeDrawer();
        // 이번 통화를 기록했으면 다음 통화를 위해 입력칸을 비운다 (지난 기록 수정은 그대로)
        if (isNew) resetCall();
        renderLog();
        toast('기록했습니다');
      }
    });

    f.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
  }

  // ---------- 통화 기록 목록 ----------
  function updateCount() {
    var due = state.records.filter(function (r) { return r.recallDate && r.recallDate <= today() && r.next !== '종료'; }).length;
    $('#logCount').textContent = state.records.length ? (due ? state.records.length + ' / 재컨택 ' + due : state.records.length) : '';
  }

  function filteredRecords() {
    var fs = $('#fSens').value, fv = $('#fView').value;
    var ft = ($('#fText').value || '').trim().toLowerCase();
    var t = today(), w = addDays(t, 7);
    return state.records.filter(function (r) {
      if (fs && r.sens !== fs) return false;
      if (fv === 'due' && !(r.recallDate && r.recallDate <= t && r.next !== '종료')) return false;
      if (fv === 'week' && !(r.recallDate && r.recallDate <= w && r.next !== '종료')) return false;
      if (ft && (r.store + ' ' + r.memo + ' ' + r.reasonText).toLowerCase().indexOf(ft) === -1) return false;
      return true;
    }).sort(function (a, b) {
      if (fv) return (a.recallDate || '').localeCompare(b.recallDate || '');
      return b.ts - a.ts;
    });
  }

  function renderLog() {
    var rows = filteredRecords();
    var t = today();
    $('#logBody').innerHTML = rows.map(function (r) {
      var reasons = r.reasons.concat(r.reasonText ? [r.reasonText] : []).join(', ');
      var isDue = r.recallDate && r.recallDate <= t && r.next !== '종료';
      return '<tr data-id="' + r.id + '">' +
        '<td class="nowrap">' + fmtStamp(r.ts) + '</td>' +
        '<td>' + esc(r.store || '-') + '</td>' +
        '<td class="nowrap">' + esc(r.stage) + '</td>' +
        '<td><span class="s s-' + r.sens + '">' + r.sens + '</span></td>' +
        '<td>' + esc(reasons) + '</td>' +
        '<td class="nowrap">' + esc(r.next) + '</td>' +
        '<td class="nowrap' + (isDue ? ' due' : '') + '">' + esc(r.recallDate ? fmtKoDate(r.recallDate) : '') + '</td>' +
        '<td class="memo">' + esc(r.memo) + '</td>' +
        '<td class="row-act"><button data-act="edit" type="button">수정</button><button data-act="del" type="button">삭제</button></td>' +
        '</tr>';
    }).join('');
    $('#logEmpty').style.display = rows.length ? 'none' : 'block';
    $('#logEmpty').textContent = state.records.length ? '조건에 맞는 기록이 없습니다.' : '아직 기록이 없습니다. 통화가 끝나면 위쪽의 결과 기록 버튼으로 남겨주세요.';
    updateCount();
  }

  function bindLog() {
    ['#fSens', '#fView', '#fText'].forEach(function (s) {
      $(s).addEventListener('input', renderLog);
    });

    $('#logBody').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]');
      if (!b) return;
      var id = b.closest('tr').dataset.id;
      var rec = state.records.filter(function (r) { return r.id === id; })[0];
      if (!rec) return;
      if (b.dataset.act === 'edit') openDrawer(rec);
      if (b.dataset.act === 'del') {
        if (!confirm((rec.store || '이 기록') + ' 기록을 삭제할까요?')) return;
        state.records = state.records.filter(function (r) { return r.id !== id; });
        saveRecords();
        renderLog();
      }
    });

    $('#exportCsv').addEventListener('click', exportCsv);
    $('#exportJson').addEventListener('click', function () {
      download('통화기록_백업_' + today() + '.json', JSON.stringify({ version: 1, exported: new Date().toISOString(), records: state.records, edits: state.edits, custom: custom }, null, 2), 'application/json');
    });
    $('#importJson').addEventListener('change', importJson);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    var rows = filteredRecords();
    if (!rows.length) { toast('내보낼 기록이 없습니다'); return; }
    var head = ['일시', '매장', '유입', '통화 단계', '감도', '이유', '이유(직접 입력)', '다음 행동', '재컨택일', '메모'];
    var lines = [head.join(',')].concat(rows.map(function (r) {
      var d = new Date(r.ts);
      var stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      return [stamp, r.store, r.source, r.stage, r.sens, r.reasons.join(' / '), r.reasonText, r.next, r.recallDate, r.memo].map(csvCell).join(',');
    }));
    // 엑셀에서 한글이 깨지지 않도록 BOM 추가
    download('통화기록_' + today() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function importJson(e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var incoming = Array.isArray(data) ? data : data.records;
        if (!Array.isArray(incoming)) throw new Error('형식');
        var ids = {};
        state.records.forEach(function (r) { ids[r.id] = true; });
        var added = incoming.filter(function (r) { return r && r.id && r.sens && !ids[r.id]; }).map(function (r) {
          r.reasons = Array.isArray(r.reasons) ? r.reasons : [];
          return r;
        });
        state.records = state.records.concat(added).sort(function (a, b) { return b.ts - a.ts; });
        saveRecords();
        // 백업에 화면 편집 내용이 있으면 가져오고 새로 연다
        if (data.custom && data.custom.nodes && data.custom.added) {
          Object.keys(data.custom.nodes).forEach(function (k) { custom.nodes[k] = data.custom.nodes[k]; });
          Object.keys(data.custom.added).forEach(function (k) { custom.added[k] = data.custom.added[k]; });
          store.set('custom', custom);
          setTimeout(function () { location.reload(); }, 1200);
        }
        // 백업에 고친 멘트가 있으면 같이 가져온다
        if (data.edits && typeof data.edits === 'object') {
          Object.keys(data.edits).forEach(function (k) {
            if (typeof data.edits[k] === 'string') state.edits[k] = data.edits[k];
          });
          saveEdits();
          renderScript();
        }
        renderLog();
        toast(added.length + '건을 불러왔습니다 (중복 ' + (incoming.length - added.length) + '건 제외)');
      } catch (err) {
        toast('백업 파일을 읽지 못했습니다');
      }
      e.target.value = '';
    };
    reader.readAsText(file, 'utf-8');
  }

  // ---------- 단축키 ----------
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === 'Escape') {
        if ($('#drawer').classList.contains('is-on')) closeDrawer();
        else if (e.target === $('#objSearch')) { e.target.value = ''; renderObjections(); e.target.blur(); }
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if ($('#drawer').classList.contains('is-on')) return;
      if (e.key === '/') {
        e.preventDefault();
        showTab('script');
        $('#objSearch').focus();
        return;
      }
      var onScript = $('.panel[data-panel="script"]').classList.contains('is-on');
      var onButton = tag === 'button';
      if (!onScript) return;
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) {
        e.preventDefault();
        pressKey('Enter');
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'Backspace') { e.preventDefault(); back(); return; }
      // 입력칸이 달린 선택지로 포커스가 옮겨갈 때 숫자가 같이 입력되지 않게 막는다
      if (/^[1-9]$/.test(e.key) && pressKey(e.key)) e.preventDefault();
    });
  }

  // ---------- 시작 ----------
  applyCustom();
  renderHeader();
  bindTop();
  renderScript();
  bindTick();
  bindEdit();
  $('#objSearch').addEventListener('input', renderObjections);
  renderObjections();
  renderPrices();
  renderMessages();
  bindDrawer();
  bindLog();
  bindKeys();
  updateCount();
})();
