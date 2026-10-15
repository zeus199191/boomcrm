'use strict';
// Мессенджер MAX: бот студии. Отправка уведомлений, привязка сотрудников, переписка, кнопки статусов.
// Документация: https://dev.max.ru/docs-api  (токен — в заголовке Authorization)
let D; const db = () => (D = D || require('./db'));

const PRIMARY = process.env.MAX_API_URL || 'https://platform-api2.max.ru';
const FALLBACK = 'https://platform-api.max.ru';
let base = PRIMARY;
let polling = false, stopFlag = false, marker = null;
const handlers = { message: null, callback: null };
const state = { ok: false, error: '', bot: null, lastPoll: 0 };

const token = () => db().getSetting('max_token');
const TLS_ERR = /certificate|CERT_|self.signed|unable to (get|verify)/i;

async function call(method, path, { query, body, timeout = 15000 } = {}) {
  const t = token();
  if (!t) return { ok: false, error: 'Не указан токен бота MAX' };
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, {
      method, headers: { Authorization: t, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout),
    });
    let data = null; try { data = await res.json(); } catch {}
    if (!res.ok) return { ok: false, status: res.status, error: (data && (data.message || data.code)) || 'HTTP ' + res.status, data };
    return { ok: true, data };
  } catch (e) {
    const msg = String(e.cause?.code || e.cause?.message || e.message);
    // Сервер Bot API v2 использует сертификат Минцифры; если он не установлен — пробуем старый адрес
    if (base === PRIMARY && !process.env.MAX_API_URL && TLS_ERR.test(msg)) {
      base = FALLBACK; console.warn('MAX: нет сертификата Минцифры, переключаюсь на', FALLBACK);
      return call(method, path, { query, body, timeout });
    }
    return { ok: false, error: msg };
  }
}

// Очередь отправки: MAX разрешает не больше 2 сообщений в секунду в один диалог
let queue = Promise.resolve();
function enqueue(fn) { const p = queue.then(fn, fn); queue = p.then(() => new Promise((r) => setTimeout(r, 350)), () => {}); return p; }

/**
 * Отправить сообщение. to = { user_id } | { chat_id }.
 * buttons — [[{text, payload}|{text, url}]] — строки кнопок.
 */
function send(to, text, { buttons, orderId, userId } = {}) {
  if (!token() || (!to.user_id && !to.chat_id)) return Promise.resolve({ ok: false });
  const body = { text: String(text).slice(0, 3990), format: 'markdown' };
  if (buttons && buttons.length) {
    body.attachments = [{ type: 'inline_keyboard', payload: { buttons: buttons.map((row) => row.map((b) => (b.url ? { type: 'link', text: b.text, url: b.url } : { type: 'callback', text: b.text, payload: b.payload }))) } }];
  }
  return enqueue(async () => {
    const r = await call('POST', '/messages', { query: to.chat_id ? { chat_id: to.chat_id } : { user_id: to.user_id }, body });
    if (!r.ok) { console.error('MAX send:', r.error); return r; }
    const mid = r.data?.message?.body?.mid;
    if (mid && (orderId || userId)) db().run('INSERT OR IGNORE INTO max_outbox(mid,user_id,order_id) VALUES(?,?,?)', mid, userId || null, orderId || null);
    return r;
  });
}

function answerCallback(callbackId, notification) {
  return call('POST', '/answers', { query: { callback_id: callbackId }, body: { notification } });
}

async function me() {
  const r = await call('GET', '/me');
  if (r.ok) { state.bot = r.data; state.ok = true; state.error = ''; } else { state.ok = false; state.error = r.error; }
  return r;
}

// ---------- Привязка сотрудников ----------
function botLink(payload) {
  const name = state.bot?.username;
  return name ? `https://max.ru/${name}?start=${encodeURIComponent(payload)}` : null;
}
function linkUser(userId, update) {
  const { run, get } = db();
  run('UPDATE users SET max_user_id=?, max_chat_id=?, link_code=NULL WHERE id=?', update.user_id, update.chat_id || null, userId);
  return get('SELECT id,name,role,is_master FROM users WHERE id=?', userId);
}
function userByMax(maxUserId) {
  return db().get('SELECT * FROM users WHERE max_user_id=? AND active=1 AND COALESCE(deleted,0)=0', maxUserId);
}
function tryLinkByCode(code, upd) {
  const c = String(code || '').trim().replace(/^u\d+_/, '');
  if (!/^\d{6}$/.test(c)) return null;
  const u = db().get('SELECT id FROM users WHERE link_code=? AND active=1 AND COALESCE(deleted,0)=0', c);
  return u ? linkUser(u.id, upd) : null;
}

async function handleUpdate(u) {
  const { getSetting, setSetting } = db();
  const company = getSetting('company_name');
  if (u.update_type === 'bot_started') {
    const linked = tryLinkByCode(u.payload, { user_id: u.user.user_id, chat_id: u.chat_id });
    if (linked) return send({ chat_id: u.chat_id }, `Готово, ${linked.name}! MAX подключён к CRM «${company}». Сюда будут приходить уведомления, а на сообщения можно отвечать прямо здесь.`);
    const known = userByMax(u.user.user_id);
    if (known) return send({ chat_id: u.chat_id }, `С возвращением, ${known.name}! Уведомления CRM снова включены.`);
    return send({ chat_id: u.chat_id }, `Здравствуйте! Это бот студии «${company}» для сотрудников.\nЧтобы подключиться, отправьте 6-значный код из CRM (Сотрудники → ваша карточка → «Подключить MAX»).`);
  }
  if (u.update_type === 'bot_added' && !u.is_channel) {
    setSetting('max_group_chat_id', String(u.chat_id));
    return send({ chat_id: u.chat_id }, `Бот «${company}» добавлен в чат. Важные события CRM будут дублироваться сюда.`);
  }
  if (u.update_type === 'bot_removed' && String(u.chat_id) === getSetting('max_group_chat_id')) { setSetting('max_group_chat_id', ''); return; }
  if (u.update_type === 'bot_stopped') { db().run('UPDATE users SET max_chat_id=NULL WHERE max_user_id=?', u.user.user_id); return; }
  if (u.update_type === 'message_callback') {
    const cb = u.callback; const user = userByMax(cb.user.user_id);
    let note = 'Нет доступа';
    if (user && handlers.callback) { try { note = await handlers.callback(user, cb.payload || ''); } catch (e) { note = e.message; } }
    return answerCallback(cb.callback_id, note);
  }
  if (u.update_type === 'message_created') {
    const m = u.message; if (!m || !m.sender || m.sender.is_bot) return;
    if (m.recipient?.chat_type && m.recipient.chat_type !== 'dialog') return; // в группе бот только пишет
    const text = (m.body?.text || '').trim();
    const chatId = m.recipient?.chat_id;
    let user = userByMax(m.sender.user_id);
    if (!user) {
      const linked = tryLinkByCode(text, { user_id: m.sender.user_id, chat_id: chatId });
      if (linked) return send({ chat_id: chatId }, `Готово, ${linked.name}! MAX подключён к CRM «${company}».`);
      return send({ chat_id: chatId }, 'Вы ещё не подключены к CRM. Отправьте 6-значный код из своей карточки сотрудника.');
    }
    if (chatId && chatId !== user.max_chat_id) db().run('UPDATE users SET max_chat_id=? WHERE id=?', chatId, user.id);
    if (!text) return;
    let orderId = null;
    const replyMid = m.link?.type === 'reply' ? m.link.message?.mid : null;
    if (replyMid) orderId = (db().get('SELECT order_id FROM max_outbox WHERE mid=?', replyMid) || {}).order_id || null;
    if (handlers.message) await handlers.message(user, text, orderId);
  }
}

async function poll() {
  if (polling) return;
  polling = true; stopFlag = false;
  await me();
  while (!stopFlag && token()) {
    const r = await call('GET', '/updates', { query: { marker, timeout: 30, limit: 100 }, timeout: 40000 });
    state.lastPoll = Date.now();
    if (r.ok) {
      state.ok = true; state.error = '';
      if (r.data?.marker != null) { marker = r.data.marker; db().setSetting('max_marker', String(marker)); }
      for (const u of r.data?.updates || []) { try { await handleUpdate(u); } catch (e) { console.error('MAX update', e.message); } }
    } else {
      state.ok = false; state.error = r.error;
      await new Promise((res) => setTimeout(res, r.status === 401 ? 60000 : 10000));
    }
  }
  polling = false;
}

function start(h = {}) {
  Object.assign(handlers, h);
  const mk = db().getSetting('max_marker'); marker = mk ? Number(mk) : null;
  if (token()) poll();
}
function restart() {
  stopFlag = true; base = PRIMARY;
  const t = setInterval(() => { if (!polling) { clearInterval(t); if (token()) poll(); else { state.ok = false; state.bot = null; } } }, 500);
}

module.exports = { send, call, me, start, restart, botLink, state: () => ({ ...state, base, polling }) };
