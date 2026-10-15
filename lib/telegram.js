'use strict';
// Telegram-бот: уведомления сотрудникам, привязка клиентов по номеру, напоминания о записи
let db; // ленивое подключение, чтобы избежать циклических импортов
const D = () => (db = db || require('./db'));

let polling = false, offset = 0, stopFlag = false;

async function call(method, payload) {
  const token = D().getSetting('tg_token');
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 15000),
    });
    return await res.json();
  } catch (e) {
    if (method !== 'getUpdates') console.error('telegram', method, e.message);
    return { ok: false, description: e.message };
  }
}

function send(chatId, text, extra = {}) {
  if (!chatId) return Promise.resolve(null);
  return call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra });
}
function staff(text) {
  const chat = D().getSetting('tg_staff_chat');
  return chat ? send(chat, text) : Promise.resolve(null);
}

async function handleUpdate(u) {
  const m = u.message;
  if (!m) return;
  const chatId = String(m.chat.id);
  const company = D().getSetting('company_name');
  if (m.contact) {
    const phone = D().normPhone(m.contact.phone_number);
    const client = D().get('SELECT * FROM clients WHERE phone_norm=?', phone);
    const user = D().all('SELECT * FROM users WHERE active=1').find((x) => D().normPhone(x.phone) === phone);
    if (user) {
      D().run('UPDATE users SET tg_chat_id=? WHERE id=?', chatId, user.id);
      await send(chatId, `Готово, ${user.name}! Теперь вы будете получать уведомления о назначенных заказах.`, { reply_markup: { remove_keyboard: true } });
    } else if (client) {
      D().run('UPDATE clients SET tg_chat_id=? WHERE id=?', chatId, client.id);
      await send(chatId, `Спасибо, ${client.name}! Мы пришлём сюда напоминание о записи и сообщим, когда автомобиль будет готов.`, { reply_markup: { remove_keyboard: true } });
    } else {
      await send(chatId, `Номер не найден в базе ${company}. Если вы недавно у нас записались — администратор свяжется с вами.`, { reply_markup: { remove_keyboard: true } });
      staff(`📱 В бота написал незнакомый номер: +${phone} (${[m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ')})`);
    }
    return;
  }
  const text = (m.text || '').trim();
  if (text && !text.startsWith('/') && m.chat.type === 'private' && onStaffMessage) {
    const staffUser = D().get('SELECT * FROM users WHERE tg_chat_id=? AND active=1 AND COALESCE(deleted,0)=0', chatId);
    if (staffUser) return onStaffMessage(staffUser, text, null, 'telegram');
  }
  if (text.startsWith('/id')) return send(chatId, `ID этого чата: ${chatId}`);
  if (text.startsWith('/start') && m.chat.type === 'private') {
    return send(chatId, `Здравствуйте! Это бот ${company}.\nНажмите кнопку ниже, чтобы мы могли присылать уведомления о вашей записи и готовности автомобиля.`, {
      reply_markup: { keyboard: [[{ text: '📱 Поделиться номером', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
  }
}

async function poll() {
  if (polling) return;
  polling = true; stopFlag = false;
  while (!stopFlag && D().getSetting('tg_token')) {
    const res = await call('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
    if (res && res.ok) {
      for (const u of res.result) {
        offset = u.update_id + 1;
        try { await handleUpdate(u); } catch (e) { console.error('tg update', e.message); }
      }
    } else {
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  polling = false;
}

function restart() {
  stopFlag = true;
  const t = setInterval(() => { if (!polling) { clearInterval(t); if (D().getSetting('tg_token')) poll(); } }, 500);
}

// Ежедневная рассылка: в 18:00 — список записей на завтра сотрудникам + напоминания клиентам
// Напоминания клиентам о записи на завтра (вызывается из notify.dailyTick)
function remindClients(rows) {
  const addr = D().getSetting('company_address');
  for (const r of rows) {
    if (r.tg_chat_id) send(r.tg_chat_id, `Напоминаем: завтра в ${r.scheduled_at.slice(11, 16)} вы записаны в ${D().getSetting('company_name')}${addr ? ' (' + addr + ')' : ''}. Ждём вас!`);
  }
}

let onStaffMessage = null;
function start(h = {}) {
  onStaffMessage = h.message || null;
  if (D().getSetting('tg_token')) poll();
}

module.exports = { send, staff, start, restart, remindClients };
