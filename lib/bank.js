'use strict';
// Расчётный счёт в Альфа-Банке: загрузка операций (Alfa API или файл выписки 1С) и автоматическая разноска в кассу CRM.
//
// Alfa API: авторизация Alfa ID (OAuth2 + PKCE), клиентский сертификат банка (mTLS) на каждом запросе.
// Адреса методов вынесены в настройки — их можно поправить по документации, которую банк выдаёт после подключения.
const https = require('node:https');
const crypto = require('node:crypto');
const { db, all, get, run, tx, getSetting, setSetting } = require('./db');
const { HttpError } = require('./http');

const ENV = {
  sandbox: { api: 'https://sandbox.alfabank.ru', auth: 'https://id-sandbox.alfabank.ru/oidc/authorize' },
  prod: { api: 'https://baas.alfabank.ru', auth: 'https://id.alfabank.ru/oidc/authorize' },
};
const DEF = { scope: 'openid transactions', statement_path: '/api/statement/transactions', info_path: '/api/v2/customer-info' };
const ACQ_RE = /эквайр|возмещени[ея].*(карт|операци)|операци(ям|й) с (банковскими |платежными )?карт|по терминал|торгов[а-яёa-z]* эквайр|POS[- ]?терминал/i;
const CAT_RULES = [
  [/аренд/i, 'Аренда'],
  [/\bЕНП\b|единый налог|налог|ФНС|УФК|страхов[а-яёa-z]* взнос|НДФЛ/i, 'Налоги'],
  [/кредит|погашени[а-яёa-z]* (основного )?долга|процент[а-яёa-z]* по (кредит|договор)/i, 'Кредит'],
  [/комисси|обслуживани[а-яёa-z]* (расч|счет|счёт)|за ведение счета|тариф/i, 'Банковская комиссия'],
  [/коммунальн|электроэнерг|водоснабж|теплоснабж|вывоз (мусора|ТКО)/i, 'Коммунальные'],
  [/реклам|яндекс.?директ|авито|vk ads|таргет/i, 'Реклама'],
];

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS bank_tx (
    id INTEGER PRIMARY KEY, ext_id TEXT UNIQUE NOT NULL, source TEXT, account TEXT,
    date TEXT NOT NULL, direction TEXT NOT NULL CHECK (direction IN ('in','out')), amount REAL NOT NULL,
    doc_no TEXT, cp_name TEXT, cp_inn TEXT, cp_account TEXT, purpose TEXT,
    status TEXT NOT NULL DEFAULT 'new',  -- new / done / skip
    action TEXT, payment_id INTEGER, move_id INTEGER, note TEXT, raw TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')), done_by INTEGER, done_at TEXT);
  CREATE INDEX IF NOT EXISTS idx_btx_status ON bank_tx(status, date);`);
  const cols = all('PRAGMA table_info(payments)').map((c) => c.name);
  if (!cols.includes('bank_tx_id')) db.exec('ALTER TABLE payments ADD COLUMN bank_tx_id INTEGER');
}

const r2 = (x) => Math.round((+x || 0) * 100) / 100;
const digits = (s) => String(s || '').replace(/\D/g, '');
const ymd = (s) => { const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(s || '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(s || '').slice(0, 10); };

// ---------- Файл выписки 1С (1CClientBankExchange, kl_to_1c.txt) ----------
function decodeText(buf) {
  const utf = buf.toString('utf8');
  if (/СекцияДокумент|1CClientBankExchange/.test(utf) && !utf.includes('�')) return utf;
  return new TextDecoder('windows-1251').decode(buf);
}
function parse1C(buf) {
  const text = decodeText(buf);
  if (!/1CClientBankExchange/.test(text)) throw new HttpError(400, 'Это не файл выписки в формате 1С (нет заголовка 1CClientBankExchange)');
  const head = {}; const docs = []; let cur = null; let acc = null;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim(); if (!l) continue;
    if (l.startsWith('СекцияДокумент')) { cur = { _kind: l.split('=')[1] || '' }; continue; }
    if (l === 'КонецДокумента') { if (cur) docs.push(cur); cur = null; continue; }
    if (l === 'СекцияРасчСчет') { acc = {}; continue; }
    if (l === 'КонецРасчСчет') { if (acc) head.acc = { ...(head.acc || {}), ...acc }; acc = null; continue; }
    const i = l.indexOf('='); if (i < 0) continue;
    const k = l.slice(0, i), v = l.slice(i + 1);
    if (cur) cur[k] = v; else if (acc) acc[k] = v; else head[k] = v;
  }
  const our = digits(head.РасчСчет || head.acc?.РасчСчет || getSetting('alfa_account'));
  const list = docs.map((d) => {
    const out = our && digits(d.ПлательщикСчет) === our ? true : our && digits(d.ПолучательСчет) === our ? false : !!d.ДатаСписано && !d.ДатаПоступило;
    const amount = r2(String(d.Сумма || '0').replace(',', '.'));
    const date = ymd(d.ДатаСписано || d.ДатаПоступило || d.Дата);
    const cp = out ? { name: d.Получатель1 || d.Получатель, inn: d.ПолучательИНН, acc: d.ПолучательСчет } : { name: d.Плательщик1 || d.Плательщик, inn: d.ПлательщикИНН, acc: d.ПлательщикСчет };
    const purpose = d.НазначениеПлатежа || '';
    const ext = 'f:' + crypto.createHash('sha1').update([date, d.Номер, amount, out ? 'o' : 'i', digits(cp.inn), purpose].join('|')).digest('hex').slice(0, 20);
    return { ext_id: ext, source: 'file', account: our, date, direction: out ? 'out' : 'in', amount, doc_no: d.Номер || '', cp_name: String(cp.name || '').replace(/^ИНН\s*\d+\s*/, ''), cp_inn: digits(cp.inn), cp_account: digits(cp.acc), purpose, raw: JSON.stringify(d) };
  });
  const bal = head.acc?.КонечныйОстаток ?? head.КонечныйОстаток;
  return { list, account: our, balance: bal !== undefined ? r2(String(bal).replace(',', '.')) : null, dateTo: ymd(head.acc?.ДатаКонца || head.ДатаКонца) };
}

// ---------- Alfa API ----------
const cfg = () => {
  const env = getSetting('alfa_env', 'sandbox') === 'prod' ? 'prod' : 'sandbox';
  return {
    env, api: (getSetting('alfa_api_url') || ENV[env].api).replace(/\/$/, ''), auth: getSetting('alfa_auth_url') || ENV[env].auth,
    client_id: getSetting('alfa_client_id'), client_secret: getSetting('alfa_client_secret'),
    cert: getSetting('alfa_cert'), key: getSetting('alfa_key'), key_pass: getSetting('alfa_key_pass'),
    scope: getSetting('alfa_scope') || DEF.scope, statement_path: getSetting('alfa_statement_path') || DEF.statement_path,
    info_path: getSetting('alfa_info_path') || DEF.info_path, account: digits(getSetting('alfa_account')),
    redirect: getSetting('alfa_redirect_uri'),
  };
};
function request(method, url, { form, token, json } = {}) {
  const c = cfg();
  if (!c.cert || !c.key) return Promise.reject(new HttpError(400, 'Загрузите сертификат и ключ, выданные банком для Alfa API'));
  const u = new URL(url);
  const body = form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : null;
  const headers = { Accept: 'application/json' };
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (json) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = https.request({ method, hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, headers,
      cert: c.cert, key: c.key, passphrase: c.key_pass || undefined, timeout: 30000 }, (res) => {
      const chunks = []; res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8'); let data = null; try { data = JSON.parse(txt); } catch {}
        if (res.statusCode >= 400) return reject(new HttpError(502, `Альфа-Банк ответил ${res.statusCode}: ${(data && (data.error_description || data.message || data.error || data.code)) || txt.slice(0, 200)}`));
        resolve(data ?? txt);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Банк не ответил за 30 секунд')));
    req.on('error', (e) => reject(new HttpError(502, 'Нет связи с Альфа-Банком: ' + (e.code || e.message))));
    if (body) req.write(body); req.end();
  });
}
function authUrl(origin) {
  const c = cfg();
  if (!c.client_id) throw new HttpError(400, 'Укажите client_id приложения Alfa API');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(12).toString('base64url');
  setSetting('alfa_pkce', JSON.stringify({ verifier, state, t: Date.now() }));
  const redirect = c.redirect || origin + '/api/alfa/callback';
  const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: redirect, scope: c.scope, state,
    code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  return { url: c.auth + '?' + q, redirect };
}
async function exchangeCode(codeOrUrl, origin) {
  const c = cfg(); let code = String(codeOrUrl || '').trim();
  if (/^https?:\/\//.test(code)) { const u = new URL(code); code = u.searchParams.get('code') || ''; }
  if (!code) throw new HttpError(400, 'Не найден код авторизации');
  const pk = JSON.parse(getSetting('alfa_pkce') || '{}');
  const t = await request('POST', c.api + '/oidc/token', { form: { grant_type: 'authorization_code', code, client_id: c.client_id, client_secret: c.client_secret,
    redirect_uri: c.redirect || origin + '/api/alfa/callback', ...(pk.verifier ? { code_verifier: pk.verifier } : {}) } });
  saveTokens(t); return t;
}
function saveTokens(t) {
  if (!t || !t.access_token) throw new HttpError(502, 'Банк не выдал токен доступа');
  setSetting('alfa_access_token', t.access_token);
  if (t.refresh_token) setSetting('alfa_refresh_token', t.refresh_token);
  setSetting('alfa_token_exp', String(Date.now() + ((+t.expires_in || 3600) - 60) * 1000));
  setSetting('alfa_error', '');
}
async function token() {
  if (getSetting('alfa_access_token') && +getSetting('alfa_token_exp', '0') > Date.now()) return getSetting('alfa_access_token');
  const rt = getSetting('alfa_refresh_token'); const c = cfg();
  if (!rt) throw new HttpError(400, 'Подключите Альфа-Банк через Alfa ID (кнопка «Войти через Alfa ID»)');
  const t = await request('POST', c.api + '/oidc/token', { form: { grant_type: 'refresh_token', refresh_token: rt, client_id: c.client_id, client_secret: c.client_secret } });
  saveTokens(t); return t.access_token;
}
async function customerInfo() { const c = cfg(); return request('GET', c.api + c.info_path, { token: await token() }); }

// разбор операции из Alfa API (поля берём защитно — разные версии API называют их по-разному)
function fromApi(t, account) {
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');
  const dir = String(pick(t.direction, t.operationType, t.type, t.creditDebitIndicator, '')).toUpperCase();
  const amtObj = t.amount && typeof t.amount === 'object' ? t.amount : null;
  let amount = +pick(amtObj?.amount, amtObj?.value, t.amountRub?.amount, t.amount, t.sum, 0);
  let out = /DEBIT|DBIT|OUT|РАСХОД|СПИС/.test(dir) || amount < 0;
  amount = Math.abs(amount);
  const rt = t.rurTransfer || t.transfer || t.details || {};
  const cp = out ? { name: pick(rt.payeeName, t.payeeName, t.counterpartyName, t.correspondentName), inn: pick(rt.payeeInn, t.payeeInn, t.counterpartyInn), acc: pick(rt.payeeAccount, t.payeeAccount) }
    : { name: pick(rt.payerName, t.payerName, t.counterpartyName, t.correspondentName), inn: pick(rt.payerInn, t.payerInn, t.counterpartyInn), acc: pick(rt.payerAccount, t.payerAccount) };
  const date = String(pick(t.operationDate, t.documentDate, t.valueDate, t.date, t.createdAt, '')).slice(0, 10);
  const id = pick(t.transactionId, t.uuid, t.id, t.operationId);
  const purpose = pick(t.paymentPurpose, rt.purpose, t.purpose, t.description, '') || '';
  return { ext_id: 'a:' + (id || crypto.createHash('sha1').update(JSON.stringify(t)).digest('hex').slice(0, 20)), source: 'api', account, date, direction: out ? 'out' : 'in',
    amount: r2(amount), doc_no: String(pick(t.number, t.documentNumber, '') || ''), cp_name: String(cp.name || ''), cp_inn: digits(cp.inn), cp_account: digits(cp.acc), purpose: String(purpose), raw: JSON.stringify(t) };
}
async function syncApi(days) {
  const c = cfg();
  if (!c.account) throw new HttpError(400, 'Укажите номер расчётного счёта (20 цифр)');
  const tok = await token();
  const last = getSetting('alfa_last_sync_date');
  const n = days || (last ? Math.min(31, Math.max(1, Math.ceil((Date.now() - new Date(last + 'T00:00:00').getTime()) / 864e5) + 1)) : 7);
  const items = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5); const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    for (let page = 1; page <= 50; page++) {
      const res = await request('GET', `${c.api}${c.statement_path}?${new URLSearchParams({ accountNumber: c.account, statementDate: ds, page: String(page) })}`, { token: tok });
      const list = Array.isArray(res) ? res : res?.transactions || res?.items || res?.operations || res?.content || [];
      list.forEach((t) => items.push(fromApi(t, c.account)));
      const next = Array.isArray(res?._links) ? res._links.some((l) => l.rel === 'next') : res?.hasNext ?? res?.next;
      if (!list.length || !next) break;
    }
  }
  const r = ingest(items, null);
  const now = new Date(); setSetting('alfa_last_sync_date', `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  setSetting('alfa_last_sync', new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16).replace('T', ' ')); setSetting('alfa_error', '');
  return { ...r, fetched: items.length };
}

// ---------- Загрузка и автоматическая разноска ----------
function ingest(list, user) {
  let added = 0, auto = 0;
  for (const t of list) {
    if (!t.amount || !t.date) continue;
    if (get('SELECT 1 FROM bank_tx WHERE ext_id=?', t.ext_id)) continue;
    const id = Number(run(`INSERT INTO bank_tx(ext_id,source,account,date,direction,amount,doc_no,cp_name,cp_inn,cp_account,purpose,raw) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      t.ext_id, t.source, t.account, t.date, t.direction, t.amount, t.doc_no, t.cp_name, t.cp_inn, t.cp_account, t.purpose, t.raw).lastInsertRowid);
    added++;
    try { if (autoMatch(id, user)) auto++; } catch (e) { console.error('bank automatch', e.message); }
  }
  return { added, auto, left: get("SELECT COUNT(*) n FROM bank_tx WHERE status='new'").n };
}
// предложение разноски для операции (используется и автоматически, и как подсказка в интерфейсе)
function suggest(t) {
  const ownInn = digits(getSetting('company_inn'));
  // 1) уже внесено в CRM вручную — та же сумма, безнал, ±3 дня
  const same = get(`SELECT id FROM payments WHERE bank_tx_id IS NULL AND direction=? AND method IN ('transfer','terminal') AND ABS(amount-?)<0.01
                    AND substr(created_at,1,10) BETWEEN date(?, '-3 day') AND date(?, '+3 day') ORDER BY ABS(julianday(substr(created_at,1,10))-julianday(?)) LIMIT 1`,
    t.direction, t.amount, t.date, t.date, t.date);
  if (same) return { type: 'link', payment_id: same.id, text: 'Совпадает с операцией, уже внесённой в CRM' };
  // 2) зачисление по терминалу — уже учтено в оплатах заказов (способ «Терминал»)
  if (t.direction === 'in' && ACQ_RE.test(t.purpose)) return { type: 'acq', text: 'Возмещение по терминалу — оплаты уже учтены в заказах' };
  // 3) перевод между своими счетами / снятие наличных
  if (t.direction === 'out' && /сняти[а-яёa-z]* наличн|выдача наличн|банкомат|получение наличн/i.test(t.purpose)) return { type: 'cash', text: 'Снятие наличных (обналичивание)' };
  if (ownInn && t.cp_inn === ownInn) return { type: 'own', text: 'Перевод между своими счетами' };
  // 4) номер заказа в назначении платежа
  const m = /Б\s?С[-\s№]*0*(\d{1,7})/i.exec(t.purpose) || /заказ\S*\s*№?\s*0*(\d{1,7})/i.exec(t.purpose);
  if (m && t.direction === 'in' && get('SELECT 1 FROM orders WHERE id=?', +m[1])) return { type: 'order', order_id: +m[1], text: `Оплата заказа БС-${String(m[1]).padStart(5, '0')}` };
  // 5) контрагент по ИНН
  if (t.cp_inn) {
    const c = get('SELECT id,name FROM contractors WHERE REPLACE(inn,\' \',\'\')=? ORDER BY active DESC LIMIT 1', t.cp_inn);
    if (c) return { type: 'contractor', contractor_id: c.id, text: (t.direction === 'in' ? 'Оплата от ' : 'Оплата ') + c.name };
  }
  // 6) статья расхода по назначению платежа
  if (t.direction === 'out') for (const [re, cat] of CAT_RULES) if (re.test(t.purpose) || re.test(t.cp_name)) return { type: 'category', category: cat, text: 'Расход: ' + cat };
  return null;
}
function autoMatch(id, user) {
  const t = get('SELECT * FROM bank_tx WHERE id=?', id);
  if (!t || t.status !== 'new') return false;
  const s = suggest(t);
  if (!s) return false;
  apply(id, s, user, true);
  return true;
}
const NOTE = (t) => [t.cp_name, t.purpose].filter(Boolean).join(' — ').slice(0, 300);
// провести операцию: создать платёж в CRM / связать / пропустить
function apply(id, a, user, isAuto = false) {
  const t = get('SELECT * FROM bank_tx WHERE id=?', id);
  if (!t) throw new HttpError(404, 'Операция банка не найдена');
  if (t.status !== 'new') throw new HttpError(400, 'Операция уже разнесена');
  const uid = user?.id || null; const when = t.date + ' 12:00:00';
  const done = (fields) => run(`UPDATE bank_tx SET status=?, action=?, payment_id=?, move_id=?, note=?, done_by=?, done_at=datetime('now','localtime') WHERE id=?`,
    fields.status || 'done', (isAuto ? 'auto:' : '') + a.type, fields.payment_id || null, fields.move_id || null, a.text || fields.note || null, uid, id);
  const pay = (dir, cat, extra = {}) => Number(run(`INSERT INTO payments(direction,method,amount,category,note,order_id,contractor_id,user_id,created_at,bank_tx_id) VALUES(?, 'transfer', ?, ?, ?, ?, ?, ?, ?, ?)`,
    dir, t.amount, cat, NOTE(t), extra.order_id || null, extra.contractor_id || null, uid, when, id).lastInsertRowid);
  tx(() => {
    switch (a.type) {
      case 'link': {
        const p = get('SELECT id FROM payments WHERE id=? AND bank_tx_id IS NULL', +a.payment_id);
        if (!p) throw new HttpError(400, 'Операция в CRM не найдена или уже связана');
        run('UPDATE payments SET bank_tx_id=? WHERE id=?', id, p.id); done({ payment_id: p.id }); break;
      }
      case 'acq': case 'own': case 'skip': done({ status: 'skip' }); break;
      case 'cash': {
        const mv = Number(run(`INSERT INTO money_moves(kind,from_method,to_method,amount,fee,note,user_id,created_at) VALUES('transfer','transfer','cash',?,0,?,?,?)`, t.amount, 'Снятие наличных (выписка банка)', uid, when).lastInsertRowid);
        done({ move_id: mv }); break;
      }
      case 'order': {
        if (!get('SELECT 1 FROM orders WHERE id=?', +a.order_id)) throw new HttpError(400, 'Заказ не найден');
        done({ payment_id: pay('in', 'Оплата заказа', { order_id: +a.order_id }) }); break;
      }
      case 'contractor': {
        if (!get('SELECT 1 FROM contractors WHERE id=?', +a.contractor_id)) throw new HttpError(400, 'Контрагент не найден');
        done({ payment_id: pay(t.direction, t.direction === 'in' ? 'Оплата от контрагента' : 'Оплата контрагенту', { contractor_id: +a.contractor_id }) }); break;
      }
      case 'category': {
        const cat = String(a.category || '').trim() || (t.direction === 'in' ? 'Прочий приход' : 'Прочее');
        done({ payment_id: pay(t.direction, cat) }); break;
      }
      default: throw new HttpError(400, 'Неизвестное действие');
    }
  });
  return { ok: true };
}
// отменить разноску (удаляет созданный платёж/перемещение, связь снимает)
function undo(id) {
  const t = get('SELECT * FROM bank_tx WHERE id=?', id);
  if (!t) throw new HttpError(404, 'Операция банка не найдена');
  tx(() => {
    if (t.payment_id) {
      if (/link$/.test(t.action || '')) run('UPDATE payments SET bank_tx_id=NULL WHERE id=?', t.payment_id);
      else run('DELETE FROM payments WHERE id=? AND bank_tx_id=?', t.payment_id, id);
    }
    if (t.move_id) run('DELETE FROM money_moves WHERE id=?', t.move_id);
    run("UPDATE bank_tx SET status='new', action=NULL, payment_id=NULL, move_id=NULL, note=NULL, done_by=NULL, done_at=NULL WHERE id=?", id);
  });
  return { ok: true };
}

// ---------- маршруты ----------
function register(r, OFFICE, ADMIN) {
  r.get('/api/bank/tx', OFFICE, (ctx) => {
    const st = ['new', 'done', 'skip'].includes(ctx.query.status) ? ctx.query.status : null;
    const rows = all(`SELECT b.*, p.category p_category, p.order_id p_order, k.name p_contractor FROM bank_tx b LEFT JOIN payments p ON p.id=b.payment_id LEFT JOIN contractors k ON k.id=p.contractor_id
                      ${st ? 'WHERE b.status=?' : ''} ORDER BY b.date DESC, b.id DESC LIMIT 500`, ...(st ? [st] : []));
    const out = rows.map(({ raw, ...x }) => (x.status === 'new' ? { ...x, suggestion: suggest(x) } : x));
    const counts = Object.fromEntries(all('SELECT status, COUNT(*) n FROM bank_tx GROUP BY status').map((x) => [x.status, x.n]));
    return { rows: out, counts, bank_balance: getSetting('bank_balance') === '' || getSetting('bank_balance') == null ? null : +getSetting('bank_balance'), bank_balance_date: getSetting('bank_balance_date') };
  });
  r.post('/api/bank/upload', OFFICE, (ctx) => {
    const m = /^data:[^;]*;base64,(.+)$/s.exec(String(ctx.body.data || ''));
    if (!m) throw new HttpError(400, 'Выберите файл выписки');
    const res = parse1C(Buffer.from(m[1], 'base64'));
    if (res.account && !getSetting('alfa_account')) setSetting('alfa_account', res.account);
    if (res.balance !== null) { setSetting('bank_balance', String(res.balance)); setSetting('bank_balance_date', res.dateTo || ''); }
    return { ...ingest(res.list, ctx.user), total: res.list.length, balance: res.balance };
  });
  r.post('/api/bank/tx/:id/apply', OFFICE, (ctx) => apply(+ctx.params.id, ctx.body, ctx.user));
  r.post('/api/bank/tx/:id/undo', ADMIN, (ctx) => undo(+ctx.params.id));
  r.get('/api/bank/tx/:id/candidates', OFFICE, (ctx) => {
    const t = get('SELECT * FROM bank_tx WHERE id=?', +ctx.params.id);
    if (!t) throw new HttpError(404, 'Операция не найдена');
    return all(`SELECT p.id, p.created_at, p.amount, p.category, p.method, p.note, p.order_id, k.name contractor FROM payments p LEFT JOIN contractors k ON k.id=p.contractor_id
                WHERE p.bank_tx_id IS NULL AND p.direction=? AND ABS(p.amount-?)<0.01 AND substr(p.created_at,1,10) BETWEEN date(?, '-10 day') AND date(?, '+10 day') ORDER BY p.created_at DESC LIMIT 20`,
      t.direction, t.amount, t.date, t.date);
  });
  // Alfa API
  const KEYS = ['alfa_env', 'alfa_client_id', 'alfa_account', 'alfa_scope', 'alfa_api_url', 'alfa_auth_url', 'alfa_statement_path', 'alfa_info_path', 'alfa_redirect_uri', 'alfa_auto'];
  r.get('/api/alfa', ADMIN, () => ({ ...Object.fromEntries(KEYS.map((k) => [k, getSetting(k) || ''])), defaults: { ...DEF, env: ENV },
    has_secret: !!getSetting('alfa_client_secret'), has_cert: !!getSetting('alfa_cert'), has_key: !!getSetting('alfa_key'), connected: !!getSetting('alfa_refresh_token'),
    last_sync: getSetting('alfa_last_sync') || '', error: getSetting('alfa_error') || '' }));
  r.put('/api/alfa', ADMIN, (ctx) => {
    const b = ctx.body;
    for (const k of KEYS) if (b[k] !== undefined) setSetting(k, String(b[k]).trim());
    if (b.alfa_client_secret) setSetting('alfa_client_secret', String(b.alfa_client_secret).trim());
    if (b.alfa_key_pass !== undefined && b.alfa_key_pass !== '') setSetting('alfa_key_pass', String(b.alfa_key_pass));
    for (const k of ['alfa_cert', 'alfa_key']) if (b[k]) {
      const v = String(b[k]).trim();
      if (!/-----BEGIN [A-Z ]+-----/.test(v)) throw new HttpError(400, (k === 'alfa_cert' ? 'Сертификат' : 'Ключ') + ' должен быть в формате PEM (-----BEGIN …-----)');
      setSetting(k, v);
    }
    if (b.disconnect) { for (const k of ['alfa_access_token', 'alfa_refresh_token', 'alfa_token_exp']) setSetting(k, ''); }
    return { ok: true };
  });
  r.post('/api/alfa/auth-url', ADMIN, (ctx) => authUrl(origin(ctx.req)));
  r.post('/api/alfa/code', ADMIN, async (ctx) => { await exchangeCode(ctx.body.code, origin(ctx.req)); return { ok: true }; });
  r.get('/api/alfa/callback', async (ctx) => {
    const pk = JSON.parse(getSetting('alfa_pkce') || '{}'); let msg = 'ok';
    try {
      if (ctx.query.error) throw new Error(ctx.query.error_description || ctx.query.error);
      if (!pk.state || pk.state !== ctx.query.state) throw new Error('Ссылка входа устарела — начните подключение заново');
      await exchangeCode(ctx.query.code, origin(ctx.req));
    } catch (e) { msg = e.message; setSetting('alfa_error', msg); }
    ctx.res.writeHead(302, { Location: '/crm#/settings?alfa=' + encodeURIComponent(msg) }); ctx.res.end();
  }, { public: true });
  r.post('/api/alfa/test', ADMIN, async () => ({ ok: true, info: await customerInfo() }));
  r.post('/api/alfa/sync', OFFICE, async (ctx) => {
    try { return await syncApi(+ctx.body.days || 0); } catch (e) { setSetting('alfa_error', e.message); throw e; }
  });
}
const origin = (req) => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

// автоматическая загрузка каждые 30 минут (если подключено)
let timer = null;
function start() {
  migrate();
  if (timer) return;
  timer = setInterval(async () => {
    if (getSetting('alfa_auto') === '0' || !getSetting('alfa_refresh_token') || !getSetting('alfa_cert')) return;
    try { await syncApi(); } catch (e) { setSetting('alfa_error', e.message); console.error('Alfa sync:', e.message); }
  }, 30 * 60 * 1000);
  timer.unref?.();
}

module.exports = { migrate, register, start, parse1C, ingest, suggest, apply, undo, fromApi };
