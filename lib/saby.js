'use strict';
// Онлайн-касса Saby (СБИС Розница) на смарт-терминале Нева-01-Ф + терминал Альфа-Банка.
// Схема: CRM создаёт по API Saby заказ на сумму оплаты → кассир открывает его на кассе в «Заказах» и проводит оплату картой →
// Saby сам отправляет сумму на банковский терминал и пробивает чек → CRM видит, что заказ оплачен, и записывает оплату.
// Документация: saby.ru/help/integration/api (сервисная авторизация, retail/order/*, retail/point/list, retail/nomenclature/*).
const crypto = require('node:crypto');
const { db, all, get, run, getSetting, setSetting } = require('./db');
const { HttpError } = require('./http');

const API = () => (getSetting('saby_api_url') || 'https://api.sbis.ru').replace(/\/$/, '');
const AUTH = () => getSetting('saby_auth_url') || 'https://online.sbis.ru/oauth/service/';
const KEYS = ['saby_client_id', 'saby_app_secret', 'saby_secret_key', 'saby_point_id', 'saby_point_name', 'saby_price_list_id', 'saby_price_list_name',
  'saby_nom', 'saby_mode', 'saby_api_url', 'saby_auth_url'];
const SECRET = ['saby_app_secret', 'saby_secret_key'];
const r2 = (x) => Math.round((+x || 0) * 100) / 100;

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS saby_orders (id INTEGER PRIMARY KEY, order_id INTEGER, ext_id TEXT UNIQUE, amount REAL, status TEXT DEFAULT 'pending',
    paid REAL DEFAULT 0, method TEXT, payment_ids TEXT, saby_state TEXT, error TEXT, user_id INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')), checked_at TEXT, closed_at TEXT)`);
  if (!all('PRAGMA table_info(saby_orders)').some((c) => c.name === 'req_method')) db.exec('ALTER TABLE saby_orders ADD COLUMN req_method TEXT'); // как клиент платит: cash / card (перевод) / terminal
}
// способ оплаты CRM → paymentType заказа Saby (кассир видит, как закрыть заказ; чек печатает касса)
const SABY_PAY = { cash: 'cash', terminal: 'card', card: 'online' };
const configured = () => !!(getSetting('saby_client_id') && getSetting('saby_app_secret') && getSetting('saby_secret_key'));
const ready = () => configured() && !!getSetting('saby_point_id') && !!getSetting('saby_nom'); // прайс-лист — по возможности, не обязателен

let tok = null;
async function token(force) {
  if (tok && !force) return tok;
  if (!configured()) throw new HttpError(400, 'Укажите ключи приложения Saby в Настройках');
  let res, data;
  try {
    res = await fetch(AUTH(), { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
      body: JSON.stringify({ app_client_id: getSetting('saby_client_id'), app_secret: getSetting('saby_app_secret'), secret_key: getSetting('saby_secret_key') }),
      signal: AbortSignal.timeout(20000) });
    data = await res.json().catch(() => null);
  } catch (e) { throw new HttpError(502, 'Нет связи с Saby: ' + (e.cause?.code || e.message)); }
  if (!res.ok || !data || !data.token) throw new HttpError(502, 'Saby не выдал доступ: ' + ((data && (data.error_description || data.message || data.error)) || res.status) + '. Проверьте ID приложения, защищённый и сервисный ключи.');
  tok = data.token; return tok;
}
async function api(method, path, { query, json } = {}, retry = true) {
  const t = await token();
  const u = new URL(API() + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  let res, txt;
  try {
    res = await fetch(u, { method, headers: { 'X-SBISAccessToken': t, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
      body: json ? JSON.stringify(json) : undefined, signal: AbortSignal.timeout(30000) });
    txt = await res.text();
  } catch (e) { throw new HttpError(502, 'Нет связи с Saby: ' + (e.cause?.code || e.message)); }
  if (res.status === 401 && retry) { tok = null; return api(method, path, { query, json }, false); }
  let data = null; try { data = JSON.parse(txt); } catch {}
  if (!res.ok) {
    const msg = data && (data.message || data.error?.message || data.error_description || data.details || (typeof data.error === 'string' && data.error));
    throw new HttpError(502, `Saby ответил ${res.status}: ${msg || txt.slice(0, 200) || 'ошибка'}`);
  }
  return data ?? txt;
}

const localNow = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 19).replace('T', ' '); };
function nomRef() { try { return JSON.parse(getSetting('saby_nom') || 'null'); } catch { return null; } }

// Позиции для кассы: построчно (если оплачивают весь остаток) или одной строкой «Оплата по заказ-наряду»
function buildLines(o, amount) {
  const ref = nomRef(); if (!ref) throw new HttpError(400, 'Выберите в Настройках позицию Saby, через которую пробиваются услуги и товары');
  const base = getSetting('saby_price_list_id') ? { priceListId: +getSetting('saby_price_list_id') } : {};
  if (ref.id) base.id = +ref.id; else if (ref.externalId) base.externalId = ref.externalId; else base.nomNumber = String(ref.nomNumber);
  if (ref.hierarchicalId) base.hierarchicalId = +ref.hierarchicalId;
  const k = 1 - (o.discount_percent || 0) / 100;
  const items = (o.items || []).filter((i) => i.qty > 0 && i.price > 0);
  if (getSetting('saby_mode', 'items') === 'items' && items.length && Math.abs(r2(amount) - r2(o.totals.due)) < 0.01 && Math.abs(r2(o.totals.paid)) < 0.01) {
    const lines = items.map((i) => ({ ...base, name: String(i.name).slice(0, 128), count: i.qty, cost: r2(i.price * k) }));
    // поправка копеек округления — на последнюю строку с количеством 1, иначе отдельной строкой не делаем: переходим на одну строку
    const diff = r2(amount - lines.reduce((s, l) => s + l.cost * l.count, 0));
    if (Math.abs(diff) < 0.005) return lines;
    const one = [...lines].reverse().find((l) => l.count === 1);
    if (one && one.cost + diff > 0) { one.cost = r2(one.cost + diff); return lines; }
  }
  return [{ ...base, name: `Оплата по заказ-наряду ${o.number}`.slice(0, 128), count: 1, cost: r2(amount) }];
}

async function send(o, amount, user, method = 'terminal') {
  if (!SABY_PAY[method]) method = 'terminal';
  if (!ready()) throw new HttpError(400, 'Касса Saby не настроена: Настройки → «Онлайн-касса Saby»');
  amount = r2(amount); if (amount <= 0) throw new HttpError(400, 'Укажите сумму');
  if (get("SELECT 1 FROM saby_orders WHERE order_id=? AND status='pending'", o.id)) throw new HttpError(409, 'По этому заказу уже есть оплата, ожидающая на кассе. Проведите или отмените её.');
  if (!getSetting('saby_price_list_id')) { // прайс-лист обязателен для позиций заказа — пробуем взять из точки продаж
    try {
      const d = await api('GET', '/retail/point/list', { query: { withPrices: true, pageSize: 100 } });
      const pt = (d?.salesPoints || []).find((x) => String(x.id) === String(getSetting('saby_point_id')));
      const pr = Array.isArray(pt?.prices) && pt.prices.length ? pt.prices[0] : null;
      const id = pt?.defaultPriceList || (pr && typeof pr === 'object' ? pr.id : pr);
      if (id) { setSetting('saby_price_list_id', String(id)); setSetting('saby_price_list_name', 'из точки продаж (' + id + ')'); }
    } catch {}
  }
  const ext = crypto.randomUUID();
  const body = {
    product: 'delivery', pointId: +getSetting('saby_point_id'), externalId: ext, datetime: localNow(),
    customer: { name: (o.client_name || 'Клиент').slice(0, 100), phone: String(o.client_phone || '').replace(/[^\d+]/g, '') || '0' },
    comment: [`Заказ-наряд ${o.number}`, [o.brand, o.model, o.plate].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
    nomenclatures: buildLines(o, amount), delivery: { isPickup: true, paymentType: SABY_PAY[method] }, // по документации paymentType — внутри delivery
  };
  let res;
  try { res = await api('POST', '/retail/order/create', { json: body }); }
  catch (e) {
    setSetting('saby_diag', JSON.stringify({ at: localNow(), step: 'order/create', error: e.message, request: body }).slice(0, 6000));
    const hint = !getSetting('saby_price_list_id') ? ' Скорее всего Saby нужен прайс-лист: Настройки → «Онлайн-касса Saby» → укажите ID прайс-листа.' : '';
    throw new HttpError(502, e.message + hint);
  }
  run('INSERT INTO saby_orders(order_id,ext_id,amount,user_id,saby_state,req_method) VALUES(?,?,?,?,?,?)', o.id, ext, amount, user ? user.id : null, JSON.stringify(res || {}).slice(0, 2000), method);
  return { ok: true, ext_id: ext };
}

// Разбор ответа о заказе: сколько оплачено и чем
function paidFrom(info) {
  const pays = Array.isArray(info?.payments) ? info.payments : [];
  const closed = pays.filter((p) => p.isClosed === true || p.isClosed === 1);
  return { sum: r2(closed.reduce((s, p) => s + (+p.amount || 0), 0)), method: closed.some((p) => /cash/i.test(p.paymentType || '')) && !closed.some((p) => /card/i.test(p.paymentType || '')) ? 'cash' : 'terminal', list: closed };
}
const CANCEL_RE = /cancel|отмен|annul|deleted/i;

let onPaid = null;
async function check(row) {
  let info;
  try { info = await api('GET', '/retail/order/' + encodeURIComponent(row.ext_id)); }
  catch (e) { run("UPDATE saby_orders SET error=?, checked_at=datetime('now','localtime') WHERE id=?", e.message, row.id); return { status: row.status, error: e.message }; }
  const p = paidFrom(info);
  const state = [info?.state, info?.payState].filter((x) => x !== undefined && x !== null).join(' / ');
  run("UPDATE saby_orders SET saby_state=?, error=NULL, checked_at=datetime('now','localtime') WHERE id=?", JSON.stringify({ state: info?.state, payState: info?.payState, payments: info?.payments }).slice(0, 2000), row.id);
  if (p.sum > 0.009 && row.status === 'pending') {
    // способ берём тот, что выбрали в CRM (наличные / перевод / терминал); если не указан — по ответу Saby
    const method = row.req_method || p.method;
    const ids = onPaid ? onPaid(row.order_id, p.sum, method, row.user_id, `Касса Saby${state ? ' · ' + state : ''}`) : [];
    run("UPDATE saby_orders SET status='paid', paid=?, method=?, payment_ids=?, closed_at=datetime('now','localtime') WHERE id=?", p.sum, method, JSON.stringify(ids || []), row.id);
    return { status: 'paid', paid: p.sum };
  }
  if (CANCEL_RE.test(String(info?.state ?? '')) && row.status === 'pending') {
    run("UPDATE saby_orders SET status='cancelled', closed_at=datetime('now','localtime') WHERE id=?", row.id);
    return { status: 'cancelled' };
  }
  return { status: row.status, state };
}
async function cancel(row) {
  if (row.status !== 'pending') throw new HttpError(400, 'Эта оплата уже закрыта');
  const st = await check(row); if (st.status === 'paid') return st;
  try { await api('PUT', `/retail/order/${encodeURIComponent(row.ext_id)}/cancel`, { json: {} }); }
  catch (e) { if (!/404/.test(e.message)) throw e; }
  run("UPDATE saby_orders SET status='cancelled', closed_at=datetime('now','localtime') WHERE id=?", row.id);
  return { status: 'cancelled' };
}
const forOrder = (orderId) => all("SELECT * FROM saby_orders WHERE order_id=? AND (status='pending' OR closed_at>=datetime('now','localtime','-1 day')) ORDER BY id DESC", orderId);

function register(r, OFFICE, ADMIN, { loadOrder, recordPayment }) {
  onPaid = recordPayment;
  r.get('/api/saby', ADMIN, () => ({
    ...Object.fromEntries(KEYS.filter((k) => !SECRET.includes(k)).map((k) => [k, getSetting(k) || ''])),
    has_app_secret: !!getSetting('saby_app_secret'), has_secret_key: !!getSetting('saby_secret_key'),
    configured: configured(), ready: ready(), error: getSetting('saby_error') || '',
    diag: [['Последняя ошибка', getSetting('saby_diag')], ['Ответ Saby о прайс-листах', getSetting('saby_pricelist_sample')], ['Точки продаж', getSetting('saby_points_sample')]].filter((x) => x[1]).map(([t, v]) => t + ':\n' + v).join('\n\n'),
  }));
  r.put('/api/saby', ADMIN, (ctx) => {
    const b = ctx.body || {};
    if (b.disconnect) { for (const k of KEYS) setSetting(k, ''); tok = null; return { ok: true }; }
    for (const k of KEYS) if (b[k] !== undefined) { if (SECRET.includes(k) && !String(b[k]).trim()) continue; setSetting(k, typeof b[k] === 'object' ? JSON.stringify(b[k]) : String(b[k]).trim()); }
    tok = null; setSetting('saby_error', '');
    return { ok: true };
  });
  r.post('/api/saby/test', ADMIN, async () => {
    await token(true);
    const d = await api('GET', '/retail/point/list', { query: { product: 'delivery', withPrices: true, pageSize: 100 } });
    let pts = d?.salesPoints || [];
    if (!pts.length) { const d2 = await api('GET', '/retail/point/list', { query: { withPrices: true, pageSize: 100 } }); pts = d2?.salesPoints || []; }
    setSetting('saby_points_sample', JSON.stringify(pts.map((p) => ({ id: p.id, name: p.name, defaultPriceList: p.defaultPriceList, prices: p.prices, priceLists: p.priceLists }))).slice(0, 3000));
    return { points: pts.map((p) => ({ id: p.id, name: p.name, address: p.address, defaultPriceList: p.defaultPriceList, prices: p.prices })) };
  });
  // Прайс-листы точки. Saby в разных версиях ждёт дату как «ГГГГ-ММ-ДД» или с временем — пробуем оба варианта,
  // а если метод недоступен, берём прайсы из описания точки продаж (point/list?withPrices=true).
  r.get('/api/saby/prices', ADMIN, async (ctx) => {
    const pick = (d) => { const l = Array.isArray(d) ? d : d?.priceLists || d?.prices || d?.records || d?.result || (d && typeof d === 'object' ? Object.values(d).find((v) => Array.isArray(v) && v.length && typeof v[0] === 'object') : null) || []; return Array.isArray(l) ? l.map((x) => (x !== null && typeof x !== 'object' ? { id: x } : x)).filter((x) => x && x.id !== undefined && x.id !== null).map((x) => ({ id: String(x.id), name: x.name || x.title || 'Прайс-лист № ' + x.id })) : []; };
    const errs = [];
    let sample = '';
    for (const actualDate of [localNow().slice(0, 10), localNow().slice(0, 10) + ' 00:00:00', localNow()]) {
      try { const raw = await api('GET', '/retail/nomenclature/price-list', { query: { pointId: ctx.query.pointId, actualDate, pageSize: 100 } }); const l = pick(raw); if (l.length) return l; if (!sample) sample = JSON.stringify(raw).slice(0, 300); }
      catch (e) { errs.push(e.message); }
    }
    if (sample) setSetting('saby_pricelist_sample', sample); // для разбора, если Saby вернёт прайсы в другом виде
    try {
      const d = await api('GET', '/retail/point/list', { query: { withPrices: true, pageSize: 100 } });
      const pt = (d?.salesPoints || []).find((p) => String(p.id) === String(ctx.query.pointId));
      const l = pick(pt?.prices || []);
      if (l.length) return l;
      if (pt?.defaultPriceList) return [{ id: String(pt.defaultPriceList), name: 'Прайс точки по умолчанию (' + pt.defaultPriceList + ')' }];
    } catch (e) { errs.push(e.message); }
    if (errs.length) throw new HttpError(502, 'Не удалось получить прайс-листы Saby: ' + errs[0]);
    return [];
  });
  r.get('/api/saby/noms', ADMIN, async (ctx) => {
    const d = await api('GET', '/retail/v2/nomenclature/list', { query: { pointId: ctx.query.pointId, priceListId: ctx.query.priceListId, searchString: ctx.query.q, pageSize: 25 } });
    const list = Array.isArray(d) ? d : d?.nomenclatures || d?.records || [];
    return list.filter((x) => x && (x.id || x.externalId || x.nomNumber)).map((x) => ({ id: x.id, externalId: x.externalId, nomNumber: x.nomNumber, hierarchicalId: x.hierarchicalId, name: x.name, cost: x.cost }));
  });
  r.post('/api/orders/:id/saby', OFFICE, async (ctx) => {
    const o = loadOrder(+ctx.params.id);
    return send(o, ctx.body.amount, ctx.user, ctx.body.method);
  });
  r.post('/api/saby/:id/check', OFFICE, async (ctx) => {
    const row = get('SELECT * FROM saby_orders WHERE id=?', +ctx.params.id); if (!row) throw new HttpError(404, 'Не найдено');
    return check(row);
  });
  r.post('/api/saby/:id/cancel', OFFICE, async (ctx) => {
    const row = get('SELECT * FROM saby_orders WHERE id=?', +ctx.params.id); if (!row) throw new HttpError(404, 'Не найдено');
    return cancel(row);
  });
}

// фоновая проверка ожидающих оплат: каждые 20 секунд, не дольше 2 суток с момента отправки
let timer = null, busy = false;
function start() {
  migrate();
  if (timer) return;
  timer = setInterval(async () => {
    if (busy || !configured()) return; busy = true;
    try {
      const rows = all("SELECT * FROM saby_orders WHERE status='pending' AND created_at>=datetime('now','localtime','-2 day') ORDER BY id LIMIT 20");
      for (const row of rows) await check(row);
    } catch (e) { setSetting('saby_error', e.message); }
    finally { busy = false; }
  }, 20000);
  timer.unref?.();
}

module.exports = { migrate, register, start, forOrder, ready, buildLines, paidFrom };
