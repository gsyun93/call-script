// 세일즈 마스터 → 파이프드라이브 기록 (수퍼베이스 서버 함수)
// - 파이프드라이브 토큰은 수퍼베이스 비밀값 PIPEDRIVE_TOKEN 에만 있다 (화면, 저장소에는 없음)
// - 로그인한 툴 주인만 부를 수 있다
// - 딜 소유자와 토큰 주인이 다르면 아무것도 쓰지 않고 멈춘다
// action:
//   load  { dealId }  딜 정보, 채울 항목의 지금 값과 선택지, 오늘까지 남은 미완료 재컨택
//   save  { dealId, fields, closeDate, today, next, skip }  항목 채우기 → 오늘 통화(완료) → 넥스트 액션(미완료)
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_USERS = ['569ada9e-74e3-4a97-adb0-c4399fd51451'];
const TOKEN = Deno.env.get('PIPEDRIVE_TOKEN') || '';
const API = 'https://api.pipedrive.com';
// 툴에서 채우는 딜 항목 (이름으로 찾는다)
const FIELD_NAMES = ['★리드 감도', '매장 운영 여부', '매장명', '테이블 수', '오픈예정일자', '업종', '[Product] 경쟁사', '사용 포스', '매장 운영'];
const ACTIVITY_NAME = '재컨택';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function reply(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}
class PdError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

// ---------- 파이프드라이브 호출 ----------
async function pd(method: string, path: string, body?: unknown) {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers: { 'x-api-token': TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (_e) {
    throw new PdError('network', '파이프드라이브에 연결할 수 없습니다');
  }
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch (_e) { json = null; }
  if (res.status === 401) throw new PdError('token', '파이프드라이브 토큰을 확인해 주세요');
  if (res.status === 403) throw new PdError('permission', '파이프드라이브 권한이 없습니다');
  if (res.status === 429) throw new PdError('limit', '파이프드라이브 사용량 한도를 넘었습니다. 잠시 뒤 다시 보내주세요');
  return { status: res.status, json };
}
async function pdOk(method: string, path: string, body?: unknown) {
  const r = await pd(method, path, body);
  if (r.status === 404 || r.status === 410) throw new PdError('gone', '파이프드라이브 주소 없음 (' + path + ')');
  if (r.status >= 400 || !r.json || r.json.success === false) {
    const msg = (r.json && (r.json.error || r.json.message)) || ('HTTP ' + r.status);
    throw new PdError('api', '파이프드라이브 오류: ' + msg);
  }
  return r.json.data;
}
// v1이 막혀 있으면(없어진 주소) v2로 다시 보낸다
async function withFallback(v1: () => Promise<any>, v2: () => Promise<any>) {
  try {
    return await v1();
  } catch (e) {
    if (e instanceof PdError && e.code === 'gone') return await v2();
    throw e;
  }
}

// ---------- 날짜 ----------
function todayKst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
// 한국 시간 → 파이프드라이브 활동 시간(국제 표준시)
function kstToUtc(date: string, time?: string) {
  if (!time || !/^\d{1,2}:\d{2}$/.test(time)) return { due_date: date, due_time: undefined as string | undefined };
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, hh - 9, mm));
  return { due_date: t.toISOString().slice(0, 10), due_time: t.toISOString().slice(11, 16) };
}
function noteHtml(s: string) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// ---------- 딜과 항목 ----------
async function meId() {
  const me = await pdOk('GET', '/v1/users/me');
  return { id: Number(me.id), name: me.name };
}
async function loadDeal(dealId: number) {
  const r = await pd('GET', '/v1/deals/' + dealId);
  if (r.status === 404 || !r.json || !r.json.data) throw new PdError('notfound', '딜을 찾을 수 없습니다 (' + dealId + ')');
  if (r.status >= 400) throw new PdError('api', '파이프드라이브 오류: HTTP ' + r.status);
  return r.json.data;
}
function ownerOf(deal: any) {
  const u = deal.user_id;
  return { id: Number(u && typeof u === 'object' ? u.id : u), name: u && typeof u === 'object' ? u.name : '' };
}
async function checkOwner(dealId: number) {
  const [me, deal] = await Promise.all([meId(), loadDeal(dealId)]);
  const owner = ownerOf(deal);
  if (owner.id !== me.id) throw new PdError('owner', '담당자가 일치하지 않습니다 (딜 소유자: ' + (owner.name || owner.id) + ')');
  return { me, deal, owner };
}
async function dealFields() {
  const out: any[] = [];
  let start = 0;
  for (let i = 0; i < 10; i++) {
    const r = await pd('GET', '/v1/dealFields?limit=500&start=' + start);
    if (r.status >= 400 || !r.json) throw new PdError('api', '딜 항목을 불러오지 못했습니다');
    out.push(...(r.json.data || []));
    const more = r.json.additional_data && r.json.additional_data.pagination;
    if (!more || !more.more_items_in_collection) break;
    start = more.next_start;
  }
  const byName: Record<string, any> = {};
  for (const f of out) if (FIELD_NAMES.includes(f.name)) byName[f.name] = f;
  return byName;
}
function idsOf(raw: unknown): number[] {
  if (raw === null || raw === undefined || raw === '') return [];
  if (Array.isArray(raw)) return raw.map(Number).filter((n) => !isNaN(n));
  return String(raw).split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
}
function currentOf(f: any, deal: any) {
  const raw = deal[f.key];
  const opts = f.options || [];
  if (f.field_type === 'enum') {
    const o = opts.find((x: any) => String(x.id) === String(raw));
    return o ? o.label : '';
  }
  if (f.field_type === 'set') {
    const ids = idsOf(raw);
    return opts.filter((x: any) => ids.includes(Number(x.id))).map((x: any) => x.label);
  }
  return raw === null || raw === undefined ? '' : String(raw);
}
async function activityTypeKey() {
  const types = await pdOk('GET', '/v1/activityTypes');
  const t = (types || []).find((x: any) => x.name === ACTIVITY_NAME && x.active_flag !== false);
  if (!t) throw new PdError('api', '"' + ACTIVITY_NAME + '" 활동 유형을 찾을 수 없습니다');
  return t.key_string;
}
async function pendingRecontacts(dealId: number, typeKey: string) {
  const r = await pd('GET', '/v1/deals/' + dealId + '/activities?done=0&limit=100');
  const list = (r.json && r.json.data) || [];
  const t = todayKst();
  return list
    .filter((a: any) => a.type === typeKey && !a.done && a.due_date && a.due_date <= t)
    .sort((a: any, b: any) => String(b.due_date).localeCompare(String(a.due_date)))
    .map((a: any) => ({ id: a.id, due_date: a.due_date, due_time: a.due_time, subject: a.subject, note: a.note || '' }));
}

// ---------- load ----------
async function actionLoad(dealId: number) {
  const { deal, owner } = await checkOwner(dealId);
  const [fields, typeKey] = await Promise.all([dealFields(), activityTypeKey()]);
  const pending = await pendingRecontacts(dealId, typeKey);
  return {
    ok: true,
    deal: { id: deal.id, title: deal.title, status: deal.status, owner: owner.name, expected_close_date: deal.expected_close_date || '' },
    fields: FIELD_NAMES.filter((n) => fields[n]).map((n) => {
      const f = fields[n];
      return { name: n, type: f.field_type, options: (f.options || []).map((o: any) => o.label), current: currentOf(f, deal) };
    }),
    missing: FIELD_NAMES.filter((n) => !fields[n]),
    pending,
  };
}

// ---------- save ----------
async function saveFields(dealId: number, deal: any, input: Record<string, any>, closeDate?: string) {
  const fields = await dealFields();
  const update: Record<string, any> = {};
  const v2custom: Record<string, any> = {};
  const changed: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const name of Object.keys(input || {})) {
    const f = fields[name];
    const val = input[name];
    if (!f) { skipped.push({ name, reason: '항목 없음' }); continue; }
    const cur = currentOf(f, deal);
    const opts = f.options || [];
    if (f.field_type === 'set') {
      const want = (Array.isArray(val) ? val : [val]).map(String);
      const newIds = opts.filter((o: any) => want.includes(o.label)).map((o: any) => Number(o.id));
      const unknown = want.filter((w) => !opts.some((o: any) => o.label === w));
      if (unknown.length) skipped.push({ name, reason: '목록에 없음: ' + unknown.join(', ') });
      const ids = Array.from(new Set(idsOf(deal[f.key]).concat(newIds)));
      if (!newIds.length || ids.length === idsOf(deal[f.key]).length) { if (!unknown.length) skipped.push({ name, reason: '이미 들어 있음' }); continue; }
      update[f.key] = ids.join(',');
      v2custom[f.key] = ids;
      changed.push(name);
      continue;
    }
    // 하나짜리 항목은 비어 있을 때만 채운다
    if (cur !== '' && cur !== null) { skipped.push({ name, reason: '기존 값 유지: ' + cur }); continue; }
    if (f.field_type === 'enum') {
      const o = opts.find((x: any) => x.label === String(val));
      if (!o) { skipped.push({ name, reason: '목록에 없음: ' + val }); continue; }
      update[f.key] = o.id;
      v2custom[f.key] = Number(o.id);
    } else if (f.field_type === 'date') {
      if (!isDate(val)) { skipped.push({ name, reason: '날짜 형식 아님: ' + val }); continue; }
      update[f.key] = val;
      v2custom[f.key] = val;
    } else {
      const s = String(val ?? '').trim();
      if (!s) continue;
      update[f.key] = s;
      v2custom[f.key] = s;
    }
    changed.push(name);
  }
  // 예상 완료 날짜는 오픈·도입 예정일로 맞춘다 (있어도 바꾼다)
  let closeChanged = false;
  if (isDate(closeDate) && deal.expected_close_date !== closeDate) {
    update.expected_close_date = closeDate;
    closeChanged = true;
  }
  if (!Object.keys(update).length) return { ok: true, changed, skipped, closeChanged };
  await withFallback(
    () => pdOk('PUT', '/v1/deals/' + dealId, update),
    () => pdOk('PATCH', '/api/v2/deals/' + dealId, {
      ...(closeChanged ? { expected_close_date: closeDate } : {}),
      ...(Object.keys(v2custom).length ? { custom_fields: v2custom } : {}),
    }),
  );
  return { ok: true, changed: closeChanged ? changed.concat('예상 완료 날짜') : changed, skipped, closeChanged };
}
async function saveToday(dealId: number, typeKey: string, today: any) {
  const note = noteHtml(today && today.note);
  const completeId = today && Number(today.completeId);
  if (completeId) {
    // 잡혀 있던 재컨택을 완료로 바꾸고, 원래 노트 아래에 오늘 통화 내용을 붙인다
    const r = await pd('GET', '/v1/activities/' + completeId);
    const old = (r.json && r.json.data) || null;
    if (old && Number(old.deal_id) === dealId && !old.done) {
      const merged = (old.note ? old.note + '<br><br>' : '') + note;
      await withFallback(
        () => pdOk('PUT', '/v1/activities/' + completeId, { done: 1, note: merged }),
        () => pdOk('PATCH', '/api/v2/activities/' + completeId, { done: true, note: merged }),
      );
      return { ok: true, id: completeId, mode: 'completed' };
    }
  }
  const body = { subject: ACTIVITY_NAME, type: typeKey, deal_id: dealId, done: 1, due_date: todayKst(), note };
  const a = await withFallback(
    () => pdOk('POST', '/v1/activities', body),
    () => pdOk('POST', '/api/v2/activities', { ...body, done: true }),
  );
  return { ok: true, id: a && a.id, mode: 'created' };
}
async function saveNext(dealId: number, typeKey: string, next: any) {
  if (!next || !isDate(next.date)) return { ok: true, skipped: true };
  const when = kstToUtc(next.date, next.time);
  const body: Record<string, any> = { subject: ACTIVITY_NAME, type: typeKey, deal_id: dealId, done: 0, due_date: when.due_date, note: noteHtml(next.note) };
  if (when.due_time) body.due_time = when.due_time;
  const a = await withFallback(
    () => pdOk('POST', '/v1/activities', body),
    () => pdOk('POST', '/api/v2/activities', { ...body, done: false }),
  );
  return { ok: true, id: a && a.id };
}
async function actionSave(dealId: number, p: any) {
  const { deal } = await checkOwner(dealId);
  const skip: string[] = Array.isArray(p.skip) ? p.skip : [];
  const typeKey = await activityTypeKey();
  const steps: Record<string, any> = {};
  // 단계마다 따로 기록해서, 실패한 단계만 다시 보낼 수 있게
  for (const [name, run] of [
    ['fields', () => saveFields(dealId, deal, p.fields || {}, p.closeDate)],
    ['today', () => saveToday(dealId, typeKey, p.today)],
    ['next', () => saveNext(dealId, typeKey, p.next)],
  ] as [string, () => Promise<any>][]) {
    if (skip.includes(name)) { steps[name] = { ok: true, skipped: true, before: true }; continue; }
    try {
      steps[name] = await run();
    } catch (e) {
      steps[name] = { ok: false, code: e instanceof PdError ? e.code : 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: Object.values(steps).every((s: any) => s.ok), steps };
}

// ---------- 시작 ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    // 로그인한 툴 주인만
    const auth = req.headers.get('Authorization') || '';
    const jwt = auth.replace(/^Bearer\s+/i, '');
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data } = await sb.auth.getUser(jwt);
    if (!data || !data.user || !ALLOWED_USERS.includes(data.user.id)) return reply({ ok: false, code: 'auth', message: '툴에 다시 로그인해 주세요' });
    if (!TOKEN) return reply({ ok: false, code: 'token', message: '수퍼베이스에 PIPEDRIVE_TOKEN 이 없습니다' });

    const p = await req.json().catch(() => ({}));
    const dealId = Number(String(p.dealId || '').replace(/[^0-9]/g, ''));
    if (!dealId) return reply({ ok: false, code: 'input', message: '딜 ID를 확인해 주세요' });
    if (p.action === 'load') return reply(await actionLoad(dealId));
    if (p.action === 'save') return reply(await actionSave(dealId, p));
    return reply({ ok: false, code: 'input', message: '알 수 없는 요청' });
  } catch (e) {
    if (e instanceof PdError) return reply({ ok: false, code: e.code, message: e.message });
    return reply({ ok: false, code: 'error', message: e instanceof Error ? e.message : String(e) });
  }
});
