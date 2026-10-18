'use strict';
// SMS: с личного Android-телефона (приложение SMS Gateway for Android, облачный режим) или через сервис SMS.ru.
// Все сообщения идут через очередь: пауза между SMS, дневной лимит, тихие часы — чтобы оператор не заблокировал SIM.
// Автосообщения: напоминание о записи накануне, «машина готова», просьба об отзыве после выдачи.
const { db, all, get, run, getSetting, setSetting, normPhone } = require('./db');
const { HttpError } = require('./http');

const DEF = {
  sms_gate_url: 'https://api.sms-gate.app/3rdparty/v1',
  sms_interval: '40', sms_daily_limit: '100', sms_from_hour: '10', sms_to_hour: '20', sms_remind_time: '18:00',
  sms_tpl_remind: '{имя}, ждём вас в Бумсистем {дата} в {время}. Тел. {телефон}',
  sms_tpl_ready: '{имя}, ваш {авто} готов, можно забирать. Бумсистем',
  sms_tpl_review: 'Спасибо, что выбрали Бумсистем! Оставьте отзыв: {2гис}',
};
const KEYS = ['sms_provider', 'sms_gate_url', 'sms_gate_user', 'sms_gate_pass', 'smsru_api_id', 'smsru_from', 'sms_interval', 'sms_daily_limit', 'sms_from_hour', 'sms_to_hour',
  'sms_auto_remind', 'sms_auto_ready', 'sms_auto_review', 'sms_remind_time', 'sms_tpl_remind', 'sms_tpl_ready', 'sms_tpl_review'];
const SECRET = ['sms_gate_pass', 'smsru_api_id'];
const S = (k) => { const v = getSetting(k); return v === undefined || v === null || v === '' ? DEF[k] ?? '' : v; };

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS sms_queue (id INTEGER PRIMARY KEY, phone TEXT NOT NULL, text TEXT NOT NULL, kind TEXT DEFAULT 'manual',
    client_id INTEGER, order_id INTEGER, status TEXT DEFAULT 'queued', error TEXT, ext_id TEXT, user_id INTEGER, batch TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')), sent_at TEXT)`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_queue(status, id)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_auto ON sms_queue(kind, order_id) WHERE kind IN ('remind','ready','review') AND order_id IS NOT NULL");
  const cols = all('PRAGMA table_info(clients)').map((c) => c.name);
  if (!cols.includes('no_sms')) db.exec('ALTER TABLE clients ADD COLUMN no_sms INTEGER DEFAULT 0'); // клиент попросил не писать
}
const provider = () => { const p = getSetting('sms_provider'); return p === 'gate' && getSetting('sms_gate_user') && getSetting('sms_gate_pass') ? 'gate' : p === 'smsru' && getSetting('smsru_api_id') ? 'smsru' : ''; };

// подстановка полей в шаблон
function fill(t, c = {}) {
  const first = /^клиент/i.test(c.name || '') || !c.name ? '' : String(c.name).trim().split(/\s+/)[0];
  return String(t || '')
    .replace(/\{имя\}/g, first || '\u0001').replace(/Здравствуйте, \u0001!/g, 'Здравствуйте!').replace(/^\u0001,\s*(.)/, (m, ch) => ch.toUpperCase()).replace(/\u0001/g, 'добрый день')
    .replace(/\{авто\}/g, c.car || 'автомобиль').replace(/\{дата\}/g, c.date || '').replace(/\{время\}/g, c.time || '').replace(/\{номер\}/g, c.number || '')
    .replace(/\{телефон\}/g, getSetting('company_phone') || '').replace(/\{2гис\}/g, getSetting('twogis_url') || '').replace(/\{авито\}/g, getSetting('social_avito') || '')
    .replace(/[ \t]+\n/g, '\n').trim();
}

function enqueue({ phone, text, kind = 'manual', client_id = null, order_id = null, user_id = null, batch = null }) {
  const n = normPhone(phone);
  if (n.length !== 11 || !/^79/.test(n)) return { skipped: 'не мобильный номер' };
  if (client_id && get('SELECT no_sms FROM clients WHERE id=?', client_id)?.no_sms) return { skipped: 'клиент отказался от SMS' };
  if (!String(text || '').trim()) return { skipped: 'пустой текст' };
  try {
    const r = run('INSERT INTO sms_queue(phone,text,kind,client_id,order_id,user_id,batch) VALUES(?,?,?,?,?,?,?)', '+' + n, String(text).trim().slice(0, 1000), kind, client_id, order_id, user_id, batch);
    return { id: Number(r.lastInsertRowid) };
  } catch (e) { if (/UNIQUE/.test(e.message)) return { skipped: 'уже отправлялось' }; throw e; }
}

async function sendOne(phone, text) {
  const p = provider(); if (!p) throw new Error('SMS не настроены');
  if (p === 'gate') {
    const url = S('sms_gate_url').replace(/\/$/, '') + '/messages';
    const auth = 'Basic ' + Buffer.from(getSetting('sms_gate_user') + ':' + getSetting('sms_gate_pass')).toString('base64');
    const res = await fetch(url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ textMessage: { text }, phoneNumbers: [phone] }), signal: AbortSignal.timeout(20000) });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Неверный логин/пароль SMS-шлюза (смотрите в приложении на телефоне, раздел «Облачный сервер»)');
    if (!res.ok) throw new Error(`SMS-шлюз ответил ${res.status}: ${d.message || d.error || ''}`.trim());
    return { ext_id: d.id || '' };
  }
  const q = new URLSearchParams({ api_id: getSetting('smsru_api_id'), to: phone.replace(/\D/g, ''), msg: text, json: '1' });
  if (getSetting('smsru_from')) q.set('from', getSetting('smsru_from'));
  const res = await fetch('https://sms.ru/sms/send', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: q, signal: AbortSignal.timeout(20000) });
  const d = await res.json().catch(() => ({}));
  if (d.status !== 'OK') throw new Error('SMS.ru: ' + (d.status_text || d.status_code || res.status));
  const one = Object.values(d.sms || {})[0] || {};
  if (one.status !== 'OK') throw new Error('SMS.ru: ' + (one.status_text || one.status_code));
  if (d.balance !== undefined) setSetting('sms_balance', String(d.balance));
  return { ext_id: one.sms_id || '' };
}

const hourNow = () => new Date().getHours() + new Date().getMinutes() / 60;
const sentToday = () => get("SELECT COUNT(*) n FROM sms_queue WHERE status='sent' AND sent_at>=date('now','localtime')").n;
let busy = false, lastSent = 0;
async function tick() {
  if (busy || !provider()) return; busy = true;
  try {
    const h = hourNow();
    if (h < +S('sms_from_hour') || h >= +S('sms_to_hour')) return;                 // тихие часы
    if (sentToday() >= +S('sms_daily_limit')) return;                                // дневной лимит
    const gap = (provider() === 'smsru' ? 2 : Math.max(10, +S('sms_interval'))) * 1000;
    if (Date.now() - lastSent < gap) return;
    const m = get("SELECT * FROM sms_queue WHERE status='queued' ORDER BY CASE kind WHEN 'manual' THEN 1 WHEN 'bulk' THEN 3 ELSE 0 END, id LIMIT 1");
    if (!m) return;
    lastSent = Date.now();
    try {
      const r = await sendOne(m.phone, m.text);
      run("UPDATE sms_queue SET status='sent', ext_id=?, error=NULL, sent_at=datetime('now','localtime') WHERE id=?", r.ext_id || null, m.id);
      if (m.kind === 'review' && m.order_id) run("UPDATE orders SET review_asked_at=COALESCE(review_asked_at, datetime('now','localtime')) WHERE id=?", m.order_id);
      setSetting('sms_error', '');
    } catch (e) {
      run("UPDATE sms_queue SET status='error', error=? WHERE id=?", e.message.slice(0, 300), m.id);
      setSetting('sms_error', e.message.slice(0, 300));
    }
  } finally { busy = false; }
}

// автосообщения по заказам
function orderCtx(o) {
  const at = o.scheduled_at || '';
  return { name: o.client_name, car: [o.brand, o.model].filter(Boolean).join(' '), number: 'БС-' + String(o.id).padStart(5, '0'),
    date: at ? `${at.slice(8, 10)}.${at.slice(5, 7)}` : '', time: at.slice(11, 16) };
}
const Q = `SELECT o.*, c.name client_name, c.phone client_phone, c.id cid, ca.brand, ca.model FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id`;
function autos() {
  if (!provider()) return;
  const now = new Date(); const hm = now.toTimeString().slice(0, 5);
  const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  if (getSetting('sms_auto_remind') === '1' && hm >= S('sms_remind_time')) {
    const t = new Date(now); t.setDate(t.getDate() + 1);
    for (const o of all(`${Q} WHERE o.status IN ('new','scheduled') AND substr(o.scheduled_at,1,10)=? AND c.phone IS NOT NULL`, ymd(t)))
      enqueue({ phone: o.client_phone, text: fill(S('sms_tpl_remind'), orderCtx(o)), kind: 'remind', client_id: o.cid, order_id: o.id });
  }
  if (getSetting('sms_auto_ready') === '1') {
    for (const o of all(`${Q} WHERE o.status='done' AND o.done_at>=datetime('now','localtime','-3 hours') AND c.phone IS NOT NULL`))
      enqueue({ phone: o.client_phone, text: fill(S('sms_tpl_ready'), orderCtx(o)), kind: 'ready', client_id: o.cid, order_id: o.id });
  }
  if (getSetting('sms_auto_review') === '1' && hm >= '12:00') {
    for (const o of all(`${Q} WHERE o.status='issued' AND o.review_asked_at IS NULL AND o.issued_at < datetime('now','localtime','-20 hours') AND o.issued_at >= datetime('now','localtime','-4 days') AND c.phone IS NOT NULL`))
      enqueue({ phone: o.client_phone, text: fill(S('sms_tpl_review'), orderCtx(o)), kind: 'review', client_id: o.cid, order_id: o.id });
  }
}

function register(r, OFFICE, ADMIN) {
  r.get('/api/sms', ADMIN, () => ({
    ...Object.fromEntries(KEYS.filter((k) => !SECRET.includes(k)).map((k) => [k, S(k)])),
    has_gate_pass: !!getSetting('sms_gate_pass'), has_smsru: !!getSetting('smsru_api_id'), active: provider(),
    error: getSetting('sms_error') || '', balance: getSetting('sms_balance') || '',
    today: sentToday(), queued: get("SELECT COUNT(*) n FROM sms_queue WHERE status='queued'").n,
  }));
  r.put('/api/sms', ADMIN, (ctx) => {
    for (const k of KEYS) if (ctx.body[k] !== undefined) { if (SECRET.includes(k) && !String(ctx.body[k]).trim()) continue; setSetting(k, typeof ctx.body[k] === 'boolean' ? (ctx.body[k] ? '1' : '0') : String(ctx.body[k]).trim()); }
    setSetting('sms_error', ''); return { ok: true };
  });
  r.post('/api/sms/test', ADMIN, async (ctx) => {
    const n = normPhone(ctx.body.phone); if (n.length !== 11) throw new HttpError(400, 'Укажите номер для проверки');
    try { const res = await sendOne('+' + n, String(ctx.body.text || 'Проверка SMS из CRM Бумсистем')); run("INSERT INTO sms_queue(phone,text,kind,status,user_id,sent_at,ext_id) VALUES(?,?,'test','sent',?,datetime('now','localtime'),?)", '+' + n, String(ctx.body.text || 'Проверка'), ctx.user.id, res.ext_id || null); return { ok: true }; }
    catch (e) { throw new HttpError(502, e.message); }
  });
  // поставить в очередь: одному или списку клиентов
  r.post('/api/sms/send', OFFICE, (ctx) => {
    const b = ctx.body || {}; if (!provider()) throw new HttpError(400, 'SMS не настроены: Настройки → «SMS-рассылка»');
    const list = Array.isArray(b.to) ? b.to.slice(0, 3000) : [{ phone: b.phone, client_id: b.client_id, order_id: b.order_id, name: b.name, car: b.car }];
    const batch = list.length > 1 ? 'b' + Date.now().toString(36) : null;
    let queued = 0; const skipped = {};
    for (const x of list) {
      const res = enqueue({ phone: x.phone, text: fill(b.text, x), kind: list.length > 1 ? 'bulk' : (b.kind || 'manual'), client_id: x.client_id || null, order_id: x.order_id || null, user_id: ctx.user.id, batch });
      if (res.id) queued++; else skipped[res.skipped] = (skipped[res.skipped] || 0) + 1;
    }
    const perDay = +S('sms_daily_limit'), gap = provider() === 'smsru' ? 2 : Math.max(10, +S('sms_interval'));
    return { queued, skipped, est_minutes: Math.ceil(queued * gap / 60), est_days: Math.ceil(queued / Math.max(1, perDay)) };
  });
  r.get('/api/sms/queue', ADMIN, () => ({
    rows: all("SELECT q.*, c.name client FROM sms_queue q LEFT JOIN clients c ON c.id=q.client_id ORDER BY CASE q.status WHEN 'queued' THEN 0 ELSE 1 END, q.id DESC LIMIT 300"),
    stats: get(`SELECT SUM(status='queued') queued, SUM(status='sent' AND sent_at>=date('now','localtime')) today, SUM(status='error' AND created_at>=date('now','localtime','-7 days')) errors FROM sms_queue`),
  }));
  r.post('/api/sms/cancel', ADMIN, (ctx) => {
    const b = ctx.body || {};
    const n = b.id ? run("UPDATE sms_queue SET status='cancelled' WHERE id=? AND status='queued'", +b.id).changes
      : b.batch ? run("UPDATE sms_queue SET status='cancelled' WHERE batch=? AND status='queued'", String(b.batch)).changes
        : run("UPDATE sms_queue SET status='cancelled' WHERE status='queued'").changes;
    return { cancelled: n };
  });
  r.post('/api/sms/retry', ADMIN, (ctx) => ({ n: run("UPDATE sms_queue SET status='queued', error=NULL WHERE status='error' AND (? IS NULL OR id=?)", ctx.body.id || null, ctx.body.id || null).changes }));
  r.post('/api/clients/:id/no-sms', OFFICE, (ctx) => { run('UPDATE clients SET no_sms=? WHERE id=?', ctx.body.on ? 1 : 0, +ctx.params.id); if (ctx.body.on) run("UPDATE sms_queue SET status='cancelled' WHERE client_id=? AND status='queued'", +ctx.params.id); return { ok: true }; });
}

let t1 = null, t2 = null;
function start() {
  migrate();
  if (t1) return;
  t1 = setInterval(() => { tick().catch(() => {}); }, 5000); t1.unref?.();
  t2 = setInterval(() => { try { autos(); } catch (e) { console.error('SMS autos:', e.message); } }, 60000); t2.unref?.();
}

module.exports = { migrate, register, start, enqueue, fill, sendOne, tick, autos, provider };
