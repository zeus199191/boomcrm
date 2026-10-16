'use strict';
// Гарантийные обязательства: приём товара от клиента, передача поставщику, возврат, выдача.
// Напоминания контролёру (по умолчанию — Артём) в MAX на 30, 40 и 45 день с момента приёма.
const { db, all, get, run, tx, getSetting, setSetting } = require('./db');
const { HttpError } = require('./http');

const STATUS = {
  received: 'Принят от клиента',
  sent: 'У поставщика',
  returned: 'Вернулся от поставщика',
  closed: 'Выдан клиенту / закрыт',
};
const OUTCOME = {
  repaired: 'Отремонтирован',
  replaced: 'Замена на новый',
  refund: 'Возврат денег',
  rejected: 'Отказ (не гарантийный случай)',
  other: 'Другое',
};
const LEGAL_DAYS = 45; // ст. 20 Закона о защите прав потребителей — предельный срок устранения недостатков

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS warranty_claims (
    id INTEGER PRIMARY KEY,
    received_at TEXT NOT NULL,              -- дата приёма от клиента (YYYY-MM-DD)
    client_id INTEGER, client_name TEXT, client_phone TEXT,
    order_id INTEGER,                       -- заказ, в котором товар продавали/ставили
    product_id INTEGER, product_name TEXT NOT NULL, serial TEXT, qty REAL DEFAULT 1,
    sale_date TEXT,                         -- дата продажи / установки
    defect TEXT,                            -- заявленная неисправность
    kit TEXT,                               -- комплектность, внешний вид
    contractor_id INTEGER,                  -- поставщик
    status TEXT NOT NULL DEFAULT 'received',
    sent_at TEXT, sent_doc TEXT,            -- передан поставщику: дата, № накладной / акта / трек
    returned_at TEXT, outcome TEXT, outcome_note TEXT,
    closed_at TEXT,
    responsible_id INTEGER,                 -- ответственный (контроль сроков)
    notes TEXT,
    created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE INDEX IF NOT EXISTS idx_wc_status ON warranty_claims(status);
  CREATE TABLE IF NOT EXISTS warranty_log (
    id INTEGER PRIMARY KEY, claim_id INTEGER NOT NULL REFERENCES warranty_claims(id) ON DELETE CASCADE,
    user_id INTEGER, text TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE INDEX IF NOT EXISTS idx_wl_claim ON warranty_log(claim_id);
  CREATE TABLE IF NOT EXISTS warranty_reminders (
    claim_id INTEGER NOT NULL, day INTEGER NOT NULL, sent_at TEXT DEFAULT (datetime('now','localtime')), channels TEXT,
    PRIMARY KEY (claim_id, day));`);
  if (get("SELECT 1 FROM settings WHERE key='warranty_days'") === undefined) setSetting('warranty_days', '30,40,45');
  if (get("SELECT 1 FROM settings WHERE key='warranty_time'") === undefined) setSetting('warranty_time', '10:00');
}
migrate();

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const dm = (s) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '');
const claimNo = (id) => 'Г-' + String(id).padStart(4, '0');
const daysSince = (d) => (d ? Math.floor((new Date(today() + 'T12:00:00') - new Date(String(d).slice(0, 10) + 'T12:00:00')) / 864e5) : 0);
const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const remindDays = () => getSetting('warranty_days', '30,40,45').split(',').map((x) => +x.trim()).filter((x) => x > 0).sort((a, b) => a - b);

// Контролёры сроков: из настроек, иначе — сотрудник по имени Артём
function controllers() {
  const ids = getSetting('warranty_controllers', '').split(',').map(Number).filter(Boolean);
  const act = 'active=1 AND COALESCE(deleted,0)=0';
  if (ids.length) return all(`SELECT * FROM users WHERE ${act} AND id IN (${ids.join(',')})`);
  return all(`SELECT * FROM users WHERE ${act}`).filter((u) => /арт[её]м/i.test(u.name)).slice(0, 1);
}

function log(id, user, text) { run('INSERT INTO warranty_log(claim_id,user_id,text) VALUES(?,?,?)', id, user ? user.id : null, text); }

function load(id) {
  const c = get(`SELECT w.*, k.name supplier, k.phone supplier_phone, k.contact supplier_contact, u.name responsible, cb.name created_by_name,
                 c.name cl_name, c.phone cl_phone
                 FROM warranty_claims w LEFT JOIN contractors k ON k.id=w.contractor_id LEFT JOIN users u ON u.id=w.responsible_id
                 LEFT JOIN users cb ON cb.id=w.created_by LEFT JOIN clients c ON c.id=w.client_id WHERE w.id=?`, id);
  if (!c) throw new HttpError(404, 'Гарантийный случай не найден');
  c.number = claimNo(c.id);
  c.client_name = c.client_name || c.cl_name; c.client_phone = c.client_phone || c.cl_phone;
  c.days = daysSince(c.received_at);
  c.deadline = (() => { const d = new Date(c.received_at.slice(0, 10) + 'T12:00:00'); d.setDate(d.getDate() + LEGAL_DAYS); return ymd(d); })();
  c.log = all('SELECT l.*, u.name user FROM warranty_log l LEFT JOIN users u ON u.id=l.user_id WHERE claim_id=? ORDER BY l.id DESC', id);
  c.reminders = all('SELECT day, sent_at, channels FROM warranty_reminders WHERE claim_id=? ORDER BY day', id);
  return c;
}

// ---------- Уведомления ----------
function claimText(c) {
  return `**${c.number}** · ${c.product_name}${c.serial ? ` (S/N ${c.serial})` : ''}\n` +
    `Клиент: ${[c.client_name, c.client_phone].filter(Boolean).join(', ') || '—'}\n` +
    `Принят: ${dm(c.received_at)} · поставщик: ${c.supplier || 'не выбран'}\n` +
    `Статус: ${STATUS[c.status]}${c.sent_at ? ` (передан ${dm(c.sent_at)}${c.sent_doc ? ', ' + c.sent_doc : ''})` : ''}` +
    (c.defect ? `\nНеисправность: ${c.defect.slice(0, 300)}` : '');
}
const buttons = (c) => {
  const row = [];
  if (c.status === 'received') row.push({ text: '📦 Передан поставщику', payload: `wr:${c.id}:sent` });
  if (c.status === 'sent') row.push({ text: '↩️ Вернулся от поставщика', payload: `wr:${c.id}:returned` });
  if (c.status === 'returned') row.push({ text: '✅ Выдан клиенту', payload: `wr:${c.id}:closed` });
  return row.length ? [row] : undefined;
};
async function toControllers(c, text) {
  const notify = require('./notify');
  const list = controllers();
  const resp = c.responsible_id ? get('SELECT * FROM users WHERE id=? AND active=1 AND COALESCE(deleted,0)=0', c.responsible_id) : null;
  if (resp && !list.find((u) => u.id === resp.id)) list.push(resp);
  const used = [];
  for (const u of list) { try { const ch = await notify.deliver(u, text, { buttons: buttons(c) }); if (ch.length) used.push(u.name + ': ' + ch.join('+')); } catch {} }
  return used;
}

// Проверка сроков: раз в 10 минут, после времени из настроек (по умолчанию 10:00 по Иркутску)
let busy = false;
async function tick(force) {
  if (busy) return; busy = true;
  try {
    const now = new Date();
    const [hh, mm] = (getSetting('warranty_time', '10:00') || '10:00').split(':').map(Number);
    if (!force && now.getHours() * 60 + now.getMinutes() < hh * 60 + (mm || 0)) return;
    if (!force && now.getDay() === 0 && getSetting('warranty_sunday') !== '1') return; // воскресенье — выходной, напомним в понедельник
    const days = remindDays(); if (!days.length) return;
    for (const w of all("SELECT id, received_at FROM warranty_claims WHERE status!='closed'")) {
      const age = daysSince(w.received_at);
      const due = days.filter((d) => age >= d && !get('SELECT 1 FROM warranty_reminders WHERE claim_id=? AND day=?', w.id, d));
      if (!due.length) continue;
      const day = due[due.length - 1]; // если пропустили несколько порогов — одно сообщение по последнему
      const c = load(w.id);
      const left = LEGAL_DAYS - c.days;
      const head = day >= LEGAL_DAYS || left <= 0
        ? `🚨 **Гарантия: ${c.days} дн. с приёма — срок ${LEGAL_DAYS} дней истёк!**`
        : day >= 40 ? `⚠️ **Гарантия: ${c.days} дн. с приёма — до ${LEGAL_DAYS} дней осталось ${left} дн.**`
          : `⏰ **Гарантия: ${c.days} дн. с приёма — проконтролируйте**`;
      const text = `${head}\n${claimText(c)}\nКрайний срок по закону: ${dm(c.deadline)}` +
        (c.status === 'sent' && c.supplier ? `\n\nПозвоните поставщику: ${c.supplier}${c.supplier_phone ? ' ' + c.supplier_phone : ''}` : '') +
        (c.status === 'received' ? '\n\nТовар ещё не передан поставщику!' : '') +
        (c.status === 'returned' ? '\n\nТовар вернулся — сообщите клиенту и выдайте.' : '');
      const used = await toControllers(c, text);
      tx(() => { for (const d of due) run('INSERT OR IGNORE INTO warranty_reminders(claim_id,day,channels) VALUES(?,?,?)', c.id, d, used.join('; ') || 'не доставлено'); });
      log(c.id, null, `🔔 Напоминание «${day} дней»: ${used.length ? used.join('; ') : 'не доставлено — контролёр не подключил MAX'}`);
    }
  } catch (e) { console.error('warranty tick', e.message); } finally { busy = false; }
}

// ---------- Смена статуса ----------
function setStatus(id, status, user, b = {}) {
  const c = load(id);
  if (!STATUS[status]) throw new HttpError(400, 'Неизвестный статус');
  const d = str(b.date) || today();
  tx(() => {
    if (status === 'sent') {
      run('UPDATE warranty_claims SET status=?, sent_at=?, sent_doc=COALESCE(?,sent_doc), contractor_id=COALESCE(?,contractor_id) WHERE id=?', status, d, str(b.sent_doc), b.contractor_id ? +b.contractor_id : null, id);
      const sup = b.contractor_id ? (get('SELECT name FROM contractors WHERE id=?', +b.contractor_id) || {}).name : c.supplier;
      log(id, user, `📦 Передан поставщику${sup ? ' «' + sup + '»' : ''} ${dm(d)}${str(b.sent_doc) ? ' · ' + str(b.sent_doc) : ''}`);
    } else if (status === 'returned') {
      run('UPDATE warranty_claims SET status=?, returned_at=?, outcome=COALESCE(?,outcome), outcome_note=COALESCE(?,outcome_note) WHERE id=?', status, d, str(b.outcome), str(b.outcome_note), id);
      log(id, user, `↩️ Вернулся от поставщика ${dm(d)}${b.outcome ? ': ' + (OUTCOME[b.outcome] || b.outcome) : ''}${str(b.outcome_note) ? ' — ' + str(b.outcome_note) : ''}`);
    } else if (status === 'closed') {
      run('UPDATE warranty_claims SET status=?, closed_at=?, outcome=COALESCE(?,outcome), outcome_note=COALESCE(?,outcome_note) WHERE id=?', status, d, str(b.outcome), str(b.outcome_note), id);
      log(id, user, `✅ Закрыт ${dm(d)}${b.outcome ? ': ' + (OUTCOME[b.outcome] || b.outcome) : ''}${str(b.outcome_note) ? ' — ' + str(b.outcome_note) : ''}`);
    } else {
      run('UPDATE warranty_claims SET status=?, closed_at=NULL WHERE id=?', status, id);
      log(id, user, `Статус: ${STATUS[status]}`);
    }
  });
  return load(id);
}

// кнопки в MAX: wr:<id>:<status>
async function onCallback(user, payload) {
  const m = /^wr:(\d+):(sent|returned|closed)$/.exec(payload);
  if (!m) return null;
  const c = load(+m[1]);
  if (c.status === m[2]) return `${c.number}: уже «${STATUS[m[2]]}»`;
  setStatus(c.id, m[2], user, {});
  return `${c.number}: ${STATUS[m[2]]}`;
}

// ---------- API ----------
function register(r, OFFICE, ADMIN) {
  r.get('/api/warranty/meta', OFFICE, () => ({
    statuses: STATUS, outcomes: OUTCOME, legal_days: LEGAL_DAYS,
    days: getSetting('warranty_days', '30,40,45'), time: getSetting('warranty_time', '10:00'),
    controllers: controllers().map((u) => ({ id: u.id, name: u.name, max: !!(u.max_user_id || u.max_chat_id) })),
    controller_ids: getSetting('warranty_controllers', ''),
  }));
  r.put('/api/warranty/settings', ADMIN, (ctx) => {
    const b = ctx.body;
    const ids = (Array.isArray(b.controllers) ? b.controllers : String(b.controllers || '').split(',')).map(Number).filter(Boolean);
    setSetting('warranty_controllers', ids.join(','));
    const days = String(b.days || '').split(/[,; ]+/).map(Number).filter((x) => x > 0 && x < 1000);
    setSetting('warranty_days', [...new Set(days)].sort((a, x) => a - x).join(',') || '30,40,45');
    if (/^\d{1,2}:\d{2}$/.test(b.time || '')) setSetting('warranty_time', b.time);
    return { ok: true };
  });
  r.post('/api/warranty/check-now', ADMIN, async () => { await tick(true); return { ok: true }; });

  r.get('/api/warranty', OFFICE, (ctx) => {
    const q = ctx.query; const where = ['1=1']; const p = [];
    if (q.status === 'open') where.push("w.status!='closed'");
    else if (q.status && STATUS[q.status]) { where.push('w.status=?'); p.push(q.status); }
    if (q.contractor_id) { where.push('w.contractor_id=?'); p.push(+q.contractor_id); }
    if (q.q) {
      const like = `%${String(q.q).toLowerCase().replace(/ё/g, 'е')}%`;
      where.push('(ulower(w.product_name) LIKE ? OR ulower(w.serial) LIKE ? OR ulower(w.client_name) LIKE ? OR w.client_phone LIKE ? OR ulower(c.name) LIKE ? OR w.id=?)');
      p.push(like, like, like, like, like, +String(q.q).replace(/\D/g, '') || -1);
    }
    const rows = all(`SELECT w.*, k.name supplier, u.name responsible, c.name cl_name, c.phone cl_phone FROM warranty_claims w
                      LEFT JOIN contractors k ON k.id=w.contractor_id LEFT JOIN users u ON u.id=w.responsible_id LEFT JOIN clients c ON c.id=w.client_id
                      WHERE ${where.join(' AND ')} ORDER BY w.status='closed', w.received_at, w.id LIMIT 500`, ...p);
    return rows.map((w) => ({ ...w, number: claimNo(w.id), client_name: w.client_name || w.cl_name, client_phone: w.client_phone || w.cl_phone, days: daysSince(w.received_at) }));
  });
  r.get('/api/warranty/summary', OFFICE, () => {
    const open = all("SELECT id, received_at, status FROM warranty_claims WHERE status!='closed'").map((w) => ({ ...w, days: daysSince(w.received_at) }));
    return { open: open.length, at_supplier: open.filter((w) => w.status === 'sent').length, over30: open.filter((w) => w.days >= 30).length, over45: open.filter((w) => w.days >= LEGAL_DAYS).length };
  });
  r.get('/api/warranty/:id', OFFICE, (ctx) => load(+ctx.params.id));

  const save = (b, user, id) => {
    const product = String(b.product_name || '').trim();
    if (!product) throw new HttpError(400, 'Укажите товар');
    const received = str(b.received_at) || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(received)) throw new HttpError(400, 'Неверная дата приёма');
    const vals = [received, b.client_id ? +b.client_id : null, str(b.client_name), str(b.client_phone), b.order_id ? +b.order_id : null,
      b.product_id ? +b.product_id : null, product, str(b.serial), +b.qty > 0 ? +b.qty : 1, str(b.sale_date), str(b.defect), str(b.kit),
      b.contractor_id ? +b.contractor_id : null, b.responsible_id ? +b.responsible_id : null, str(b.notes)];
    if (id) {
      const prev = load(id);
      run(`UPDATE warranty_claims SET received_at=?,client_id=?,client_name=?,client_phone=?,order_id=?,product_id=?,product_name=?,serial=?,qty=?,sale_date=?,defect=?,kit=?,contractor_id=?,responsible_id=?,notes=? WHERE id=?`, ...vals, id);
      const ch = [];
      if (prev.received_at !== received) { ch.push(`дата приёма ${dm(prev.received_at)} → ${dm(received)}`); run('DELETE FROM warranty_reminders WHERE claim_id=?', id); }
      if ((prev.contractor_id || null) !== (vals[12] || null)) ch.push('поставщик: ' + ((get('SELECT name FROM contractors WHERE id=?', vals[12]) || {}).name || '—'));
      log(id, user, '✏️ Изменено' + (ch.length ? ': ' + ch.join(', ') : ''));
      return id;
    }
    const nid = Number(run(`INSERT INTO warranty_claims(received_at,client_id,client_name,client_phone,order_id,product_id,product_name,serial,qty,sale_date,defect,kit,contractor_id,responsible_id,notes,created_by)
                            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...vals, user.id).lastInsertRowid);
    log(nid, user, '🛡 Принят на гарантию от клиента');
    // уже прошедшие пороги (если внесли задним числом) — не дублируем, напомнит ближайший
    const age = daysSince(received);
    const passed = remindDays().filter((d) => age >= d);
    if (passed.length > 1) for (const d of passed.slice(0, -1)) run('INSERT OR IGNORE INTO warranty_reminders(claim_id,day,channels) VALUES(?,?,?)', nid, d, 'пропущено: внесено задним числом');
    const c = load(nid);
    toControllers(c, `🛡 **Новый гарантийный случай** (принял ${user.name})\n${claimText(c)}\nНапоминания: на ${remindDays().join(', ')} день.`).catch(() => {});
    return nid;
  };
  r.post('/api/warranty', OFFICE, (ctx) => ({ id: save(ctx.body, ctx.user) }));
  r.put('/api/warranty/:id', OFFICE, (ctx) => ({ id: save(ctx.body, ctx.user, +ctx.params.id) }));
  r.post('/api/warranty/:id/status', OFFICE, (ctx) => setStatus(+ctx.params.id, ctx.body.status, ctx.user, ctx.body));
  r.post('/api/warranty/:id/comment', OFFICE, (ctx) => {
    const t = str(ctx.body.text); if (!t) throw new HttpError(400, 'Пустой комментарий');
    load(+ctx.params.id); log(+ctx.params.id, ctx.user, '💬 ' + t.slice(0, 2000)); return { ok: true };
  });
  r.post('/api/warranty/:id/remind', OFFICE, async (ctx) => {
    const c = load(+ctx.params.id);
    const used = await toControllers(c, `🔔 **Гарантия: ${c.days} дн. с приёма** (напомнил ${ctx.user.name})\n${claimText(c)}\nКрайний срок по закону: ${dm(c.deadline)}`);
    if (!used.length) throw new HttpError(400, 'Не доставлено: контролёр не подключил MAX/Telegram или не выбран в настройках гарантии');
    log(c.id, ctx.user, '🔔 Отправлено напоминание: ' + used.join('; '));
    return { ok: true, used };
  });
  r.delete('/api/warranty/:id', ADMIN, (ctx) => {
    tx(() => { run('DELETE FROM warranty_reminders WHERE claim_id=?', +ctx.params.id); run('DELETE FROM warranty_claims WHERE id=?', +ctx.params.id); });
    return { ok: true };
  });
}

function start() { setInterval(() => tick().catch(() => {}), 10 * 60e3); setTimeout(() => tick().catch(() => {}), 30e3); }

module.exports = { register, tick, start, onCallback, load, STATUS, OUTCOME, LEGAL_DAYS, claimNo };
