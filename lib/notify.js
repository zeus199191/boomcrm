'use strict';
// Центр уведомлений: MAX (бот студии) + Telegram. Подписки по событиям для каждого сотрудника.
const { all, get, run, getSetting, setSetting } = require('./db');
const max = require('./max');
const tg = require('./telegram');

const EVENTS = {
  lead_new: { title: 'Новые заявки', group: 'boss' },
  order_new: { title: 'Новые записи', group: 'boss' },
  order_done: { title: 'Авто готово', group: 'boss' },
  order_issued: { title: 'Авто выдано (оплата, долг)', group: 'boss' },
  low_stock: { title: 'Заканчивается товар', group: 'boss' },
  daily: { title: 'Итоги дня и записи на завтра', group: 'boss' },
  staff_msg: { title: 'Сообщения от сотрудников', group: 'boss' },
  my_assigned: { title: 'Мне назначен заказ', group: 'master' },
  my_changed: { title: 'Перенос / отмена моей записи', group: 'master' },
  my_tomorrow: { title: 'Мои записи на завтра', group: 'master' },
};
// что попадает в общий чат MAX (если бот добавлен в группу)
const GROUP_EVENTS = ['lead_new', 'order_new', 'order_done', 'order_issued'];

function defaultsFor(u) {
  const boss = Object.keys(EVENTS).filter((k) => EVENTS[k].group === 'boss');
  const mine = Object.keys(EVENTS).filter((k) => EVENTS[k].group === 'master');
  if (u.role === 'master') return mine;
  if (u.role === 'manager' && u.is_master) return [...boss, ...mine];
  return boss;
}
function subs(u) {
  if (u.notify) { try { return JSON.parse(u.notify); } catch {} }
  return defaultsFor(u);
}
const staffList = () => all('SELECT * FROM users WHERE active=1 AND COALESCE(deleted,0)=0');

// доставка конкретному сотруднику: MAX, затем Telegram. Возвращает список каналов.
async function deliver(u, text, opts = {}) {
  const used = [];
  if (u.max_chat_id || u.max_user_id) {
    const r = await max.send(u.max_chat_id ? { chat_id: u.max_chat_id } : { user_id: u.max_user_id }, text, { ...opts, userId: u.id });
    if (r && r.ok) used.push('max');
  }
  if (u.tg_chat_id && (!used.length || opts.both)) {
    const r = await tg.send(u.tg_chat_id, text.replace(/\*\*/g, ''));
    if (r && r.ok) used.push('telegram');
  }
  return used;
}

// Событие для руководства (+ общий чат MAX + чат сотрудников в Telegram)
function boss(event, text, opts = {}) {
  for (const u of staffList()) if (u.role !== 'master' && u.id !== opts.exclude && subs(u).includes(event)) deliver(u, text, opts).catch(() => {});
  const group = getSetting('max_group_chat_id');
  if (group && getSetting('max_group_on') !== '0' && GROUP_EVENTS.includes(event)) max.send({ chat_id: +group }, text, { orderId: opts.orderId }).catch(() => {});
  if (event !== 'staff_msg' && event !== 'daily') tg.staff(text.replace(/\*\*/g, '')).catch?.(() => {});
}
// Событие для конкретного мастера
function toUser(userId, event, text, opts = {}) {
  const u = get('SELECT * FROM users WHERE id=? AND active=1 AND COALESCE(deleted,0)=0', userId);
  if (u && subs(u).includes(event)) deliver(u, text, opts).catch(() => {});
}

// Кнопки статуса для мастера
const statusButtons = (orderId) => [[
  { text: '🔧 В работе', payload: `st:${orderId}:in_work` },
  { text: '⏳ Ждёт запчасти', payload: `st:${orderId}:waiting` },
  { text: '✅ Готово', payload: `st:${orderId}:done` },
]];

// ---------- Ежедневная сводка ----------
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const rub = (n) => (Math.round(n || 0)).toLocaleString('ru-RU') + ' ₽';
const car = (r) => [r.brand, r.model, r.plate].filter(Boolean).join(' ');
function dailyTick(force) {
  const now = new Date();
  const [hh, mm] = (getSetting('digest_time', '19:00') || '19:00').split(':').map(Number);
  const todayStr = ymd(now);
  if (!force && (now.getHours() * 60 + now.getMinutes() < hh * 60 + (mm || 0) || getSetting('last_digest') === todayStr)) return;
  setSetting('last_digest', todayStr);
  const t = new Date(now); t.setDate(t.getDate() + 1); const tomorrow = ymd(t);
  const rows = all(`SELECT o.id,o.scheduled_at,o.bay,o.master_id,o.complaint,c.name,c.phone,c.tg_chat_id,ca.brand,ca.model,ca.plate,u.name master
                    FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id LEFT JOIN users u ON u.id=o.master_id
                    WHERE substr(o.scheduled_at,1,10)=? AND o.status IN ('new','scheduled') ORDER BY o.scheduled_at`, tomorrow);
  const dm = tomorrow.split('-').reverse().slice(0, 2).join('.');
  const list = rows.map((r) => `• ${r.scheduled_at.slice(11, 16)} ${r.bay || ''} — ${car(r)}, ${r.name || ''}${r.master ? ' (' + r.master + ')' : ''}`).join('\n');
  // руководству: итоги дня
  const inc = get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='in' AND substr(created_at,1,10)=?", todayStr).s;
  const out = get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='out' AND substr(created_at,1,10)=?", todayStr).s;
  const issued = get("SELECT COUNT(*) n FROM orders WHERE status='issued' AND substr(issued_at,1,10)=?", todayStr).n;
  const leads = get('SELECT COUNT(*) n FROM leads WHERE substr(created_at,1,10)=?', todayStr).n;
  const inWork = get("SELECT COUNT(*) n FROM orders WHERE status IN ('in_work','waiting','done')").n;
  const text = `📊 **Итоги дня ${todayStr.split('-').reverse().slice(0, 2).join('.')}**\nПоступления: ${rub(inc)} · расходы: ${rub(out)}\nВыдано авто: ${issued} · в работе сейчас: ${inWork}\nНовых заявок: ${leads}\n\n🗓 **Записи на завтра (${dm})**: ${rows.length || 'нет'}${rows.length ? '\n' + list : ''}`;
  boss('daily', text);
  if (rows.length) tg.staff(`🗓 Записи на завтра (${dm}):\n${list}`).catch?.(() => {});
  // мастерам: их записи на завтра
  const byMaster = {};
  for (const r of rows) if (r.master_id) (byMaster[r.master_id] = byMaster[r.master_id] || []).push(r);
  for (const [mid, rs] of Object.entries(byMaster)) {
    toUser(+mid, 'my_tomorrow', `🗓 **Ваши записи на завтра (${dm})**\n` + rs.map((r) => `• ${r.scheduled_at.slice(11, 16)} ${r.bay || ''} — ${car(r)}${r.complaint ? '\n  ' + r.complaint.slice(0, 150) : ''}`).join('\n'));
  }
  tg.remindClients(rows);
}

function start(handlers) {
  max.start(handlers);
  tg.start({ message: handlers.message });
  setInterval(() => { try { dailyTick(); } catch (e) { console.error('digest', e); } }, 60e3);
}

module.exports = { EVENTS, defaultsFor, subs, deliver, boss, toUser, statusButtons, dailyTick, start };
