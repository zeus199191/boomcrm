'use strict';
// Напоминания: создают сотрудники с правом «Напоминания» (Александр, Никита, администраторы) — себе и/или другим.
// Показываются в CRM при первом входе (и в течение дня, когда наступит время), по желанию дублируются в MAX.
// Повтор: однократно / каждые N дней / по дням недели / каждый месяц; ограничение — число повторений и/или дата окончания.
const { db, all, get, run, getSetting } = require('./db');
const { HttpError } = require('./http');

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, title TEXT NOT NULL, text TEXT, created_by INTEGER,
    recipients TEXT NOT NULL, start_date TEXT NOT NULL, time TEXT, repeat TEXT DEFAULT 'once', every INTEGER DEFAULT 1, dows TEXT,
    count INTEGER, end_date TEXT, until_done INTEGER DEFAULT 0, max_send INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')))`);
  // отметки по каждому получателю и каждому повтору (дате)
  db.exec(`CREATE TABLE IF NOT EXISTS reminder_marks (reminder_id INTEGER NOT NULL, user_id INTEGER NOT NULL, occ TEXT NOT NULL,
    shown_at TEXT, done_at TEXT, snooze_until TEXT, max_sent_at TEXT, PRIMARY KEY (reminder_id, user_id, occ))`);
}

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const nowStr = () => { const d = new Date(); return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const today = () => ymd(new Date());
const hm = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

// даты повторов от начала до upto (включительно), с учётом количества и даты окончания
function occurrences(r, upto, limit = 400) {
  const out = []; const end = r.end_date && r.end_date < upto ? r.end_date : upto;
  const max = r.count > 0 ? r.count : Infinity;
  let d = parse(r.start_date); const start = new Date(d);
  const dows = String(r.dows || '').split(',').filter(Boolean).map(Number);
  for (let guard = 0; guard < 5000 && out.length < Math.min(max, limit); guard++) {
    const s = ymd(d); if (s > end) break;
    if (r.repeat === 'once') { out.push(s); break; }
    if (r.repeat === 'daily') { out.push(s); d.setDate(d.getDate() + Math.max(1, r.every || 1)); continue; }
    if (r.repeat === 'weekly') { if ((dows.length ? dows : [start.getDay()]).includes(d.getDay())) out.push(s); d.setDate(d.getDate() + 1); continue; }
    if (r.repeat === 'monthly') {
      out.push(s);
      const n = new Date(start.getFullYear(), start.getMonth() + out.length * Math.max(1, r.every || 1), 1, 12);
      n.setDate(Math.min(start.getDate(), new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate())); d = n; continue;
    }
    break;
  }
  return out;
}
// следующая дата повтора после сегодняшнего дня (для списка)
function nextOcc(r) {
  const t = today(); const list = occurrences(r, '2100-01-01', 2000);
  return list.find((s) => s > t || (s === t && (!r.time || r.time > hm()))) || null;
}
const recips = (r) => { try { return JSON.parse(r.recipients) || []; } catch { return []; } };

// что показать пользователю сейчас: последний наступивший повтор, если он не отмечен (и не отложен)
function dueFor(userId) {
  const t = today(), now = hm(), stamp = nowStr();
  const out = [];
  for (const r of all('SELECT * FROM reminders WHERE active=1 AND start_date<=?', t)) {
    if (!recips(r).includes(userId)) continue;
    // повторы раньше дня создания напоминания не всплывают (например, ежемесячное с прошлой датой начала)
    const occ = occurrences(r, t, 2000).filter((s) => (s < t || !r.time || r.time <= now) && s >= String(r.created_at || '').slice(0, 10)).at(-1);
    if (!occ) continue;
    const m = get('SELECT * FROM reminder_marks WHERE reminder_id=? AND user_id=? AND occ=?', r.id, userId, occ);
    if (m && m.done_at) continue;
    if (m && m.snooze_until && m.snooze_until > stamp) continue;
    // «пока не отмечу выполненным» — пропущенные повторы не теряются; иначе показываем только последний
    const by = r.created_by ? get('SELECT name FROM users WHERE id=?', r.created_by) : null;
    out.push({ id: r.id, occ, title: r.title, text: r.text || '', until_done: !!r.until_done, from: by ? by.name : '', self: r.created_by === userId });
  }
  return out;
}

function mark(rid, uid, occ, fields) {
  run(`INSERT INTO reminder_marks(reminder_id,user_id,occ) VALUES(?,?,?) ON CONFLICT DO NOTHING`, rid, uid, occ);
  for (const [k, v] of Object.entries(fields)) run(`UPDATE reminder_marks SET ${k}=? WHERE reminder_id=? AND user_id=? AND occ=?`, v, rid, uid, occ);
}

function clean(b, userId) {
  const title = String(b.title || '').trim(); if (!title) throw new HttpError(400, 'Укажите, о чём напомнить');
  let rec = (Array.isArray(b.recipients) ? b.recipients : []).map(Number).filter(Boolean);
  if (!rec.length) rec = [userId];
  const D = /^\d{4}-\d{2}-\d{2}$/;
  const start = D.test(b.start_date || '') ? b.start_date : today();
  const repeat = ['once', 'daily', 'weekly', 'monthly'].includes(b.repeat) ? b.repeat : 'once';
  const time = /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : null;
  const count = repeat === 'once' ? 1 : (Number(b.count) > 0 ? Math.min(Math.floor(Number(b.count)), 1000) : null);
  const end = repeat !== 'once' && D.test(b.end_date || '') ? b.end_date : null;
  if (end && end < start) throw new HttpError(400, 'Дата окончания раньше даты начала');
  const dows = Array.isArray(b.dows) ? b.dows.map(Number).filter((n) => n >= 0 && n <= 6).join(',') : '';
  return { title: title.slice(0, 200), text: String(b.text || '').trim().slice(0, 2000), recipients: JSON.stringify([...new Set(rec)]), start_date: start, time, repeat,
    every: Math.max(1, Math.min(365, Number(b.every) || 1)), dows, count, end_date: end, until_done: b.until_done ? 1 : 0, max_send: b.max_send ? 1 : 0 };
}

function view(r) {
  const ids = recips(r);
  const users = ids.length ? all(`SELECT id,name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const occ = occurrences(r, today(), 2000).filter((s) => s < today() || !r.time || r.time <= hm()).at(-1) || null;
  const marks = occ ? all('SELECT user_id, done_at, shown_at FROM reminder_marks WHERE reminder_id=? AND occ=?', r.id, occ) : [];
  const total = r.count > 0 ? r.count : null; const done = occurrences(r, today(), 2000).length;
  const by = r.created_by ? get('SELECT name FROM users WHERE id=?', r.created_by) : null;
  return { ...r, recipients: ids, recipient_names: users.map((u) => u.name), next: r.active ? nextOcc(r) : null, last_occ: occ, by: by ? by.name : '',
    progress: total ? `${Math.min(done, total)} из ${total}` : '',
    status: users.map((u) => { const m = marks.find((x) => x.user_id === u.id); return { id: u.id, name: u.name, done: !!(m && m.done_at), seen: !!(m && m.shown_at) }; }) };
}

function register(r, guard) {
  r.get('/api/reminders', guard, () => all('SELECT * FROM reminders ORDER BY active DESC, id DESC').map(view));
  r.get('/api/reminders/users', guard, () => all("SELECT id,name,role FROM users WHERE active=1 AND COALESCE(deleted,0)=0 ORDER BY name"));
  r.post('/api/reminders', guard, (ctx) => {
    const v = clean(ctx.body, ctx.user.id);
    const id = Number(run(`INSERT INTO reminders(title,text,created_by,recipients,start_date,time,repeat,every,dows,count,end_date,until_done,max_send)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, v.title, v.text, ctx.user.id, v.recipients, v.start_date, v.time, v.repeat, v.every, v.dows, v.count, v.end_date, v.until_done, v.max_send).lastInsertRowid);
    return view(get('SELECT * FROM reminders WHERE id=?', id));
  });
  r.put('/api/reminders/:id', guard, (ctx) => {
    const old = get('SELECT * FROM reminders WHERE id=?', +ctx.params.id); if (!old) throw new HttpError(404, 'Напоминание не найдено');
    if (ctx.body.active !== undefined && Object.keys(ctx.body).length === 1) { run('UPDATE reminders SET active=? WHERE id=?', ctx.body.active ? 1 : 0, old.id); return view(get('SELECT * FROM reminders WHERE id=?', old.id)); }
    const v = clean(ctx.body, ctx.user.id);
    run(`UPDATE reminders SET title=?,text=?,recipients=?,start_date=?,time=?,repeat=?,every=?,dows=?,count=?,end_date=?,until_done=?,max_send=? WHERE id=?`,
      v.title, v.text, v.recipients, v.start_date, v.time, v.repeat, v.every, v.dows, v.count, v.end_date, v.until_done, v.max_send, old.id);
    return view(get('SELECT * FROM reminders WHERE id=?', old.id));
  });
  r.delete('/api/reminders/:id', guard, (ctx) => { run('DELETE FROM reminder_marks WHERE reminder_id=?', +ctx.params.id); run('DELETE FROM reminders WHERE id=?', +ctx.params.id); return { ok: true }; });
  // для любого сотрудника: что напомнить сейчас, и отметки
  r.get('/api/reminders/due', (ctx) => {
    const list = dueFor(ctx.user.id);
    for (const x of list) mark(x.id, ctx.user.id, x.occ, { shown_at: nowStr() });
    return list;
  });
  r.post('/api/reminders/:id/ack', (ctx) => {
    const rid = +ctx.params.id; const occ = String(ctx.body.occ || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(occ)) throw new HttpError(400, 'Нет даты');
    const rem = get('SELECT * FROM reminders WHERE id=?', rid); if (!rem || !recips(rem).includes(ctx.user.id)) throw new HttpError(404, 'Напоминание не найдено');
    if (ctx.body.action === 'snooze') {
      const mins = Math.max(10, Math.min(24 * 60, Number(ctx.body.minutes) || 60));
      const d = new Date(Date.now() + mins * 60000);
      mark(rid, ctx.user.id, occ, { snooze_until: `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:00` });
    } else mark(rid, ctx.user.id, occ, { done_at: nowStr() });
    return { ok: true };
  });
}

// раз в минуту: продублировать в MAX тем, у кого подключён MAX (когда наступило время повтора; без времени — в 9:00)
let timer = null;
function start() {
  if (timer) return;
  const tick = async () => {
    try {
      const t = today(), now = hm(); const max = require('./max');
      for (const r of all('SELECT * FROM reminders WHERE active=1 AND max_send=1 AND start_date<=?', t)) {
        if (!occurrences(r, t, 2000).includes(t) || (r.time || '09:00') > now) continue;
        for (const uid of recips(r)) {
          const m = get('SELECT * FROM reminder_marks WHERE reminder_id=? AND user_id=? AND occ=?', r.id, uid, t);
          if (m && (m.max_sent_at || m.done_at)) continue;
          const u = get('SELECT * FROM users WHERE id=? AND active=1', uid); if (!u || !(u.max_chat_id || u.max_user_id)) continue;
          mark(r.id, uid, t, { max_sent_at: nowStr() });
          max.send(u.max_chat_id ? { chat_id: u.max_chat_id } : { user_id: u.max_user_id }, `🔔 Напоминание: **${r.title}**${r.text ? '\n' + r.text : ''}`, { userId: u.id }).catch(() => {});
        }
      }
    } catch (e) { console.error('reminders tick', e.message); }
  };
  timer = setInterval(tick, 60000); timer.unref?.(); setTimeout(tick, 15000).unref?.();
}

module.exports = { migrate, register, start, occurrences, dueFor, DOW };
