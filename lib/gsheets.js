'use strict';
// Копия журнала записи в Google-таблице — на случай, когда CRM недоступна.
// Лист «CRM · Журнал» — CRM перезаписывает его целиком (только для просмотра).
// Лист «Записи без CRM» — сюда записывают во время сбоя; CRM забирает новые строки в журнал как заметки и ставит «✓ в CRM».
// Остальные листы таблицы CRM не трогает. Доступ — через сервисный аккаунт Google (ключ .json в Настройках).
const crypto = require('node:crypto');
const { all, get, run, getSetting, setSetting } = require('./db');

const GRID = 'CRM · Журнал';
const INBOX = 'Записи без CRM';
const DAYS_BACK = 7, DAYS_AHEAD = 90;
const STATUS_RU = { new: 'новый', scheduled: 'записан', in_work: 'в работе', waiting: 'ждёт запчасти', done: 'готов', issued: 'выдан' };
const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dm = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}`;
const stamp = () => { const d = new Date(); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// ---------- настройки ----------
function key() { try { const k = JSON.parse(getSetting('gs_key') || 'null'); return k && k.client_email && k.private_key ? k : null; } catch { return null; } }
const sheetId = () => getSetting('gs_sheet_id');
const enabled = () => getSetting('gs_on') === '1' && !!key() && !!sheetId() && getSetting('test_copy') !== '1';
function parseUrl(u) { const m = String(u || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/) || String(u || '').match(/^([a-zA-Z0-9_-]{30,})$/); return m ? m[1] : ''; }
function status() {
  const k = key();
  return { on: getSetting('gs_on') === '1', email: k ? k.client_email : '', has_key: !!k, sheet_id: sheetId(), url: sheetId() ? `https://docs.google.com/spreadsheets/d/${sheetId()}/edit` : '',
    last_sync: getSetting('gs_last_sync'), last_error: getSetting('gs_last_error'), last_import: getSetting('gs_last_import'), test_copy: getSetting('test_copy') === '1' };
}
function save(b) {
  if (b.key !== undefined && b.key !== '') {
    let k; try { k = typeof b.key === 'string' ? JSON.parse(b.key) : b.key; } catch { throw new Error('Файл ключа не читается — нужен .json, который выдал Google'); }
    if (!k || k.type !== 'service_account' || !k.client_email || !k.private_key) throw new Error('Это не ключ сервисного аккаунта Google (в файле нет client_email / private_key)');
    setSetting('gs_key', JSON.stringify({ client_email: k.client_email, private_key: k.private_key }));
    TOKEN = null;
  }
  if (b.url !== undefined) { const id = parseUrl(b.url); if (b.url && !id) throw new Error('Не похоже на ссылку Google-таблицы (docs.google.com/spreadsheets/d/…)'); if (id !== sheetId()) { setSetting('gs_sheet_id', id); setSetting('gs_ready', ''); } }
  if (b.on !== undefined) setSetting('gs_on', b.on ? '1' : '0');
  if (b.remove_key) { setSetting('gs_key', ''); setSetting('gs_on', '0'); TOKEN = null; }
  return status();
}

// ---------- Google API ----------
let TOKEN = null;
const b64u = (x) => Buffer.from(x).toString('base64url');
async function token() {
  if (TOKEN && TOKEN.exp > Date.now() + 60000) return TOKEN.v;
  const k = key(); if (!k) throw new Error('Не загружен ключ Google');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), k.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${sig}` }), signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('Google не принял ключ: ' + (j.error_description || j.error || res.status));
  TOKEN = { v: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return TOKEN.v;
}
async function api(method, path, body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId()}${path}`, { method,
    headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j.error?.message || String(res.status);
    if (res.status === 403) throw new Error(`Нет доступа к таблице — откройте «Настройки доступа» таблицы и добавьте редактором ${key()?.client_email} (${msg})`);
    if (res.status === 404) throw new Error('Таблица не найдена — проверьте ссылку');
    throw new Error('Google: ' + msg);
  }
  return j;
}
const rng = (sheet, a1) => encodeURIComponent(`'${sheet}'!${a1}`);

// создать свои листы (если их нет), оформить один раз
async function ensure() {
  const meta = await api('GET', '?fields=sheets.properties(sheetId,title)');
  const have = Object.fromEntries((meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));
  const add = [GRID, INBOX].filter((t) => have[t] === undefined);
  if (add.length) {
    const r = await api('POST', ':batchUpdate', { requests: add.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1, frozenColumnCount: title === GRID ? 1 : 0 } } } })) });
    for (const x of r.replies || []) if (x.addSheet) have[x.addSheet.properties.title] = x.addSheet.properties.sheetId;
  }
  if (getSetting('gs_ready') !== sheetId() || add.length) {
    const bays = baysList(); const g = have[GRID], n = have[INBOX];
    const width = (sid, from, to, px) => ({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: from, endIndex: to }, properties: { pixelSize: px }, fields: 'pixelSize' } });
    const head = (sid) => ({ repeatCell: { range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor)' } });
    await api('POST', ':batchUpdate', { requests: [
      width(g, 0, 1, 90), width(g, 1, bays.length + 2, 230), head(g),
      { repeatCell: { range: { sheetId: g, startRowIndex: 1 }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP', textFormat: { fontSize: 9 } } }, fields: 'userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)' } },
      width(n, 0, 1, 100), width(n, 1, 2, 90), width(n, 2, 3, 420), width(n, 3, 4, 110), width(n, 4, 5, 200), head(n),
      { setDataValidation: { range: { sheetId: n, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 1, endColumnIndex: 2 },
        rule: { condition: { type: 'ONE_OF_LIST', values: ['весь день', ...bays].map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } },
      { setDataValidation: { range: { sheetId: n, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 },
        rule: { condition: { type: 'DATE_IS_VALID' }, inputMessage: 'Дата, например 15.11.2026', strict: false } } },
      { repeatCell: { range: { sheetId: n, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd.mm.yyyy' } } }, fields: 'userEnteredFormat.numberFormat' } },
    ] });
    const top = await api('GET', `/values/${rng(INBOX, 'A1:E1')}`);
    if (!top.values || !top.values.length) await api('PUT', `/values/${rng(INBOX, 'A1:E1')}?valueInputOption=RAW`, { values: [['Дата', 'Пост', 'Что записать (клиент, авто, телефон, работы)', 'Кто записал', 'CRM (не заполнять)']] });
    setSetting('gs_ready', sheetId());
  }
}

// ---------- журнал → таблица ----------
const baysList = () => getSetting('bays').split(',').map((s) => s.trim()).filter(Boolean);
function grid() {
  const bays = baysList(); const d0 = new Date(); d0.setDate(d0.getDate() - DAYS_BACK);
  const from = ymd(d0); const d1 = new Date(); d1.setDate(d1.getDate() + DAYS_AHEAD); const to = ymd(d1);
  const orders = all(`SELECT o.id,o.status,o.scheduled_at,o.end_date,o.bay,o.complaint,c.name client,c.phone,ca.brand,ca.model,ca.plate,u.name master
    FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id LEFT JOIN users u ON u.id=o.master_id
    WHERE o.scheduled_at IS NOT NULL AND substr(o.scheduled_at,1,10)<=? AND COALESCE(o.end_date,substr(o.scheduled_at,1,10))>=? AND o.status NOT IN ('cancelled','estimate')
    ORDER BY o.scheduled_at, o.id`, to, from);
  const notes = all('SELECT date,bay,text FROM cal_notes WHERE date>=? AND date<=? ORDER BY id', from, to);
  const col = (bay) => { const i = bays.indexOf(bay); return i < 0 ? bays.length : i; }; // без поста — в последний столбец
  const rows = [['Дата', ...bays, 'Без поста / весь день']];
  for (let d = new Date(d0); ymd(d) <= to; d.setDate(d.getDate() + 1)) {
    const s = ymd(d); const cells = Array(bays.length + 1).fill(null).map(() => []);
    for (const o of orders) {
      const start = o.scheduled_at.slice(0, 10), end = o.end_date || start; if (s < start || s > end) continue;
      const car = [o.brand, o.model, o.plate].filter(Boolean).join(' ');
      const span = end > start ? ` (${dm(start)}–${dm(end)})` : (o.scheduled_at.length > 10 && o.scheduled_at.slice(11, 16) !== '00:00' ? ` ${o.scheduled_at.slice(11, 16)}` : '');
      cells[col(o.bay)].push(`БС-${String(o.id).padStart(5, '0')}${span} · ${car || 'авто не указано'}\n${[o.client, o.phone].filter(Boolean).join(' ')}${o.master ? ' · ' + o.master : ''} · ${STATUS_RU[o.status] || o.status}${o.complaint ? '\n' + String(o.complaint).slice(0, 150) : ''}`);
    }
    for (const n of notes) if (n.date === s) cells[col(n.bay)].push('📝 ' + String(n.text).slice(0, 300));
    rows.push([`${dm(s)} ${DOW[d.getDay()]}${s === ymd(new Date()) ? ' ◀' : ''}`, ...cells.map((c) => c.join('\n\n'))]);
  }
  rows.push([], [`Обновлено из CRM: ${stamp()}. Этот лист CRM перезаписывает — правки здесь пропадут. Записи во время сбоя вносите на лист «${INBOX}».`]);
  return rows;
}
async function pushGrid(force) {
  const rows = grid();
  const hash = crypto.createHash('sha1').update(JSON.stringify(rows.slice(0, -1))).digest('hex');
  if (!force && hash === getSetting('gs_hash') && Date.now() - Number(getSetting('gs_push_at') || 0) < 30 * 60000) return false;
  await api('POST', `/values/${rng(GRID, 'A1:Z2000')}:clear`, {});
  await api('PUT', `/values/${rng(GRID, 'A1')}?valueInputOption=RAW`, { values: rows });
  setSetting('gs_hash', hash); setSetting('gs_push_at', String(Date.now()));
  return true;
}

// ---------- таблица → журнал ----------
function sheetDate(v) {
  if (typeof v === 'number' && v > 30000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const s = String(v ?? '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/))) {
    let y = m[3] ? Number(m[3]) : new Date().getFullYear(); if (y < 100) y += 2000;
    const d = `${y}-${pad(m[2])}-${pad(m[1])}`; const t = new Date(y, Number(m[2]) - 1, Number(m[1]), 12); return ymd(t) === d ? d : null;
  }
  return null;
}
function bayOf(v) {
  const s = String(v ?? '').trim(); if (!s || /весь|без/i.test(s)) return null;
  const bays = baysList(); const exact = bays.find((b) => b.toLowerCase() === s.toLowerCase()); if (exact) return exact;
  const n = s.match(/\d+/); if (n) { const b = bays.find((x) => x.match(/\d+/)?.[0] === n[0]); if (b) return b; }
  return null;
}
async function pullInbox() {
  const r = await api('GET', `/values/${rng(INBOX, 'A2:E1000')}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  const rows = r.values || []; const added = []; const marks = [];
  rows.forEach((row, i) => {
    const [dv, bv, text, who, mark] = row; if (mark || !String(text ?? '').trim()) return;
    const date = sheetDate(dv); const line = i + 2;
    if (!date) { marks.push({ range: `'${INBOX}'!E${line}`, values: [['⚠ не понял дату — напишите, например, 15.11.2026']] }); return; }
    const bay = bayOf(bv); const t = `${String(text).trim()}${who ? ' — ' + String(who).trim() : ''} (из Google-таблицы)`.slice(0, 2000);
    if (!get('SELECT 1 FROM cal_notes WHERE date=? AND bay IS ? AND text=?', date, bay, t)) run('INSERT INTO cal_notes(date,bay,text,color,created_by) VALUES(?,?,?,?,NULL)', date, bay, t, '#ff9900');
    added.push({ date, bay, text: String(text).trim(), who: who ? String(who).trim() : '' });
    marks.push({ range: `'${INBOX}'!E${line}`, values: [[`✓ в журнале CRM ${stamp()}`]] });
  });
  if (marks.length) await api('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data: marks });
  if (added.length) {
    setSetting('gs_last_import', `${stamp()}: ${added.length} шт.`);
    try { require('./notify').boss('order_new', `📝 **Из Google-таблицы в журнал перенесено: ${added.length}**\n${added.slice(0, 10).map((a) => `${dm(a.date)}${a.bay ? ' · ' + a.bay : ''} — ${a.text.slice(0, 120)}${a.who ? ' (' + a.who + ')' : ''}`).join('\n')}\nПроверьте и оформите заказ-наряды.`); } catch {}
  }
  return added.length;
}

// ---------- синхронизация ----------
let busy = false;
async function sync(force) {
  if (busy) return { busy: true };
  busy = true;
  try {
    await ensure();
    const imported = await pullInbox();
    const pushed = await pushGrid(force || imported > 0);
    setSetting('gs_last_sync', stamp()); setSetting('gs_last_error', '');
    return { ok: true, imported, pushed };
  } catch (e) {
    setSetting('gs_last_error', `${stamp()}: ${e.message}`);
    return { ok: false, error: e.message };
  } finally { busy = false; }
}
let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => { if (enabled()) sync().catch(() => {}); }, 60000); timer.unref?.();
}

module.exports = { status, save, sync, start, enabled, grid, sheetDate, bayOf, parseUrl };
