'use strict';
/* CRM «Бумсистем» — клиентская часть (без сборки, чистый JS) */

// ================= Утилиты =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
const num = (n) => (Math.round((+n || 0) * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Текущее время студии (часовой пояс из настроек CRM, по умолчанию Иркутск) — независимо от часового пояса компьютера
function nowTz() {
  const tz = S.me && S.me.tz; if (!tz) return new Date();
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const g = (t) => +p.find((x) => x.type === t).value;
    return new Date(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  } catch { return new Date(); }
}
const today = () => ymd(nowTz());
const dmy = (s) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '');
const dt = (s) => (s ? dmy(s) + (s.length > 10 ? ' ' + s.slice(11, 16) : '') : '');
const orderNo = (id) => 'БС-' + String(id).padStart(5, '0');
const carStr = (o) => [o.brand, o.model].filter(Boolean).join(' ') + (o.plate ? ` · ${o.plate}` : '');
const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const METHODS = { cash: 'Наличные', card: 'Перевод на карту', terminal: 'Терминал', transfer: 'Расчётный счёт' }; // подписи в журналах
const WALLET = { cash: 'Наличные', card: 'Карта', transfer: 'Расчётный счёт' };                                  // кассы (остатки)
const PAY_IN = { cash: 'Наличные', card: 'Перевод на карту (без эквайринга)', terminal: 'Терминал — банковская карта (эквайринг)' }; // оплата от клиента
const ROLES = { admin: 'Администратор', senior: 'Руководитель-мастер', manager: 'Менеджер', master: 'Мастер' };
const myRole = () => (S.me.user.role === 'manager' && S.me.user.is_master ? 'senior' : S.me.user.role);
const LEAD_ST = { new: 'Новая', work: 'В работе', converted: 'Заказ создан', lost: 'Отказ' };
const SOURCES = ['Рекомендация', 'Авито', 'Яндекс Карты', '2ГИС', 'ВКонтакте', 'Telegram', 'Instagram', 'Сайт', 'Проезжал мимо', 'Постоянный клиент'];
const EXPENSE_CATS = ['Аренда', 'Закупка товара', 'Расходники', 'Зарплата', 'Коммунальные', 'Реклама', 'Инструмент', 'Налоги', 'Кредит', 'Банковская комиссия', 'Эквайринг', 'Зарплата руководителей', 'Прочее'];
const INCOME_CATS = ['Оплата заказа', 'Продажа без заказа', 'Внесение в кассу', 'Прочее'];

const S = { me: null, staff: [], services: null };
const role = () => S.me.user.role;
const isOffice = () => role() !== 'master';
const isAdmin = () => role() === 'admin' || myRole() === 'senior'; // руководитель-мастер = права администратора
const isDayOff = (ds) => (S.me.days_off || []).includes(new Date(String(ds).slice(0, 10) + 'T12:00').getDay());
const stBadge = (st) => `<span class="badge st-${st}">${esc(S.me.statuses[st] || st)}</span>`;

function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), err ? 6000 : 3000);
}

async function api(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(url, opt);
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && url !== '/api/login') { S.me = null; renderLogin(); throw new Error('Требуется вход'); }
  if (!res.ok) { const e = new Error((data && data.error) || 'Ошибка ' + res.status); e.status = res.status; throw e; }
  return data;
}
const GET = (u) => api('GET', u);
const POST = (u, b = {}) => api('POST', u, b);
const PUT = (u, b = {}) => api('PUT', u, b);
const DEL = (u) => api('DELETE', u);
const qs = (o) => '?' + new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

// Собрать значения формы
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; else if (!(el.name in o)) o[el.name] = ''; }
    else o[el.name] = el.value;
  }
  return o;
}
function opts(list, cur, empty) {
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    list.map((x) => { const [v, t] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${esc(t)}</option>`; }).join('');
}
const masters = () => S.staff.filter((u) => u.can_work || u.role === 'admin');
// График: отсутствующие мастера на даты записи → «(Н/Р)» и красный цвет
let ABS = {};
async function absentFor(from, to) {
  if (!from) return {}; from = String(from).slice(0, 10); to = to ? String(to).slice(0, 10) : from;
  const k = from + '|' + to; if (!ABS[k]) ABS[k] = GET('/api/schedule/absent' + qs({ from, to })).catch(() => ({}));
  return ABS[k];
}
function masterOpts(cur, abs = {}) {
  return '<option value="">—</option>' + masters().map((u) => { const a = abs[u.id];
    return `<option value="${u.id}" ${String(u.id) === String(cur ?? '') ? 'selected' : ''}${a ? ' class="nr"' : ''}>${esc(u.name)}${a ? ' (Н/Р)' : ''}</option>`; }).join('');
}
async function markMasters(root, from, to) {
  const abs = await absentFor(from, to);
  $$('select[name=master_id], select[data-f=master_id]', root).forEach((sel) => {
    const v = sel.value; sel.innerHTML = masterOpts(v, abs); sel.value = v;
    const paint = () => { const a = abs[sel.value]; sel.classList.toggle('nr', !!a);
      let w = sel.nextElementSibling; if (!w || !w.classList.contains('nrw')) { w = document.createElement('div'); w.className = 'nrw'; sel.after(w); }
      w.textContent = a ? `Не работает по графику: ${a.map((d) => d.slice(8, 10) + '.' + d.slice(5, 7)).join(', ')}` : ''; };
    if (!sel.dataset.nrb) { sel.dataset.nrb = 1; sel.addEventListener('change', paint); }
    paint();
  });
}
const canWork = () => myRole() === 'master' || myRole() === 'senior';

// ================= Модальные окна =================
function modal(title, body, { submit = 'Сохранить', wide = false, onSubmit, footer, onOpen } = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<form class="modal ${wide ? 'wide' : ''}" autocomplete="off"><div class="mh"><h2>${esc(title)}</h2><button type="button" class="ghost" data-x>✕</button></div>
    <div class="mb">${body}</div>
    <div class="mf">${footer ?? `<button type="button" data-x>Отмена</button>${onSubmit ? `<button class="primary" type="submit">${esc(submit)}</button>` : ''}`}</div></form>`;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  $$('[data-x]', ov).forEach((b) => b.addEventListener('click', close));
  const form = $('form', ov);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const btn = $('button[type=submit]', form); if (btn) btn.disabled = true;
    try { const r = await onSubmit(formData(form), form); if (r !== false) close(); }
    catch (err) { toast(err.message, true); }
    finally { if (btn) btn.disabled = false; }
  });
  document.body.append(ov);
  const first = $('input:not([type=hidden]),select,textarea', form);
  if (first) setTimeout(() => first.focus(), 30);
  if (onOpen) onOpen(form, close);
  return { el: ov, form, close };
}
function confirmBox(text, okText = 'Да') {
  return new Promise((res) => {
    const m = modal('Подтверждение', `<p>${esc(text)}</p>`, { footer: `<button type="button" data-x>Отмена</button><button type="button" class="primary" data-ok>${esc(okText)}</button>` });
    $('[data-ok]', m.el).onclick = () => { m.close(); res(true); };
    $$('[data-x]', m.el).forEach((b) => b.addEventListener('click', () => res(false)));
  });
}

// Автодополнение
function autocomplete(input, { search, render, onPick, minLen = 1 }) {
  const wrap = input.parentElement; wrap.classList.add('ac');
  const drop = document.createElement('div'); drop.className = 'drop hidden'; wrap.append(drop);
  let items = [], sel = -1;
  const show = (list) => {
    items = list; sel = -1;
    drop.innerHTML = list.map((x, i) => `<div class="opt" data-i="${i}">${render(x)}</div>`).join('');
    drop.classList.toggle('hidden', !list.length);
  };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < minLen) return show([]);
    try { show(await search(q)); } catch {}
  }, 200);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (minLen === 0) run(); });
  input.addEventListener('keydown', (e) => {
    if (drop.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); e.preventDefault(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); pick(sel); return; }
    else if (e.key === 'Escape') { drop.classList.add('hidden'); e.stopPropagation(); return; }
    $$('.opt', drop).forEach((o, i) => o.classList.toggle('sel', i === sel));
  });
  const pick = (i) => { drop.classList.add('hidden'); onPick(items[i]); };
  drop.addEventListener('mousedown', (e) => { const o = e.target.closest('.opt'); if (o) { e.preventDefault(); pick(+o.dataset.i); } });
  input.addEventListener('blur', () => setTimeout(() => drop.classList.add('hidden'), 150));
}

// ================= Иконки =================
const I = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const ICONS = {
  home: I('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  cal: I('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  orders: I('<path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><path d="M8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2"/><path d="M9 12h6M9 16h4"/>'),
  clients: I('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.8 2.6 3 5.2"/>'),
  leads: I('<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>'),
  stock: I('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>'),
  services: I('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>'),
  money: I('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>'),
  salary: I('<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1 1.7 3 2 3 1 3 2.1-1.3 2-3 2c-1.4 0-2.6-.6-3-1.6M12 6.5V8M12 16v1.5"/>'),
  users: I('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  partners: I('<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01"/>'),
  shield: I('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  chat: I('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>'),
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
};

// ================= Каркас =================
// нижняя панель вкладок на телефоне: 4 главных раздела + «Ещё»
const tabItems = (allowed) => ['/', '/calendar', '/orders', isOffice() ? '/finance' : '/salary'].map((p) => allowed.find((n) => n[0] === p)).filter(Boolean)
  .map(([p, t, ic]) => [p, { '/orders': 'Заказы' }[p] || t, ic]);
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
if (isStandalone()) document.documentElement.classList.add('pwa');
const NAV = [
  ['/', 'Главная', 'home', 'all'],
  ['/calendar', 'Календарь', 'cal', 'all'],
  ['/orders', 'Заказ-наряды', 'orders', 'all'],
  ['/clients', 'Клиенты', 'clients', 'office'],
  ['/leads', 'Заявки', 'leads', 'office'],
  ['/messages', 'Сообщения', 'chat', 'office'],
  ['/stock', 'Склад', 'stock', 'office'],
  ['/services', 'Услуги и цены', 'services', 'office'],
  ['/contractors', 'Контрагенты', 'partners', 'office'],
  ['/warranty', 'Гарантия', 'shield', 'office'],
  ['/finance', 'Финансы', 'money', 'office'],
  ['/salary', 'Зарплата', 'salary', 'all'],
  ['/users', 'Сотрудники', 'users', 'admin'],
  ['/settings', 'Настройки', 'settings', 'admin'],
];

function renderShell() {
  const u = S.me.user;
  const allowed = NAV.filter((n) => n[3] === 'all' || (n[3] === 'office' && isOffice()) || (n[3] === 'admin' && isAdmin()));
  $('#root').innerHTML = `<div class="mobilebar"><button class="ghost" id="burger">${ICONS.menu}</button><b>${esc(S.me.company)}</b></div>
  <div class="app"><aside class="side" id="side">
    <div class="logo"><img class="mark" src="/emblem.svg" alt=""><div><b>${esc(S.me.company)}</b><span>CRM автозвук и тюнинг</span></div></div>
    <nav class="nav">${allowed.map(([p, t, ic]) => `<a href="#${p}" data-p="${p}" title="${t}">${ICONS[ic]}<span>${t}</span>${p === '/leads' ? '<span class="badge red hidden" id="leadsBadge"></span>' : p === '/messages' ? '<span class="badge red hidden" id="msgBadge"></span>' : p === '/warranty' ? '<span class="badge red hidden" id="wBadge" title="Гарантия: 30+ дней"></span>' : ''}</a>`).join('')}</nav>
    <div class="foot"><div class="who">${esc(u.name)}</div><div class="role">${ROLES[myRole()]}</div>
      <div class="inline"><button class="sm" id="myPass">Пароль</button><button class="sm" id="logout">Выйти</button></div>
      ${S.me.max_on ? `<button class="sm" id="myMax" style="margin-top:6px;width:100%;justify-content:center">${S.me.my_max ? '✓ MAX подключён' : '📲 Подключить мой MAX'}</button>` : ''}</div>
  </aside><div class="scrim" id="scrim"></div><main class="main" id="page"></main></div>
  <nav class="tabbar" id="tabbar">${tabItems(allowed).map(([p, t, ic]) => `<a href="#${p}" data-p="${p}">${ICONS[ic]}<span>${t}</span></a>`).join('')}<a href="#" id="tabMore">${ICONS.menu}<span>Ещё</span></a></nav>`;
  $('#logout').onclick = async () => { await POST('/api/logout'); S.me = null; renderLogin(); };
  $('#myPass').onclick = changeMyPassword;
  const mm = $('#myMax'); if (mm) mm.onclick = async () => { try { maxLinkModal(await POST('/api/me/max-link'), S.me.user.name); } catch (e) { toast(e.message, true); } };
  const sideOpen = (on) => { $('#side').classList.toggle('open', on); $('#scrim').classList.toggle('on', on); document.body.style.overflow = on ? 'hidden' : ''; };
  $('#burger').onclick = () => sideOpen(!$('#side').classList.contains('open'));
  $('#scrim').onclick = () => sideOpen(false);
  $('#tabMore').onclick = (e) => { e.preventDefault(); sideOpen(!$('#side').classList.contains('open')); };
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) sideOpen(false); });
}

function setActiveNav(path) {
  let title = '';
  $$('.nav a, .tabbar a[data-p]').forEach((a) => {
    const p = a.dataset.p; const on = p === '/' ? path === '/' : path.startsWith(p);
    a.classList.toggle('active', on); if (on && !title) title = a.title || a.textContent.trim();
  });
  const mb = $('.mobilebar b'); if (mb) mb.textContent = title && path !== '/' ? title : S.me.company;
  const more = $('#tabMore'); if (more) more.classList.toggle('active', !$$('.tabbar a[data-p]').some((a) => a.classList.contains('active')));
}

async function refreshLeadsBadge() {
  if (!isOffice()) return;
  try {
    const d = await GET('/api/leads?status=new');
    const b = $('#leadsBadge'); if (!b) return;
    b.textContent = d.length; b.classList.toggle('hidden', !d.length);
    const m = await GET('/api/messages/unread'); const mb = $('#msgBadge');
    if (mb) { mb.textContent = m.n; mb.classList.toggle('hidden', !m.n); }
    const w = await GET('/api/warranty/summary'); const wb = $('#wBadge');
    if (wb) { wb.textContent = w.over30; wb.classList.toggle('hidden', !w.over30); }
  } catch {}
}

// Окно подключения MAX: ссылка на бота с кодом или код вручную
function maxLinkModal(r, name) {
  modal('Подключить MAX', `
    <p>Сотрудник: <b>${esc(name)}</b></p>
    ${r.link ? `<p>1. Откройте ссылку на телефоне, где установлен MAX, и нажмите «Начать»:</p>
      <div class="inline" style="flex-wrap:nowrap;margin-bottom:12px"><input readonly value="${esc(r.link)}" id="mlink"><button type="button" class="sm" id="mcopy">Копировать</button></div>
      <p class="muted small">Или найдите в MAX бота <b>@${esc(r.bot)}</b> и отправьте ему код:</p>` : '<p>Найдите в MAX бота студии и отправьте ему код:</p>'}
    <div style="font-size:34px;font-weight:800;letter-spacing:6px;text-align:center;padding:10px;background:var(--bg);border-radius:10px">${esc(r.code)}</div>
    <p class="small muted" style="margin-top:10px">Код одноразовый. После подключения бот ответит «Готово», и уведомления начнут приходить в MAX.</p>`,
  { footer: '<button type="button" class="primary" data-x>Понятно</button>', onOpen: (f) => { const c = $('#mcopy', f); if (c) c.onclick = () => { navigator.clipboard?.writeText(r.link); toast('Ссылка скопирована'); }; } });
}

function changeMyPassword() {
  modal('Сменить пароль', `<div class="field"><label>Текущий пароль</label><input type="password" name="old" required></div>
    <div class="field"><label>Новый пароль (от 6 символов)</label><input type="password" name="new" minlength="6" required></div>`,
  { onSubmit: async (d) => { await POST('/api/me/password', d); toast('Пароль изменён'); } });
}

function renderLogin() {
  $('#root').innerHTML = `<div class="login"><form class="box card" id="lf">
    <div class="logo"><img class="mark" src="/emblem.svg" alt=""><div><b>Бумсистем</b><span>CRM автозвук и тюнинг</span></div></div>
    <div class="field"><label>Логин</label><input name="login" autocomplete="username" required></div>
    <div class="field"><label>Пароль</label><input name="password" type="password" autocomplete="current-password" required></div>
    <button class="primary" style="width:100%;justify-content:center;padding:10px">Войти</button>
    <div class="small" style="text-align:center;margin-top:12px"><a href="/">← На сайт</a></div></form></div>`;
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    try { await POST('/api/login', formData(e.target)); await boot(); }
    catch (err) { toast(err.message, true); }
  };
}

// ================= Роутер =================
const ROUTES = [];
const route = (re, fn) => ROUTES.push([re, fn]);
async function navigate() {
  if (!S.me) return;
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  setActiveNav(path);
  const page = $('#page');
  for (const [re, fn] of ROUTES) {
    const m = re.exec(path);
    if (m) {
      try { await fn(page, ...m.slice(1), query); }
      catch (e) { if (e.message !== 'Требуется вход') page.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  page.innerHTML = '<div class="card empty">Страница не найдена</div>';
}
const go = (p) => { location.hash = '#' + p; };
window.addEventListener('hashchange', navigate);

async function boot() {
  try { S.me = await GET('/api/me'); } catch { return renderLogin(); }
  S.staff = await GET('/api/staff');
  renderShell();
  refreshLeadsBadge();
  setInterval(refreshLeadsBadge, 60000);
  navigate();
}

let CACHE_CONTR = null;
async function contractorsList(force) { if (!CACHE_CONTR || force) CACHE_CONTR = await GET('/api/contractors'); return CACHE_CONTR; }
async function services() { if (!S.services) S.services = await GET('/api/services'); return S.services; }

// ================= Главная =================
function installHint() {
  let hide = false; try { hide = localStorage.getItem('pwaHint') === '1'; } catch {}
  if (hide || isStandalone() || !isIOS) return '';
  return `<div class="card pwahint" id="pwaHint"><button type="button" class="ghost sm" id="pwaX" style="float:right">✕</button>
    <b>📲 Установите CRM как приложение</b><div class="small muted" style="margin-top:4px">В Safari нажмите <b>«Поделиться»</b> <span class="shareic">⬆︎</span> внизу экрана → <b>«На экран „Домой“»</b> → «Добавить». CRM будет открываться со своим значком, на весь экран, без адресной строки.</div></div>`;
}
route(/^\/$/, async (page) => {
  const d = await GET('/api/dashboard');
  const d0 = nowTz();
  const stCounts = Object.fromEntries(d.by_status.map((x) => [x.status, x.n]));
  page.innerHTML = installHint() + `<div class="topbar"><div><h1>${d0.getHours() < 12 ? 'Доброе утро' : d0.getHours() < 18 ? 'Добрый день' : 'Добрый вечер'}, ${esc(S.me.user.name.split(' ')[0])}</h1>
    <div class="muted">${DOW[d0.getDay()]}, ${d0.getDate()} ${MONTHS[d0.getMonth()]}</div></div><div class="sp"></div>
    ${isOffice() ? '<button class="primary" id="newOrder">+ Новый заказ</button>' : ''}</div>
  ${d.money ? `<div class="grid g4" style="margin-bottom:14px">
    <div class="kpi"><div class="l">Касса сегодня</div><div class="v acc">${rub(d.money.today_in)}</div></div>
    <div class="kpi"><div class="l">Поступления за месяц</div><div class="v">${rub(d.money.month_in)}</div></div>
    <div class="kpi"><div class="l">Расходы за месяц</div><div class="v">${rub(d.money.month_out)}</div></div>
    <div class="kpi"><div class="l">Выдано авто за месяц</div><div class="v">${d.money.orders_month}</div></div></div>` : ''}
  <div class="grid g4" style="margin-bottom:14px">
    ${['scheduled', 'in_work', 'waiting', 'done'].map((s) => `<a class="kpi" href="#/orders?status=${s}" style="color:inherit;text-decoration:none"><div class="l">${S.me.statuses[s]}</div><div class="v">${stCounts[s] || 0}</div></a>`).join('')}
  </div>
  <div class="grid g-main"><div>
    <div class="card"><h2>На постах сегодня</h2>${d.today.length ? `<div class="list">${d.today.map((o) => `
      <div class="li click" data-o="${o.id}"><div class="time">${o.scheduled_at.slice(0, 10) === today() ? o.scheduled_at.slice(11, 16) : '<span class="small">с ' + dmy(o.scheduled_at).slice(0, 5) + '</span>'}</div><div class="grow"><div class="t">${esc(o.client)} <span class="muted small">${esc(o.phone || '')}</span></div>
      <div class="s">${esc(carStr(o))}${o.bay ? ' · ' + esc(o.bay) : ''}${o.master ? ' · ' + esc(o.master) : ''}</div></div>${stBadge(o.status)}</div>`).join('')}</div>` : '<div class="empty">На сегодня записей нет</div>'}</div>
    <div class="card"><h2>В работе</h2>${d.in_work.length ? `<div class="list">${d.in_work.map((o) => `
      <div class="li click" data-o="${o.id}"><div class="grow"><div class="t">${orderNo(o.id)} · ${esc(o.client)}</div><div class="s">${esc(carStr(o))}${o.master ? ' · ' + esc(o.master) : ''}</div></div>${stBadge(o.status)}</div>`).join('')}</div>` : '<div class="empty">Нет автомобилей в работе</div>'}</div>
  </div><div>
    ${d.new_leads ? `<a class="card" href="#/leads" style="display:block;border-color:var(--accent);color:inherit;text-decoration:none;margin-bottom:14px"><h2 style="margin:0">🔥 Новых заявок: ${d.new_leads}</h2><div class="muted small">Перезвоните, пока клиент тёплый</div></a>` : ''}
    ${d.warranty && d.warranty.length ? `<div class="card"><div class="inline" style="margin-bottom:8px"><h2 style="margin:0;flex:1">🛡 Гарантия</h2><a class="small" href="#/warranty">все →</a></div><div class="list">${d.warranty.slice(0, 8).map((w) => `<a class="li click" href="#/warranty/${w.id}" style="color:inherit;text-decoration:none"><div class="grow"><div class="t">${esc(w.product_name)}</div><div class="s">${esc(w.client || '')}${w.supplier ? ' · ' + esc(w.supplier) : ''}</div></div>${wDays(w)}</a>`).join('')}</div></div>` : ''}
    ${d.debts ? `<div class="card"><h2>Долги клиентов</h2>${d.debts.length ? `<div class="list">${d.debts.map((x) => `<div class="li click" data-o="${x.id}"><div class="grow"><div class="t">${esc(x.client)}</div><div class="s">${orderNo(x.id)}</div></div><b class="mono">${rub(x.total - x.paid)}</b></div>`).join('')}</div>` : '<div class="empty">Долгов нет</div>'}</div>` : ''}
    ${d.low_stock ? `<div class="card"><h2>Заканчивается на складе</h2>${d.low_stock.length ? `<div class="list">${d.low_stock.map((p) => `<div class="li"><div class="grow t">${esc(p.name)}</div><span class="badge warn">${num(p.stock)} ${esc(p.unit)}</span></div>`).join('')}</div>` : '<div class="empty">Всё в наличии</div>'}</div>` : ''}
  </div></div>`;
  const px = $('#pwaX', page); if (px) px.onclick = () => { try { localStorage.setItem('pwaHint', '1'); } catch {} $('#pwaHint', page).remove(); };
  page.addEventListener('click', (e) => { const li = e.target.closest('[data-o]'); if (li) go('/orders/' + li.dataset.o); });
  const nb = $('#newOrder', page); if (nb) nb.onclick = () => newOrderModal();
});

// ================= Новый заказ =================
async function newOrderModal(pre = {}) {
  const bays = S.me.bays;
  const est = !!pre.estimate;
  const m = modal(est ? 'Предварительный расчёт' : 'Новый заказ-наряд', `${est ? '<div class="small muted" style="margin-bottom:10px">Расчёт не попадает в журнал записи и не списывает склад. Когда клиент согласится — переведёте его в заказ-наряд одной кнопкой.</div>' : ''}
    <input type="hidden" name="client_id" value="${esc(pre.client_id || '')}">
    <input type="hidden" name="lead_id" value="${esc(pre.lead_id || '')}">
    <div class="field" id="clientPick"><label>Клиент — поиск по имени, телефону, госномеру</label>
      <div><input id="clientQ" placeholder="Начните вводить…" value="${esc(pre.client_name || '')}"></div>
      <div class="small muted" style="margin-top:4px">или <a href="#" id="toNew">новый клиент</a></div></div>
    <div id="newClient" class="hidden"><div class="row">
      <div class="field"><label>Имя клиента *</label><input name="nc_name" value="${esc(pre.name || '')}"></div>
      <div class="field"><label>Телефон</label><input name="nc_phone" value="${esc(pre.phone || '')}" placeholder="+7…"></div>
      <div class="field"><label>Откуда узнал</label><select name="nc_source">${opts(SOURCES, pre.source, '—')}</select></div></div>
      <div class="small"><a href="#" id="toSearch">← найти существующего</a></div></div>
    <div class="field" id="carRow"><label>Автомобиль</label><select name="car_id" id="carSel"><option value="">— новый автомобиль —</option></select></div>
    <div class="row" id="newCar"><div class="field"><label>Марка</label><input name="car_brand" value="${esc(pre.car_brand || '')}"></div>
      <div class="field"><label>Модель</label><input name="car_model" value="${esc(pre.car_model || '')}"></div>
      <div class="field"><label>Госномер</label><input name="car_plate"></div><div class="field"><label>Год</label><input name="car_year" type="number" min="1950" max="2100"></div></div>
    <div class="row">
      <div class="field"><label>Дата и время записи</label><input type="datetime-local" name="scheduled_at" value="${esc(pre.scheduled_at || '')}" step="900"></div>
      <div class="field"><label>Стоит на посту до (включительно)</label><input type="date" name="end_date" value="${esc(pre.end_date || '')}"></div>
      <div class="field"><label>Длительность, ч</label><input type="number" name="duration_h" value="${pre.duration_h || 2}" step="0.5" min="0.5"></div>
      <div class="field"><label>Пост</label><select name="bay">${opts(bays, pre.bay, '—')}</select></div>
      <div class="field"><label>Мастер</label><select name="master_id">${masterOpts(pre.master_id)}</select></div></div>
    <div class="field"><label>Что хочет клиент</label><textarea name="complaint" placeholder="Например: замена штатной акустики, шумоизоляция дверей, сабвуфер в багажник">${esc(pre.complaint || '')}</textarea></div>`,
  { wide: true, submit: est ? 'Создать расчёт' : 'Создать заказ', onSubmit: async (d) => {
    if (!est && d.scheduled_at && isDayOff(d.scheduled_at) && !(await confirmBox(`${dmy(d.scheduled_at)} — выходной день. Записать в виде исключения?`, 'Да, записать'))) return false;
    const body = { client_id: d.client_id || null, lead_id: d.lead_id || null, car_id: d.car_id || null, scheduled_at: d.scheduled_at || null, end_date: d.end_date || null,
      duration_min: Math.round((+d.duration_h || 2) * 60), bay: d.bay, master_id: d.master_id, complaint: d.complaint, estimate: est };
    if (!body.client_id) {
      if (!d.nc_name) { toast('Выберите клиента или заполните нового', true); return false; }
      body.new_client = { name: d.nc_name, phone: d.nc_phone, source: d.nc_source };
    }
    if (!body.car_id) body.new_car = { brand: d.car_brand, model: d.car_model, plate: d.car_plate, year: d.car_year };
    const r = await POST('/api/orders', body);
    toast((est ? 'Расчёт ' : 'Заказ ') + orderNo(r.id) + ' создан');
    go('/orders/' + r.id);
  } });
  const f = m.form;
  if (est) f.scheduled_at.closest('.row').classList.add('hidden'); // в расчёте запись не нужна
  const remark = () => markMasters(f, f.scheduled_at.value, f.end_date.value);
  f.scheduled_at.addEventListener('change', remark); f.end_date.addEventListener('change', remark); remark();
  const setNew = (on) => { $('#newClient', f).classList.toggle('hidden', !on); $('#clientPick', f).classList.toggle('hidden', on); if (on) { f.client_id.value = ''; loadCars(null); } };
  $('#toNew', f).onclick = (e) => { e.preventDefault(); setNew(true); f.nc_name.focus(); };
  $('#toSearch', f).onclick = (e) => { e.preventDefault(); setNew(false); };
  const sel = $('#carSel', f);
  const toggleCar = () => $('#newCar', f).classList.toggle('hidden', !!sel.value);
  sel.onchange = toggleCar;
  async function loadCars(clientId, carId) {
    sel.innerHTML = '<option value="">— новый автомобиль —</option>';
    if (clientId) {
      const c = await GET('/api/clients/' + clientId);
      sel.innerHTML += c.cars.map((x) => `<option value="${x.id}">${esc(carStr(x))}</option>`).join('');
      if (carId) sel.value = carId; else if (c.cars.length) sel.value = c.cars[c.cars.length - 1].id;
    }
    toggleCar();
  }
  autocomplete($('#clientQ', f), {
    search: async (q) => (await GET('/api/clients' + qs({ q, limit: 10 }))).rows,
    render: (c) => `<div>${esc(c.name)} <span class="s">${esc(c.phone || '')}</span></div><div class="s">${esc(c.cars || 'нет авто')}</div>`,
    onPick: (c) => { f.client_id.value = c.id; $('#clientQ', f).value = c.name + (c.phone ? ' · ' + c.phone : ''); loadCars(c.id); },
  });
  if (pre.client_id) loadCars(pre.client_id, pre.car_id);
  else if (pre.name || pre.phone) setNew(true);
}

// ================= Заказ-наряды =================
route(/^\/orders$/, async (page, query) => {
  const st = query.status || 'active';
  page.innerHTML = `<div class="topbar"><h1>Заказ-наряды</h1><div class="sp"></div>
    <input class="search" id="q" placeholder="Поиск: №, клиент, телефон, госномер" value="${esc(query.q || '')}">
    ${isOffice() ? '<button id="newEst">+ Расчёт</button><button class="primary" id="newOrder">+ Новый заказ</button>' : ''}</div>
    <div class="chips" style="margin-bottom:12px">${[['active', 'Активные'], ...(isOffice() ? [['estimate', 'Расчёты']] : []), ...Object.entries(S.me.statuses).filter(([k]) => k !== 'estimate'), ['', 'Все']].map(([k, t]) => `<button class="chip ${k === st ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</div>
    <div class="card" style="padding:4px 6px"><div class="tblwrap" id="list"></div></div>`;
  let cur = st;
  const load = async () => {
    const rows = await GET('/api/orders' + qs({ status: cur, q: $('#q', page).value }));
    $('#list', page).innerHTML = rows.length ? `<table class="tbl resp"><thead><tr><th>№</th><th>Статус</th><th>Клиент</th><th>Автомобиль</th><th>Запись</th><th>Мастер</th>${isOffice() ? '<th class="r">Сумма</th><th class="r">Оплачено</th>' : ''}</tr></thead><tbody>
      ${rows.map((o) => `<tr class="click" data-id="${o.id}"><td data-l="№"><b>${orderNo(o.id)}</b></td><td data-l="Статус">${stBadge(o.status)}</td>
      <td data-l="Клиент">${esc(o.client || '—')}<div class="small muted">${esc(o.phone || '')}</div></td><td data-l="Авто">${esc(carStr(o))}</td>
      <td data-l="Запись" class="nowrap">${dt(o.scheduled_at) || '<span class="muted">—</span>'}</td><td data-l="Мастер">${esc(o.master || '—')}</td>
      ${isOffice() ? `<td data-l="Сумма" class="r mono">${rub(o.total)}</td><td data-l="Оплачено" class="r mono ${o.paid + 0.5 < o.total && ['done', 'issued'].includes(o.status) ? '' : 'muted'}" style="${o.paid + 0.5 < o.total && ['done', 'issued'].includes(o.status) ? 'color:var(--bad)' : ''}">${rub(o.paid)}</td>` : ''}</tr>`).join('')}
      </tbody></table>` : '<div class="empty">Заказов не найдено</div>';
  };
  $$('.chip', page).forEach((b) => (b.onclick = () => { cur = b.dataset.st; $$('.chip', page).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  $('#q', page).oninput = debounce(load, 300);
  $('#list', page).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) go('/orders/' + tr.dataset.id); };
  const nb = $('#newOrder', page); if (nb) nb.onclick = () => newOrderModal();
  const ne = $('#newEst', page); if (ne) ne.onclick = () => newOrderModal({ estimate: true });
  await load();
});

// ---------- Товар в заказ: со склада или от поставщика ----------
function productAddModal(o, p, suppliers, reload, est = false) {
  const m = modal('Товар в заказ', `
    <div style="margin-bottom:10px"><b>${esc(p.name)}</b><div class="small muted">На складе: <b id="stk">${num(p.stock)} ${esc(p.unit)}</b> · розница ${rub(p.price)}${p.cost ? ' · закупка ' + rub(p.cost) : ''}</div></div>
    <div class="row"><div class="field"><label>Количество</label><input type="number" name="qty" value="1" min="0.01" step="any" required></div>
    <div class="field"><label>Цена для клиента, ₽</label><input type="number" name="price" value="${p.price}" step="any"></div></div>
    <div class="row" ${est ? 'style="display:none"' : ''}><div class="field"><label>Поставщик (у кого взят / будет взят)</label><select name="contractor_id">${opts(suppliers.map((c) => [c.id, c.name]), '', '— со склада —')}</select></div>
    <div class="field"><label>Закупочная цена, ₽</label><input type="number" name="cost" value="${p.cost || ''}" step="any"></div></div>
    <div class="small" id="hint"></div>`,
  { submit: 'Добавить', onSubmit: async (d) => {
    const qty = +d.qty || 1;
    if (!est && !d.contractor_id && qty > p.stock && !(await confirmBox(`На складе ${num(p.stock)}, а нужно ${num(qty)}. Добавить без поставщика? Остаток уйдёт в минус.`, 'Добавить'))) return false;
    if (d.contractor_id && qty > Math.max(p.stock, 0) && !(+d.cost > 0)) { toast('Укажите закупочную цену — по ней посчитается долг поставщику', true); return false; }
    await POST(`/api/orders/${o.id}/items`, { kind: 'product', ref_id: p.id, qty, price: d.price, cost: d.cost, contractor_id: d.contractor_id || null });
    reload();
  } });
  const f = m.form;
  const hint = () => {
    if (est) { $('#hint', f).innerHTML = '<span class="muted">В расчёте склад не резервируется — поставщика укажете после перевода в заказ-наряд.</span>'; return; }
    const qty = +f.qty.value || 0; const miss = Math.max(0, qty - Math.max(p.stock, 0));
    const sup = f.contractor_id.selectedOptions[0];
    $('#hint', f).innerHTML = !miss ? (f.contractor_id.value ? `<span class="muted">Товар есть на складе — долг не возникнет, поставщик будет указан в заказе.</span>` : '')
      : f.contractor_id.value ? `<span style="color:var(--warn)">Не хватает ${num(miss)} — они будут оприходованы от «${esc(sup.textContent)}», и появится долг ${rub(miss * (+f.cost.value || 0))}.</span>`
      : `<span style="color:var(--bad)">На складе не хватает ${num(miss)}. Выберите поставщика, чтобы учесть долг перед ним.</span>`;
  };
  ['input', 'change'].forEach((ev) => f.addEventListener(ev, hint)); hint();
}

// Товар не из каталога (вписывается вручную)
function customProductModal(o, name, reload) {
  modal('Свой товар', `
    <div class="field"><label>Наименование</label><input name="name" value="${esc(name)}" required></div>
    <div class="row"><div class="field"><label>Количество</label><input type="number" name="qty" value="1" min="0.01" step="any" required></div>
    <div class="field"><label>Цена для клиента, ₽</label><input type="number" name="price" step="any" required></div>
    <div class="field"><label>Закупка, ₽ (необязательно)</label><input type="number" name="cost" step="any"></div></div>
    <div class="small muted">Товар не будет списываться со склада — его нет в каталоге.</div>`,
  { submit: 'Добавить', onSubmit: async (d) => { await POST(`/api/orders/${o.id}/items`, { kind: 'product', name: d.name, qty: d.qty, price: d.price, cost: d.cost, warranty_months: 0 }); reload(); } });
}

// ---------- Приёмка автомобиля ----------
function acceptCard(o, office) {
  const dis = office ? '' : 'disabled';
  return `<form class="card" id="acc"><div class="inline" style="margin-bottom:6px"><h2 style="margin:0;flex:1">Приёмка автомобиля</h2>
    ${o.accept_at ? `<span class="badge ok">принят ${dt(o.accept_at)}</span>` : '<span class="badge warn">не оформлена</span>'}</div>
    <div class="row"><div class="field"><label>Дата и время приёмки</label><input type="datetime-local" name="accept_at" value="${esc(o.accept_at || '')}" ${dis}></div>
    <div class="field"><label>Пробег, км</label><input type="number" name="mileage" value="${esc(o.mileage || '')}" ${dis}></div></div>
    <div class="field" style="margin-top:8px"><label>Повреждения, сколы, царапины</label><textarea name="accept_damage" rows="2" ${dis} placeholder="Напр.: скол на капоте, царапина на заднем бампере справа">${esc(o.accept_damage || '')}</textarea></div>
    <div class="field"><label>Личные вещи в салоне</label><input name="accept_items" value="${esc(o.accept_items || '')}" ${dis} placeholder="Детское кресло, зарядка…"></div>
    <div class="field"><label>Фото автомобиля${o.photos.length ? ` (${o.photos.length})` : ''}</label>
      <div class="photos">${o.photos.map((p) => `<button type="button" class="ph" data-ph="${p.id}" title="${esc(dt(p.created_at) + (p.user ? ' · ' + p.user : ''))}"><img loading="lazy" src="/api/photos/${p.id}" alt=""></button>`).join('')}
      <label class="ph add"><span>📷</span><small>Добавить фото</small><input type="file" accept="image/*" multiple hidden id="phIn"></label></div>
      ${office && o.photos.length && S.me.max_on ? '<button type="button" class="sm" id="phMax" style="margin-top:8px">✉ Отправить фото в MAX</button>' : ''}</div>
    ${office ? `<div class="inline"><button class="primary sm">${o.accept_at ? 'Сохранить' : 'Принять в работу'}</button><a class="btn sm" target="_blank" href="/print/order/${o.id}/accept">🖨 Печать акта</a></div>` : ''}
  </form>`;
}
// Сжатие фото на телефоне перед загрузкой: длинная сторона до 1600 px, JPEG
async function shrinkImage(file, maxSide = 1600, q = 0.82) {
  let img = null;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  if (!img) img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('Этот формат фото не поддерживается браузером')); i.src = URL.createObjectURL(file); });
  const w = img.width, h = img.height, k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
function bindPhotos(page, o, reload, office) {
  const inp = $('#phIn', page);
  if (inp) inp.onchange = async () => {
    const files = [...inp.files]; if (!files.length) return;
    let ok = 0;
    for (const [n, f] of files.entries()) {
      toast(`Загрузка фото ${n + 1} из ${files.length}…`);
      try { await POST(`/api/orders/${o.id}/photos`, { data: await shrinkImage(f), kind: 'accept' }); ok++; } catch (e) { toast(`${f.name}: ${e.message}`, true); }
    }
    if (ok) { toast(`Загружено фото: ${ok}`); reload(); }
  };
  $$('[data-ph]', page).forEach((b) => (b.onclick = () => {
    const ids = o.photos.map((p) => p.id); let cur = ids.indexOf(+b.dataset.ph);
    const m = modal(`Фото ${cur + 1} из ${ids.length}`, `<div class="phview"><img id="phBig" src="/api/photos/${ids[cur]}" alt="">${ids.length > 1 ? '<button type="button" class="phnav l" data-nav="-1">‹</button><button type="button" class="phnav r" data-nav="1">›</button>' : ''}</div>`,
      { wide: true, footer: `${office ? '<button type="button" class="ghost danger" data-del style="margin-right:auto">Удалить</button>' : ''}<a class="btn" id="phDl" href="/api/photos/${ids[cur]}?dl=1">⬇ Скачать</a><button type="button" data-x>Закрыть</button>` });
    const show = () => { $('#phBig', m.el).src = '/api/photos/' + ids[cur]; $('#phDl', m.el).href = `/api/photos/${ids[cur]}?dl=1`; $('.mh h2', m.el).textContent = `Фото ${cur + 1} из ${ids.length}`; };
    $$('[data-nav]', m.el).forEach((x) => (x.onclick = () => { cur = (cur + +x.dataset.nav + ids.length) % ids.length; show(); }));
    const d = $('[data-del]', m.el); if (d) d.onclick = async () => { if (!(await confirmBox('Удалить это фото?', 'Удалить'))) return; await DEL('/api/photos/' + ids[cur]); m.close(); toast('Фото удалено'); reload(); };
  }));
  const mx = $('#phMax', page);
  if (mx) mx.onclick = () => {
    const ppl = S.staff.filter((u) => u.max);
    modal(`Фото в MAX · ${o.number}`, `
      <div class="small muted" style="margin-bottom:8px">Сообщение уйдёт с пометкой: заказ ${esc(o.number)}, ${esc([o.brand, o.model, o.plate].filter(Boolean).join(' '))}${o.accept_damage ? ', повреждения из приёмки' : ''}.</div>
      <label>Фото</label><div class="photos pick">${o.photos.map((p) => `<label class="ph"><input type="checkbox" name="ph" value="${p.id}" checked><img src="/api/photos/${p.id}" alt=""></label>`).join('')}</div>
      <label style="margin-top:10px;display:block">Кому</label><div class="checkgrid">
        ${S.me.max_group ? '<label class="ck"><input type="checkbox" name="group" checked> 👥 Общий чат студии</label>' : ''}
        ${ppl.map((u) => `<label class="ck"><input type="checkbox" name="u" value="${u.id}" ${!S.me.max_group && u.id === o.master_id ? 'checked' : ''}> ${esc(u.name)}${u.id === o.master_id ? ' <span class="muted small">(мастер заказа)</span>' : ''}</label>`).join('')}
        ${!ppl.length && !S.me.max_group ? '<div class="muted small">Никто из сотрудников ещё не подключил MAX (Сотрудники → карточка → «Подключить MAX»).</div>' : ''}</div>
      <div class="field" style="margin-top:10px"><label>Комментарий</label><input name="note" placeholder="например: обратите внимание на скол на капоте"></div>`,
    { submit: 'Отправить', onSubmit: async (d, f) => {
      const ids = $$('input[name=ph]:checked', f).map((x) => +x.value), users = $$('input[name=u]:checked', f).map((x) => +x.value), group = !!$('input[name=group]:checked', f);
      if (!ids.length) { toast('Отметьте фото', true); return false; }
      if (!users.length && !group) { toast('Выберите, кому отправить', true); return false; }
      toast('Отправляю в MAX…');
      const r = await POST(`/api/orders/${o.id}/photos/send`, { ids, users, group, note: d.note });
      toast(r.errors.length ? `Отправлено: ${r.sent}. Ошибки: ${r.errors.join('; ')}` : `Фото отправлены (${r.sent})`, !!r.errors.length); reload();
    } });
  };
}
function bindAccept(page, o, reload, office = isOffice()) {
  const f = $('#acc', page); if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      accept_at: f.accept_at.value || null, mileage: f.mileage.value,
      accept_damage: f.accept_damage.value, accept_items: f.accept_items.value,
    };
    try {
      await PUT(`/api/orders/${o.id}/accept`, body);
      if (!o.accept_at && ['new', 'scheduled'].includes(o.status)) await POST(`/api/orders/${o.id}/status`, { status: 'in_work' });
      toast(o.accept_at ? 'Приёмка сохранена' : 'Автомобиль принят в работу');
      if (!o.accept_at) window.open(`/print/order/${o.id}/accept`, '_blank');
      reload();
    } catch (err) { toast(err.message, true); }
  };
}

route(/^\/orders\/(\d+)$/, async (page, id) => {
  const o = await GET('/api/orders/' + id);
  const office = isOffice();
  const contrs = office ? await contractorsList() : [];
  const statusButtons = (role() === 'master' ? ['in_work', 'waiting', 'done'] : Object.keys(S.me.statuses).filter((k) => k !== 'estimate'));
  const isEst = o.status === 'estimate';
  const t = o.totals;
  const svc = o.items.filter((i) => i.kind === 'service'); const prd = o.items.filter((i) => i.kind === 'product');
  const itemRows = (list, kind) => list.map((i) => `<tr data-item="${i.id}">
    <td data-l="Позиция" style="min-width:240px">${office ? `<input value="${esc(i.name)}" data-f="name" title="${esc(i.name)}">` : esc(i.name)}${i.contractor_name ? `<div class="small muted">🚚 ${esc(i.contractor_name)}${i.supplied_qty ? ` · в долг ${num(i.supplied_qty)} шт` : ''}</div>` : ''}</td>
    ${kind === 'service' ? `<td data-l="Мастер">${office ? `<select data-f="master_id">${masterOpts(i.master_id)}</select>` : esc(i.master_name || '—')}</td>` : ''}
    <td data-l="Кол-во" style="width:90px">${office ? `<input type="number" step="any" min="0" value="${i.qty}" data-f="qty">` : i.qty}</td>
    <td data-l="Цена" style="width:120px">${office ? `<input type="number" step="any" min="0" value="${i.price}" data-f="price">` : num(i.price)}</td>
    <td data-l="Сумма" class="r mono" style="width:110px">${num(i.qty * i.price)}</td>
    <td data-l="Гарантия" style="width:80px">${office ? `<input type="number" min="0" value="${i.warranty_months}" data-f="warranty_months" title="Гарантия, мес.">` : (i.warranty_months || '—')}</td>
    ${office ? `<td style="width:40px"><button type="button" class="ghost sm danger" data-del="${i.id}" title="Удалить">✕</button></td>` : ''}</tr>`).join('');
  const issuedLocked = o.status === 'issued';

  page.innerHTML = `<div class="topbar"><button class="ghost" onclick="history.back()">←</button><h1>${isEst ? 'Расчёт' : 'Заказ'} ${o.number}</h1>${stBadge(o.status)}<div class="sp"></div>
    ${office && isEst ? `<div class="inline"><a class="btn sm" target="_blank" href="/print/order/${o.id}/estimate">🖨 Бланк расчёта</a></div>` : ''}
    ${office && !isEst ? `<div class="inline"><a class="btn sm" target="_blank" href="/print/order/${o.id}/accept">🖨 Акт приёма</a><a class="btn sm" target="_blank" href="/print/order/${o.id}/naryad">🖨 Заказ-наряд</a><a class="btn sm" target="_blank" href="/print/order/${o.id}/act">🖨 Акт работ</a><a class="btn sm" target="_blank" href="/print/order/${o.id}/warranty">🖨 Гарантия</a><button class="sm" id="toWarranty">🛡 Принять на гарантию</button></div>` : ''}</div>
  ${isEst ? `<div class="card estcard" style="margin-bottom:14px"><div class="inline" style="flex-wrap:wrap;gap:12px"><div style="flex:1;min-width:240px"><h2 style="margin:0 0 4px">Предварительный расчёт</h2>
    <div class="small muted">Цены актуальны на дату обращения — <b>${dmy(o.estimate_at || o.created_at)}</b>. Пока это расчёт: в журнал не попадает, склад не списывается, долги поставщикам не создаются.</div></div>
    ${office ? `<button type="button" class="ghost sm danger" id="estCancel">Клиент отказался</button><button type="button" class="primary" id="estConvert">✅ Клиент согласен — в заказ-наряд</button>` : ''}</div></div>` : ''}
  <div class="card" style="margin-bottom:14px${isEst ? ';display:none' : ''}"><h3>Статус</h3><div class="pipe">${statusButtons.map((s) => `<button type="button" data-st="${s}" class="${s === o.status ? 'cur' : ''}">${S.me.statuses[s]}</button>`).join('')}</div>
    ${o.status === 'done' && office && t.due > 0.5 ? `<div class="small" style="margin-top:8px;color:var(--warn)">Перед выдачей примите оплату: к оплате ${rub(t.due)}</div>` : ''}</div>
  <div class="grid g-main"><div>
    <div class="card"><h2>Работы</h2><div class="tblwrap"><table class="tbl resp"><thead><tr><th>Услуга</th><th>Мастер</th><th>Кол-во</th><th>Цена</th><th class="r">Сумма</th><th title="Гарантия, мес.">Гар., мес</th>${office ? '<th></th>' : ''}</tr></thead>
      <tbody>${itemRows(svc, 'service') || `<tr><td colspan="7" class="muted">Работ пока нет</td></tr>`}</tbody></table></div>
      ${office ? `<div style="margin-top:10px"><div><input id="addSvc" placeholder="+ Добавить работу: начните вводить название из прайса или своё"></div></div>` : ''}</div>
    <div class="card"><h2>Товары и материалы</h2><div class="tblwrap"><table class="tbl resp"><thead><tr><th>Товар</th><th>Кол-во</th><th>Цена</th><th class="r">Сумма</th><th title="Гарантия, мес.">Гар., мес</th>${office ? '<th></th>' : ''}</tr></thead>
      <tbody>${itemRows(prd, 'product') || `<tr><td colspan="6" class="muted">Товаров нет</td></tr>`}</tbody></table></div>
      ${office ? `<div style="margin-top:10px"><div><input id="addPrd" placeholder="+ Добавить товар со склада: название, артикул, бренд"></div></div>` : ''}
      ${issuedLocked && prd.length ? '<div class="small muted" style="margin-top:6px">Товары списаны со склада при выдаче</div>' : ''}</div>
    ${office ? `<div class="card"><div class="totals">
      <div><span class="muted">Работы</span><span class="mono">${rub(t.services)}</span></div>
      <div><span class="muted">Товары</span><span class="mono">${rub(t.goods)}</span></div>
      <div><span class="muted">Скидка</span><span class="inline"><input type="number" id="disc" value="${o.discount_percent || 0}" min="0" max="100" step="any" style="width:70px;padding:3px 6px"> %  <span class="mono">−${rub(t.discount)}</span></span></div>
      <div class="big"><span>Итого</span><span class="mono">${rub(t.total)}</span></div>
      ${o.cashless_markup ? `<div class="small"><span class="muted">Безнал (+${o.cashless_markup}%)</span><span class="mono muted">${rub(t.total * (1 + o.cashless_markup / 100))}</span></div>` : ''}
      ${isEst ? '' : `<div><span class="muted">Оплачено</span><span class="mono">${rub(t.paid)}</span></div>`}
      <div style="font-weight:700;color:${t.due > 0.5 ? 'var(--warn)' : 'var(--ok)'};${isEst ? 'display:none' : ''}"><span>${t.due < -0.5 ? 'Переплата' : 'К оплате'}</span><span class="mono">${rub(Math.abs(t.due))}</span></div>
      <div style="margin-top:10px;gap:8px;justify-content:flex-end;${isEst ? 'display:none' : ''}"><button type="button" class="sm" id="refund">Возврат</button><button type="button" class="primary" id="pay">Принять оплату</button></div>
    </div>
    ${(o.saby || []).length ? `<div class="saby-box">${o.saby.map((x) => `<div class="saby-row ${x.status}">
      <div><b>${x.status === 'pending' ? '⏳ Ждёт оплаты на кассе Saby' : x.status === 'paid' ? '✅ Оплачено на кассе Saby' : '✖ Отменено на кассе'}</b> · <span class="mono">${rub(x.status === 'paid' ? x.paid : x.amount)}</span>
      <div class="small muted">отправлено ${dt(x.created_at)}${x.status === 'pending' ? ' · на кассе откройте «Заказы» → этот заказ → оплата картой' : ''}${x.error ? ` · <span style="color:var(--bad)">${esc(x.error)}</span>` : ''}</div></div>
      ${x.status === 'pending' ? `<div class="inline" style="gap:6px"><button type="button" class="sm" data-sbc="${x.id}">Проверить</button><button type="button" class="sm ghost danger" data-sbx="${x.id}">Отменить</button></div>` : ''}</div>`).join('')}</div>` : ''}
    ${o.payments.length ? `<h3 style="margin-top:14px">Платежи</h3><table class="tbl"><tbody>${o.payments.map((p) => `<tr><td class="nowrap">${dt(p.created_at)}</td><td>${p.direction === 'out' ? 'Возврат' : 'Оплата'} · ${METHODS[p.method] || p.method}</td><td class="muted">${esc(p.user || '')}${p.acquiring ? `<div class="small">эквайринг −${rub(p.acquiring)} (наш расход)</div>` : ''}</td><td class="r mono" style="color:${p.direction === 'out' ? 'var(--bad)' : 'inherit'}">${p.direction === 'out' ? '−' : ''}${rub(p.amount)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${o.accruals.length ? `<h3 style="margin-top:14px">Начислено мастерам</h3><table class="tbl"><tbody>${o.accruals.map((a) => `<tr><td>${esc(a.user || '')}</td><td class="muted">${esc(a.name)}</td><td class="r muted">${a.percent}% от ${rub(a.base)}</td><td class="r mono">${rub(a.amount)}</td></tr>`).join('')}</tbody></table>` : o.status === 'issued' ? '' : '<div class="small muted" style="margin-top:12px">Зарплата мастерам начислится автоматически при статусе «Выдан».</div>'}</div>` : ''}
  </div><div>
    <div class="card"><h2>Клиент и автомобиль</h2>${o.contractor_name ? `<div class="field"><span class="badge">🤝 ${esc(o.contractor_name)}</span></div>` : ''}
      <div class="field"><b>${o.client_id && office ? `<a href="#/clients/${o.client_id}">${esc(o.client_name)}</a>` : esc(o.client_name || '—')}</b>
      ${o.client_phone ? `<div><a href="tel:${esc(o.client_phone)}">${esc(o.client_phone)}</a></div>` : ''}</div>
      ${office && o.master_id ? `<button type="button" class="sm" id="msgMaster" style="margin-bottom:10px">✉ Написать мастеру (${esc(o.master_name || '')})</button>` : ''}
      <div class="field"><div>${esc([o.brand, o.model, o.year].filter(Boolean).join(' ') || '—')}</div>
      <div class="muted small">${o.plate ? 'Госномер ' + esc(o.plate) : ''}${o.vin ? ' · VIN ' + esc(o.vin) : ''}${o.color ? ' · ' + esc(o.color) : ''}</div></div>
    </div>
    ${isEst ? '' : acceptCard(o, office)}
    <form class="card" id="of"><h2>Детали</h2>
      <div class="row"><div class="field"><label>Запись (начало)</label><input type="datetime-local" name="scheduled_at" value="${esc(o.scheduled_at || '')}" step="900" ${office ? '' : 'disabled'}></div>
      <div class="field"><label>На посту до</label><input type="date" name="end_date" value="${esc(o.end_date || '')}" ${office ? '' : 'disabled'}></div></div>
      <div class="row"><div class="field"><label>Длительность, ч</label><input type="number" name="duration_h" value="${(o.duration_min || 120) / 60}" step="0.5" min="0.5" ${office ? '' : 'disabled'}></div>
      <div class="field"><label>Пост</label><select name="bay" ${office ? '' : 'disabled'}>${opts(S.me.bays, o.bay, '—')}</select></div></div>
      ${office ? `<div class="field"><label>Контрагент (партнёр / плательщик)</label><select name="contractor_id">${opts(contrs.map((c) => [c.id, c.name]), o.contractor_id, '— частный клиент —')}</select></div>` : ''}
      <div class="row"><div class="field"><label>Мастер</label><select name="master_id" ${office ? '' : 'disabled'}>${masterOpts(o.master_id)}</select></div>
      <div class="field"><label>Пробег, км</label><input type="number" name="mileage" value="${esc(o.mileage || '')}" ${office ? '' : 'disabled'}></div></div>
      <div class="field"><label>Пожелания клиента</label><textarea name="complaint" ${office ? '' : 'disabled'}>${esc(o.complaint || '')}</textarea></div>
      <div class="field"><label>Внутренние заметки</label><textarea name="notes" ${office ? '' : 'disabled'}>${esc(o.notes || '')}</textarea></div>
      ${office ? '<button class="primary">Сохранить</button>' : ''}
      ${isAdmin() ? '<button type="button" class="ghost danger sm" id="delOrder" style="float:right">Удалить заказ</button>' : ''}
    </form>
    <div class="card"><h2>История</h2><div class="inline" style="margin-bottom:8px;flex-wrap:nowrap"><input id="cmt" placeholder="Комментарий…"><button type="button" class="sm" id="addCmt">→</button></div>
      <div class="log">${o.log.map((l) => `<div>${esc(l.text)}<div class="muted">${dt(l.created_at)} · ${esc(l.user || 'система')}</div></div>`).join('')}</div></div>
  </div></div>`;

  const reload = () => navigate();
  $$('.pipe button', page).forEach((b) => (b.onclick = async () => {
    const st = b.dataset.st;
    if (st === 'issued' && svc.some((i) => !i.master_id) && !o.master_id && !(await confirmBox('У части работ не указан мастер — по ним зарплата не начислится. Всё равно выдать?', 'Выдать'))) return;
    if (st === 'issued' && t.due > 0.5 && !(await confirmBox(`По заказу не оплачено ${rub(t.due)}. Всё равно выдать автомобиль?`, 'Выдать'))) return;
    if (st === 'cancelled' && !(await confirmBox('Отменить заказ?', 'Отменить заказ'))) return;
    try { await POST(`/api/orders/${o.id}/status`, { status: st }); toast('Статус: ' + S.me.statuses[st]); reload(); } catch (e) { toast(e.message, true); }
  }));
  const twb = $('#toWarranty', page);
  if (twb) twb.onclick = () => {
    const pr = o.items.filter((i) => i.kind === 'product');
    const pick = (i) => warrantyModal({ order_id: o.id, client_id: o.client_id, client_name: o.client_name, client_phone: o.client_phone,
      product_id: i ? i.ref_id : '', product_name: i ? i.name : '', qty: 1, sale_date: (o.issued_at || o.done_at || o.created_at || '').slice(0, 10),
      contractor_id: i ? i.contractor_id : '' }, (id) => go('/warranty/' + id));
    if (pr.length < 2) return pick(pr[0]);
    const m = modal('Какой товар принимаем?', `<div class="list">${pr.map((i, n) => `<div class="li click" data-pi="${n}"><div class="grow t">${esc(i.name)}</div></div>`).join('')}<div class="li click" data-pi="-1"><div class="grow muted">Другой товар…</div></div></div>`, { footer: '<button type="button" data-x>Отмена</button>' });
    $$('[data-pi]', m.el).forEach((e) => (e.onclick = () => { m.close(); pick(pr[+e.dataset.pi]); }));
  };
  $('#addCmt', page).onclick = async () => {
    const v = $('#cmt', page).value.trim(); if (!v) return;
    await POST(`/api/orders/${o.id}/comment`, { text: v }); reload();
  };
  $('#cmt', page).onkeydown = (e) => { if (e.key === 'Enter') $('#addCmt', page).click(); };
  bindPhotos(page, o, reload, office);
  if (!office) return;
  if (o.scheduled_at) markMasters(page, o.scheduled_at, o.end_date);
  { const of = $('#of', page); const rm = () => markMasters(page, of.scheduled_at.value, of.end_date.value);
    of.scheduled_at.addEventListener('change', rm); of.end_date.addEventListener('change', rm); }

  $('#of', page).onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    d.duration_min = Math.round((+d.duration_h || 2) * 60); delete d.duration_h;
    try { await PUT('/api/orders/' + o.id, d); toast('Сохранено'); reload(); } catch (err) { toast(err.message, true); }
  };
  bindAccept(page, o, reload);
  const mmb = $('#msgMaster', page);
  if (mmb) mmb.onclick = () => modal('Сообщение мастеру · ' + (o.master_name || ''), `
    <div class="small muted" style="margin-bottom:8px">Уйдёт в MAX (или Telegram) от бота студии с вашей подписью и номером заказа. Ответ мастера появится в истории заказа и в «Сообщениях».</div>
    <div class="field"><textarea name="text" rows="4" required placeholder="Напр.: клиент просит поставить сабвуфер левее, перезвони ему"></textarea></div>`,
  { submit: 'Отправить', onSubmit: async (d) => { const r = await POST(`/api/orders/${o.id}/message`, { text: d.text }); toast('Отправлено: ' + r.channels.join(', ').replace('max', 'MAX').replace('telegram', 'Telegram')); reload(); } });
  // inline-редактирование позиций
  $$('tr[data-item]', page).forEach((tr) => {
    $$('[data-f]', tr).forEach((inp) => inp.addEventListener('change', async () => {
      try { await PUT('/api/order-items/' + tr.dataset.item, { [inp.dataset.f]: inp.value }); reload(); } catch (e) { toast(e.message, true); }
    }));
  });
  $$('[data-del]', page).forEach((b) => (b.onclick = async () => {
    if (!(await confirmBox('Удалить позицию из заказа?', 'Удалить'))) return;
    await DEL('/api/order-items/' + b.dataset.del); reload();
  }));
  $('#disc', page).onchange = async (e) => { await PUT('/api/orders/' + o.id, { discount_percent: e.target.value }); reload(); };
  const svcList = await services();
  autocomplete($('#addSvc', page), {
    minLen: 0,
    search: async (q) => {
      const ql = q.toLowerCase();
      const found = svcList.filter((s) => s.active && (s.name + ' ' + (s.category || '')).toLowerCase().includes(ql)).slice(0, 15);
      return q ? [...found, { custom: true, name: q }] : found;
    },
    render: (s) => s.custom ? `+ Своя работа: <b>${esc(s.name)}</b>` : `<div>${esc(s.name)}</div><div class="s">${esc(s.category || '')} · ${rub(s.price)}</div>`,
    onPick: async (s) => {
      try {
        if (s.custom) {
          const pr = prompt('Цена работы «' + s.name + '», ₽', '0'); if (pr === null) return;
          await POST(`/api/orders/${o.id}/items`, { kind: 'service', name: s.name, price: pr, warranty_months: 6 });
        } else await POST(`/api/orders/${o.id}/items`, { kind: 'service', ref_id: s.id });
        reload();
      } catch (e) { toast(e.message, true); }
    },
  });
  autocomplete($('#addPrd', page), {
    search: (q) => GET('/api/products' + qs({ q })).then((r) => [...r.slice(0, 15), ...(q ? [{ custom: true, name: q }] : [])]),
    render: (p) => p.custom ? `+ Свой товар (нет в каталоге): <b>${esc(p.name)}</b>` : `<div>${esc(p.name)} ${p.sku ? `<span class="s">${esc(p.sku)}</span>` : ''}</div><div class="s">${rub(p.price)} · на складе ${num(p.stock)} ${esc(p.unit)}</div>`,
    onPick: (p) => p.custom ? customProductModal(o, p.name, reload) : productAddModal(o, p, contrs.filter((c) => c.kind === 'supplier' || c.kind === 'other' || c.kind === 'partner'), reload, isEst),
  });
  const ec = $('#estConvert', page);
  if (ec) ec.onclick = async () => {
    if (!(await confirmBox(`Перевести расчёт ${o.number} в заказ-наряд? Позиции и цены сохранятся${o.scheduled_at ? '' : ', дату записи назначите в «Деталях»'}.`, 'Оформить заказ-наряд'))) return;
    try { await POST(`/api/orders/${o.id}/convert`); toast('Заказ-наряд ' + o.number + ' оформлен'); reload(); } catch (e) { toast(e.message, true); }
  };
  const ex = $('#estCancel', page);
  if (ex) ex.onclick = async () => { if (await confirmBox('Отметить, что клиент отказался? Расчёт останется в списке со статусом «Отменён».', 'Да, отказался')) { await POST(`/api/orders/${o.id}/status`, { status: 'cancelled' }); reload(); } };
  const payModal = (refund) => modal(refund ? 'Возврат клиенту' : 'Принять оплату', `
    <div class="row"><div class="field"><label>Сумма, ₽</label><input type="number" name="amount" step="any" min="0.01" required value="${refund ? '' : Math.max(t.due, 0)}"></div>
    <div class="field"><label>Способ</label><select name="method">${opts(Object.entries(refund ? { ...PAY_IN, transfer: 'С расчётного счёта' } : PAY_IN), 'cash')}</select></div></div>
    ${refund ? '' : `<div class="small muted" id="pmHint" style="margin:-4px 0 8px"></div>`}
    ${!refund && S.me.saby_on ? `<label id="pmSaby" style="display:flex;gap:10px;align-items:flex-start;color:var(--text);margin:0 0 12px;cursor:pointer"><input type="checkbox" name="saby" checked style="width:18px;height:18px;flex:none;margin-top:2px"><span>Провести через кассу Saby — сумма уйдёт на кассу и терминал Альфа-Банка, чек пробьётся автоматически</span></label>` : ''}
    <div class="field"><label>Комментарий</label><input name="note"></div>`,
  { onOpen: (f) => { const h = $('#pmHint', f); if (!h) return; const u = () => { const v = f.method.value, a = +f.amount.value || 0, pct = S.me.acquiring_percent ?? 2;
      h.textContent = v === 'terminal' ? `Зачислится на расчётный счёт. Эквайринг ${pct}% (${rub(a * pct / 100)}) — наш расход, клиент платит ${rub(a)}.` : v === 'card' ? 'Зачислится в кассу «Карта», без эквайринга.' : 'Зачислится в кассу «Наличные».'; };
      const sb = $('#pmSaby', f); const us = () => { if (sb) sb.style.display = f.method.value === 'terminal' ? '' : 'none'; };
      f.method.onchange = () => { u(); us(); }; f.amount.oninput = u; u(); us(); },
    submit: refund ? 'Оформить возврат' : 'Принять', onSubmit: async (d) => {
      if (!refund && d.saby && d.method === 'terminal') {
        await POST(`/api/orders/${o.id}/saby`, { amount: d.amount });
        toast('Отправлено на кассу. На кассе: «Заказы» → ' + o.number + ' → оплата картой. CRM запишет оплату сама.'); return reload();
      }
      await POST(`/api/orders/${o.id}/pay`, { ...d, refund }); toast(refund ? 'Возврат проведён' : 'Оплата принята'); reload(); } });
  $$('[data-sbc]', page).forEach((b) => (b.onclick = async () => { try { const r = await POST(`/api/saby/${b.dataset.sbc}/check`, {}); toast(r.status === 'paid' ? 'Оплата получена: ' + rub(r.paid) : r.error ? 'Saby: ' + r.error : 'Пока не оплачено' + (r.state ? ' (' + r.state + ')' : ''), !!r.error); if (r.status !== 'pending') reload(); } catch (e) { toast(e.message, true); } }));
  $$('[data-sbx]', page).forEach((b) => (b.onclick = async () => { if (!(await confirmBox('Отменить оплату на кассе? Заказ на кассе Saby будет отменён.', 'Отменить'))) return; try { const r = await POST(`/api/saby/${b.dataset.sbx}/cancel`, {}); toast(r.status === 'paid' ? 'Уже оплачено на кассе — оплата записана' : 'Отменено'); reload(); } catch (e) { toast(e.message, true); } }));
  if ((o.saby || []).some((x) => x.status === 'pending')) { const tm = setTimeout(() => { if (document.body.contains(page) && location.hash.includes('/orders/' + o.id)) reload(); }, 25000); }
  $('#pay', page).onclick = () => payModal(false);
  $('#refund', page).onclick = () => payModal(true);
  const dl = $('#delOrder', page);
  if (dl) dl.onclick = async () => { if (await confirmBox('Удалить заказ безвозвратно? Платежи останутся в кассе без привязки.', 'Удалить')) { await DEL('/api/orders/' + o.id); toast('Заказ удалён'); go('/orders'); } };
});

// ================= Календарь =================
// Цвета как в Excel-журнале студии
const ST_COLOR = { new: '#ea9999', scheduled: '#93c47d', in_work: '#6fbf5a', waiting: '#ff9900', done: '#9fc5e8', issued: '#b7b7b7' };
const ST_HINT = { new: 'предварительно / не подтверждено' };
const NOTE_COLORS = [['#ffe599', 'Жёлтый'], ['#93c47d', 'Зелёный'], ['#ea9999', 'Красный'], ['#ff9900', 'Оранжевый'], ['#9fc5e8', 'Голубой'], ['#b7b7b7', 'Серый'], ['#ffffff', 'Белый']];

function noteModal(n, onDone) {
  const isNew = !n.id;
  modal(isNew ? 'Заметка в журнал' : 'Заметка', `
    <div class="small muted" style="margin-bottom:8px">${dmy(n.date)}${n.bay ? ' · ' + esc(n.bay) : ' · на весь день'}</div>
    <div class="field"><label>Текст</label><textarea name="text" rows="4" required placeholder="Напр.: Сергей отсутствует / Предварительно: Camry 50, сабвуфер, 8-9xx…">${esc(n.text || '')}</textarea></div>
    <div class="field"><label>Цвет</label><div class="chips">${NOTE_COLORS.map(([c, t]) => `<label class="chip swatch ${(n.color || '#ffe599') === c ? 'on' : ''}" title="${t}" style="--sw:${c}"><input type="radio" name="color" value="${c}" hidden ${(n.color || '#ffe599') === c ? 'checked' : ''}><i></i></label>`).join('')}</div></div>
    <div class="row"><div class="field"><label>Пост</label><select name="bay">${opts(S.me.bays, n.bay, '— на весь день —')}</select></div>
    ${isNew ? '<div class="field"><label>Сколько дней подряд</label><input type="number" name="days" value="1" min="1" max="60"></div>' : ''}</div>`,
  { footer: !isNew ? '<button type="button" class="ghost danger" data-deln style="margin-right:auto">Удалить</button><button type="button" data-x>Отмена</button><button class="primary">Сохранить</button>' : undefined,
    onSubmit: async (d) => { if (isNew) await POST('/api/cal-notes', { ...d, date: n.date }); else await PUT('/api/cal-notes/' + n.id, d); onDone(); },
    onOpen: (f, close) => {
      $$('input[name=color]', f).forEach((r) => r.addEventListener('change', () => $$('.swatch', f).forEach((c) => c.classList.toggle('on', $('input', c).checked))));
      const b = $('[data-deln]', f); if (b) b.onclick = async () => { await DEL('/api/cal-notes/' + n.id); close(); onDone(); };
    } });
}

route(/^\/calendar$/, async (page, query) => {
  const monday = (ds) => { const d = new Date(ds + 'T00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
  let view = query.v || 'journal';
  let date = query.d || (view === 'journal' ? monday(today()) : today());
  const DAYS = 14;
  const [ws, we] = [S.me.work_start, S.me.work_end].map((t) => +t.split(':')[0] + (+t.split(':')[1] || 0) / 60);
  const SLOT = 28; // px на 30 минут
  const render = async () => {
    const d = new Date(date + 'T00:00');
    let from = date, to = date;
    if (view === 'journal') { const en = new Date(d); en.setDate(d.getDate() + DAYS - 1); to = ymd(en); }
    const [data, absJ] = await Promise.all([GET('/api/calendar' + qs({ from, to, format: 'journal' })), view === 'journal' ? absentFor(from, to) : {}]);
    const absOn = (ds) => masters().filter((u) => (absJ[u.id] || []).includes(ds)).map((u) => u.name);
    const rows = data.orders, notes = data.notes;
    const title = view === 'day' ? `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}` : `${dmy(from)} — ${dmy(to)}`;
    page.innerHTML = `<div class="topbar"><h1>${view === 'journal' ? 'Журнал записи' : 'Календарь'}</h1><div class="inline"><button id="prev">‹</button><button id="tod">Сегодня</button><button id="next">›</button></div>
      <b style="font-size:16px">${title}</b><div class="sp"></div><input type="date" id="pick" value="${date}" style="width:auto">
      <div class="chips"><button class="chip ${view === 'journal' ? 'on' : ''}" data-v="journal">Журнал</button><button class="chip ${view === 'day' ? 'on' : ''}" data-v="day">По часам</button></div></div>
      ${view === 'journal' ? `<div class="legend" style="margin:-6px 0 10px">${Object.entries(ST_COLOR).map(([k, c]) => `<span><i style="background:${c}"></i>${S.me.statuses[k]}${ST_HINT[k] ? ' (' + ST_HINT[k] + ')' : ''}</span>`).join('')}<span><i style="background:#ffe599"></i>Заметка</span></div>` : ''}
      <div id="cal"></div>`;
    const box = $('#cal', page);
    if (view === 'journal') {
      const posts = S.me.bays.length ? S.me.bays : ['Пост 1'];
      const noBay = rows.some((r) => !posts.includes(r.bay));
      const cols = [...posts, ...(noBay ? ['Без поста'] : []), ''];
      const days = []; for (let i = 0; i < DAYS; i++) { const x = new Date(d); x.setDate(d.getDate() + i); days.push(ymd(x)); }
      const inCol = (bay, c) => (c === 'Без поста' ? !posts.includes(bay) : c === '' ? false : bay === c);
      const orderCard = (r, ds) => {
        const start = r.scheduled_at.slice(0, 10), end = r.end_date || start;
        const first = ds === start || ds === from;
        const total = Math.round((new Date(end) - new Date(start)) / 864e5) + 1;
        const n = Math.round((new Date(ds) - new Date(start)) / 864e5) + 1;
        return `<div class="jc" data-id="${r.id}" style="--c:${ST_COLOR[r.status] || '#93c47d'}"><b>${esc([r.brand, r.model].filter(Boolean).join(' ') || r.client || orderNo(r.id))}</b>${ds === start ? ` <span class="jt">${r.scheduled_at.slice(11, 16)}</span>` : ''}${total > 1 ? ` <span class="jt">${n}/${total} дн.</span>` : ''}
          ${first ? `${r.complaint ? `<div class="jx">${esc(r.complaint)}</div>` : ''}<div class="jx">${esc(r.client || '')} ${esc(r.phone || '')}</div>${r.master ? `<div class="jx">👷 ${esc(r.master)}</div>` : ''}` : ''}</div>`;
      };
      const noteCard = (n) => `<div class="jc note" data-note="${n.id}" style="--c:${n.color || '#ffe599'}">${esc(n.text)}</div>`;
      box.innerHTML = `<div class="jwrap"><table class="jr"><thead><tr><th class="jd">Дата</th>${cols.map((c) => `<th>${c ? esc(c) : 'Заметки дня'}</th>`).join('')}</tr></thead><tbody>
        ${days.map((ds) => { const x = new Date(ds + 'T00:00'); const off = isDayOff(ds);
          return `<tr class="${ds === today() ? 'today' : ''} ${off ? 'off' : ''}"><td class="jd"><b>${pad(x.getDate())}.${pad(x.getMonth() + 1)}</b><div>${DOW[x.getDay()]}</div>${off ? '<div class="offl">выходной</div>' : absOn(ds).length ? `<div class="nrl">Н/Р: ${absOn(ds).map(esc).join(', ')}</div>` : ''}</td>
          ${cols.map((c) => `<td class="jcell" data-d="${ds}" data-bay="${esc(c === 'Без поста' ? '' : c)}">${rows.filter((r) => inCol(r.bay, c) && r.scheduled_at.slice(0, 10) <= ds && (r.end_date || r.scheduled_at.slice(0, 10)) >= ds).map((r) => orderCard(r, ds)).join('')}${notes.filter((n) => n.date === ds && (c === '' ? !n.bay : n.bay === c)).map(noteCard).join('')}</td>`).join('')}</tr>`; }).join('')}
        </tbody></table></div>`;
      const reloadJ = () => render();
      $$('[data-note]', box).forEach((e) => (e.onclick = (ev) => { ev.stopPropagation(); if (!isOffice()) return; const n = notes.find((x) => x.id === +e.dataset.note); noteModal(n, reloadJ); }));
      if (isOffice()) $$('.jcell', box).forEach((td) => (td.onclick = () => {
        const ds = td.dataset.d, bay = td.dataset.bay;
        const m = modal(`${dmy(ds)}${bay ? ' · ' + bay : ''}`, (isDayOff(ds) ? '<div class="offwarn">⚠️ Это выходной день. Запись можно сделать только как исключение.</div>' : '') + '<div class="grid" style="gap:10px"><button type="button" class="primary" data-a="o" style="justify-content:center;padding:12px">🚗 Записать автомобиль</button><button type="button" data-a="n" style="justify-content:center;padding:12px">📝 Заметка в ячейку</button></div>', { footer: '<button type="button" data-x>Отмена</button>' });
        $('[data-a=o]', m.el).onclick = () => { m.close(); newOrderModal({ scheduled_at: `${ds}T11:00`, bay }); };
        if (isDayOff(ds)) $('[data-a=o]', m.el).textContent = '🚗 Записать как исключение';
        $('[data-a=n]', m.el).onclick = () => { m.close(); noteModal({ date: ds, bay }, reloadJ); };
      }));
    } else {
      const rows2 = rows.filter((r) => r.scheduled_at.slice(0, 10) === date);
      const cols = S.me.bays.length ? S.me.bays : ['Запись'];
      const unassigned = rows2.filter((r) => !r.bay || !cols.includes(r.bay));
      const allCols = unassigned.length ? [...cols, 'Без поста'] : cols;
      const hours = []; for (let h = Math.floor(ws); h < Math.ceil(we); h++) hours.push(h);
      const pos = (s) => { const [hh, mm] = s.slice(11, 16).split(':').map(Number); return ((hh + mm / 60) - Math.floor(ws)) * 2 * SLOT; };
      box.innerHTML = `<div class="cal" style="grid-template-columns:56px repeat(${allCols.length}, minmax(140px,1fr))">
        <div class="hcol"><div class="colh"></div>${hours.map((h) => `<div class="hl">${pad(h)}:00</div>`).join('')}</div>
        ${allCols.map((c) => `<div class="col"><div class="colh">${esc(c)}</div><div class="cbody" style="position:relative">
          ${hours.map((h) => `<div class="slot" data-t="${pad(h)}:00" data-bay="${esc(c)}"></div><div class="slot hr" data-t="${pad(h)}:30" data-bay="${esc(c)}"></div>`).join('')}
          ${rows2.filter((r) => (c === 'Без поста' ? unassigned.includes(r) : r.bay === c)).map((r) => `<div class="ev st-${r.status}" data-id="${r.id}" style="top:${pos(r.scheduled_at)}px;height:${Math.max((r.duration_min || 60) / 30 * SLOT - 3, 24)}px">
            <b>${r.scheduled_at.slice(11, 16)} ${esc(r.client || '')}</b>${esc(carStr(r))}${r.master ? `<div class="muted">${esc(r.master)}</div>` : ''}${r.complaint ? `<div class="muted">${esc(r.complaint)}</div>` : ''}</div>`).join('')}
        </div></div>`).join('')}</div>`;
      if (date === today()) {
        const n = nowTz(); const top = ((n.getHours() + n.getMinutes() / 60) - Math.floor(ws)) * 2 * SLOT;
        if (top > 0 && top < hours.length * 2 * SLOT) $$('.cbody', box).forEach((c) => c.insertAdjacentHTML('beforeend', `<div class="now" style="top:${top}px"></div>`));
      }
      if (isOffice()) $$('.slot', box).forEach((s) => (s.onclick = () => newOrderModal({ scheduled_at: `${date}T${s.dataset.t}`, bay: s.dataset.bay === 'Без поста' ? '' : s.dataset.bay })));
      if (isDayOff(date)) box.insertAdjacentHTML('afterbegin', '<div class="offwarn">⚠️ Выходной день — запись возможна только как исключение</div>');
    }
    $$('[data-id]', box).forEach((e) => (e.onclick = (ev) => { ev.stopPropagation(); go('/orders/' + e.dataset.id); }));
    const shift = (n) => { const x = new Date(date + 'T00:00'); x.setDate(x.getDate() + n * (view === 'journal' ? 7 : 1)); date = ymd(x); render(); };
    $('#prev', page).onclick = () => shift(-1); $('#next', page).onclick = () => shift(1);
    $('#tod', page).onclick = () => { date = view === 'journal' ? monday(today()) : today(); render(); };
    $('#pick', page).onchange = (e) => { if (e.target.value) { date = view === 'journal' ? monday(e.target.value) : e.target.value; render(); } };
    $$('[data-v]', page).forEach((b) => (b.onclick = () => { view = b.dataset.v; date = view === 'journal' ? monday(date) : (date <= today() && today() <= ymd(new Date(new Date(date).getTime() + 13 * 864e5)) ? today() : date); render(); }));
  };
  await render();
});

// ================= Клиенты =================
route(/^\/clients$/, async (page) => {
  page.innerHTML = `<div class="topbar"><h1>Клиенты</h1><span class="muted" id="cnt"></span><div class="sp"></div>
    <input class="search" id="q" placeholder="Имя, телефон, госномер, марка, VIN">
    <a class="btn" href="/api/export/clients.csv">Excel</a><button class="primary" id="add">+ Клиент</button></div>
    <div class="card" style="padding:4px 6px"><div class="tblwrap" id="list"></div></div>`;
  const load = async () => {
    const { rows, total } = await GET('/api/clients' + qs({ q: $('#q', page).value, limit: 300 }));
    $('#cnt', page).textContent = total;
    $('#list', page).innerHTML = rows.length ? `<table class="tbl resp"><thead><tr><th>Клиент</th><th>Телефон</th><th>Автомобили</th><th>Источник</th><th class="r">Заказов</th><th class="r">Потратил</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="click" data-id="${c.id}"><td data-l="Клиент"><b>${esc(c.name)}</b>${c.discount ? ` <span class="badge">−${c.discount}%</span>` : ''}</td><td data-l="Телефон" class="nowrap">${esc(c.phone || '')}</td>
      <td data-l="Авто">${esc(c.cars || '')}</td><td data-l="Источник" class="muted">${esc(c.source || '')}</td><td data-l="Заказов" class="r">${c.orders_n}</td><td data-l="Потратил" class="r mono">${rub(c.spent)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Клиентов не найдено</div>';
  };
  $('#q', page).oninput = debounce(load, 300);
  $('#list', page).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) go('/clients/' + tr.dataset.id); };
  $('#add', page).onclick = () => clientModal();
  await load();
});

function clientModal(c = {}) {
  const isNew = !c.id;
  modal(isNew ? 'Новый клиент' : 'Клиент', `
    <div class="row"><div class="field"><label>Имя *</label><input name="name" required value="${esc(c.name || '')}"></div>
    <div class="field"><label>Телефон</label><input name="phone" value="${esc(c.phone || '')}" placeholder="+7…"></div></div>
    <div class="row"><div class="field"><label>Email</label><input name="email" type="email" value="${esc(c.email || '')}"></div>
    <div class="field"><label>Откуда узнал</label><select name="source">${opts(SOURCES.includes(c.source) || !c.source ? SOURCES : [c.source, ...SOURCES], c.source, '—')}</select></div></div>
    <div class="row"><div class="field"><label>Дата рождения</label><input name="birthday" type="date" value="${esc(c.birthday || '')}"></div>
    <div class="field"><label>Постоянная скидка, %</label><input name="discount" type="number" min="0" max="100" step="any" value="${c.discount || 0}"></div></div>
    ${isNew ? `<h3>Автомобиль</h3><div class="row"><div class="field"><label>Марка</label><input name="car_brand"></div><div class="field"><label>Модель</label><input name="car_model"></div><div class="field"><label>Госномер</label><input name="car_plate"></div></div>` : ''}
    <div class="field"><label>Заметки</label><textarea name="notes">${esc(c.notes || '')}</textarea></div>`,
  { onSubmit: async (d) => {
    if (isNew) {
      d.car = { brand: d.car_brand, model: d.car_model, plate: d.car_plate };
      let r;
      try { r = await POST('/api/clients', d); }
      catch (e) {
        if (e.status === 409 && (await confirmBox(e.message + '. Создать ещё одного?', 'Создать'))) r = await POST('/api/clients', { ...d, force: true });
        else throw e;
      }
      toast('Клиент добавлен'); go('/clients/' + r.id);
    } else { await PUT('/api/clients/' + c.id, d); toast('Сохранено'); navigate(); }
  } });
}

function carModal(clientId, car = {}) {
  modal(car.id ? 'Автомобиль' : 'Новый автомобиль', `
    <div class="row"><div class="field"><label>Марка</label><input name="brand" value="${esc(car.brand || '')}"></div><div class="field"><label>Модель</label><input name="model" value="${esc(car.model || '')}"></div>
    <div class="field"><label>Год</label><input name="year" type="number" value="${esc(car.year || '')}"></div></div>
    <div class="row"><div class="field"><label>Госномер</label><input name="plate" value="${esc(car.plate || '')}"></div><div class="field"><label>VIN</label><input name="vin" value="${esc(car.vin || '')}" maxlength="17"></div>
    <div class="field"><label>Цвет</label><input name="color" value="${esc(car.color || '')}"></div></div>
    <div class="field"><label>Что установлено (аудиосистема, шумка, охранка)</label><textarea name="audio_notes" placeholder="Напр.: ГУ Pioneer, фронт Morel, усилитель 4-кан, саб 12'' ЗЯ, шумка дверей">${esc(car.audio_notes || '')}</textarea></div>`,
  { onSubmit: async (d) => { if (car.id) await PUT('/api/cars/' + car.id, d); else await POST('/api/cars', { ...d, client_id: clientId }); navigate(); } });
}

route(/^\/clients\/(\d+)$/, async (page, id) => {
  const c = await GET('/api/clients/' + id);
  page.innerHTML = `<div class="topbar"><button class="ghost" onclick="history.back()">←</button><h1>${esc(c.name)}</h1>${c.discount ? `<span class="badge">скидка ${c.discount}%</span>` : ''}${c.tg_chat_id ? '<span class="badge ok">Telegram</span>' : ''}<div class="sp"></div>
    <button id="edit">Изменить</button><button class="primary" id="newOrd">+ Заказ</button></div>
  <div class="grid g-main"><div>
    <div class="card"><h2>Заказы</h2>${c.orders.length ? `<table class="tbl resp"><thead><tr><th>№</th><th>Статус</th><th>Авто</th><th>Дата</th><th class="r">Сумма</th></tr></thead><tbody>
      ${c.orders.map((o) => `<tr class="click" data-o="${o.id}"><td data-l="№"><b>${orderNo(o.id)}</b></td><td data-l="Статус">${stBadge(o.status)}</td><td data-l="Авто">${esc(carStr(o))}</td><td data-l="Дата">${dmy(o.issued_at || o.scheduled_at || o.created_at)}</td><td data-l="Сумма" class="r mono">${rub(o.total)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Заказов ещё не было</div>'}</div>
  </div><div>
    <div class="card"><h2>Контакты</h2>
      ${c.phone ? `<div class="field"><a href="tel:${esc(c.phone)}" style="font-size:16px">${esc(c.phone)}</a></div>` : ''}
      ${c.email ? `<div class="field">${esc(c.email)}</div>` : ''}
      <div class="small muted">Источник: ${esc(c.source || '—')}${c.birthday ? ' · ДР ' + dmy(c.birthday) : ''}<br>Клиент с ${dmy(c.created_at)} · потратил ${rub(c.spent)}</div>
      ${c.notes ? `<div style="margin-top:10px;white-space:pre-wrap">${esc(c.notes)}</div>` : ''}
      ${isAdmin() && !c.orders.length ? '<button class="ghost sm danger" id="del" style="margin-top:10px">Удалить клиента</button>' : ''}</div>
    <div class="card"><div class="inline" style="margin-bottom:8px"><h2 style="margin:0;flex:1">Автомобили</h2><button class="sm" id="addCar">+ Авто</button></div>
      ${c.cars.map((x) => `<div class="li click" data-car="${x.id}"><div class="grow"><div class="t">${esc([x.brand, x.model, x.year].filter(Boolean).join(' ') || 'Автомобиль')}</div>
      <div class="s">${esc([x.plate, x.vin, x.color].filter(Boolean).join(' · '))}</div>${x.audio_notes ? `<div class="small muted" style="white-space:pre-wrap">${esc(x.audio_notes)}</div>` : ''}</div></div>`).join('') || '<div class="muted">Нет автомобилей</div>'}</div>
  </div></div>`;
  $('#edit', page).onclick = () => clientModal(c);
  $('#newOrd', page).onclick = () => newOrderModal({ client_id: c.id, client_name: c.name + (c.phone ? ' · ' + c.phone : '') });
  $('#addCar', page).onclick = () => carModal(c.id);
  $$('[data-car]', page).forEach((el) => (el.onclick = () => carModal(c.id, c.cars.find((x) => x.id === +el.dataset.car))));
  $$('[data-o]', page).forEach((el) => (el.onclick = () => go('/orders/' + el.dataset.o)));
  const del = $('#del', page);
  if (del) del.onclick = async () => { if (await confirmBox('Удалить клиента?', 'Удалить')) { await DEL('/api/clients/' + c.id); go('/clients'); } };
});

// ================= Заявки =================
route(/^\/leads$/, async (page) => {
  let st = 'new';
  page.innerHTML = `<div class="topbar"><h1>Заявки</h1><div class="sp"></div><button class="primary" id="add">+ Заявка</button></div>
    <div class="chips" style="margin-bottom:12px">${[['new', 'Новые'], ['work', 'В работе'], ['converted', 'Заказ создан'], ['lost', 'Отказ'], ['', 'Все']].map(([k, t]) => `<button class="chip ${k === st ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</div>
    <div class="card" style="padding:4px 6px"><div class="tblwrap" id="list"></div></div>`;
  let cache = [];
  const load = async () => {
    const rows = cache = await GET('/api/leads' + qs({ status: st }));
    $('#list', page).innerHTML = rows.length ? `<table class="tbl resp"><thead><tr><th>Дата</th><th>Имя / телефон</th><th>Авто</th><th>Запрос</th><th>Источник</th><th>Статус</th><th></th></tr></thead><tbody>
      ${rows.map((l) => `<tr data-id="${l.id}"><td data-l="Дата" class="nowrap">${dt(l.created_at)}</td><td data-l="Клиент"><b>${esc(l.name || '—')}</b><div>${l.phone ? `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : ''}</div></td>
      <td data-l="Авто">${esc(l.car || '')}</td><td data-l="Запрос" style="max-width:320px">${esc(l.message || '')}${l.comment ? `<div class="small muted">💬 ${esc(l.comment)}</div>` : ''}</td>
      <td data-l="Источник" class="muted">${esc(l.source || '')}</td><td data-l="Статус"><span class="badge ${l.status === 'new' ? 'red' : l.status === 'converted' ? 'ok' : ''}">${LEAD_ST[l.status]}</span></td>
      <td class="nowrap">${l.order_id ? `<a class="btn sm" href="#/orders/${l.order_id}">${orderNo(l.order_id)}</a>` : `${l.status === 'new' ? '<button class="sm" data-a="work">В работу</button>' : ''} <button class="sm primary" data-a="conv">→ Заказ</button> <button class="sm" data-a="edit">⋯</button>`}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Заявок нет</div>';
  };
  const leadModal = (l = {}) => modal(l.id ? 'Заявка #' + l.id : 'Новая заявка', `
    <div class="row"><div class="field"><label>Имя</label><input name="name" value="${esc(l.name || '')}"></div><div class="field"><label>Телефон</label><input name="phone" value="${esc(l.phone || '')}"></div></div>
    <div class="row"><div class="field"><label>Автомобиль</label><input name="car" value="${esc(l.car || '')}"></div><div class="field"><label>Источник</label><input name="source" list="srcs" value="${esc(l.source || 'Звонок')}"><datalist id="srcs">${['Звонок', 'Сайт', ...SOURCES].map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div></div>
    <div class="field"><label>Запрос клиента</label><textarea name="message">${esc(l.message || '')}</textarea></div>
    ${l.id ? `<div class="row"><div class="field"><label>Статус</label><select name="status">${opts(Object.entries(LEAD_ST), l.status)}</select></div></div><div class="field"><label>Комментарий менеджера</label><textarea name="comment">${esc(l.comment || '')}</textarea></div>` : ''}`,
  { footer: l.id && isAdmin() ? `<button type="button" class="ghost danger" data-delL style="margin-right:auto">Удалить</button><button type="button" data-x>Отмена</button><button class="primary">Сохранить</button>` : undefined,
    onSubmit: async (d) => { if (l.id) await PUT('/api/leads/' + l.id, { ...l, ...d }); else await POST('/api/leads', d); load(); refreshLeadsBadge(); },
    onOpen: (f, close) => { const b = $('[data-delL]', f); if (b) b.onclick = async () => { if (await confirmBox('Удалить заявку?', 'Удалить')) { await DEL('/api/leads/' + l.id); close(); load(); refreshLeadsBadge(); } }; } });
  const loadC = load;
  $$('.chip', page).forEach((b) => (b.onclick = () => { st = b.dataset.st; $$('.chip', page).forEach((x) => x.classList.toggle('on', x === b)); loadC(); }));
  $('#add', page).onclick = () => leadModal();
  $('#list', page).onclick = async (e) => {
    const btn = e.target.closest('[data-a]'); if (!btn) return;
    const l = cache.find((x) => x.id === +btn.closest('tr').dataset.id);
    if (btn.dataset.a === 'work') { await PUT('/api/leads/' + l.id, { ...l, status: 'work' }); loadC(); refreshLeadsBadge(); }
    if (btn.dataset.a === 'edit') leadModal(l);
    if (btn.dataset.a === 'conv') {
      // если клиент с таким телефоном уже есть — подставим его
      const found = l.phone && String(l.phone).replace(/\D/g, '').length >= 10 ? (await GET('/api/clients' + qs({ q: l.phone, limit: 1 }))).rows[0] : null;
      if (found) {
        toast('Найден существующий клиент: ' + found.name);
        newOrderModal({ lead_id: l.id, client_id: found.id, client_name: found.name + ' · ' + (found.phone || ''), complaint: l.message });
      } else {
        const [brand, ...model] = (l.car || '').split(' ');
        newOrderModal({ lead_id: l.id, name: l.name, phone: l.phone, source: SOURCES.includes(l.source) ? l.source : 'Сайт', car_brand: brand, car_model: model.join(' '), complaint: l.message });
      }
    }
  };
  await loadC();
});

// ================= Склад =================
route(/^\/stock$/, async (page) => {
  let low = false, scope = 'stock', cat = '';
  page.innerHTML = `<div class="topbar"><h1>Склад</h1><span class="muted" id="sum"></span><div class="sp"></div>
    <input class="search" id="q" placeholder="Название, артикул, бренд">
    <button id="moves">Движения</button><button id="pricex">⬆ Прайс поставщика</button><button id="imp">Вставить из Excel</button><button id="receipt">Приход</button><button class="primary" id="add">+ Товар</button></div>
    <div class="inline" style="margin-bottom:12px"><div class="chips"><button class="chip on" data-sc="stock">На складе</button><button class="chip" data-sc="all">Весь каталог</button><button class="chip" data-sc="site" title="Товары, которые показываются на сайте ателье">На сайте</button><button class="chip" id="low">Заканчиваются</button></div>
    <select id="cat" style="width:auto;max-width:280px"><option value="">Все категории</option></select></div>
    <div class="card" style="padding:4px 6px"><div class="tblwrap" id="list"></div></div>`;
  $$('[data-sc]', page).forEach((b) => (b.onclick = () => { scope = b.dataset.sc; $$('[data-sc]', page).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  $('#cat', page).onchange = (e) => { cat = e.target.value; load(); };
  $('#pricex', page).onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      if (f.size > 10 * 1024 * 1024) return toast('Файл больше 10 МБ', true);
      const file = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      let pv; try { pv = await POST('/api/products/import-price', { file }); } catch (e) { return toast(e.message, true); }
      modal('Прайс поставщика', `<div class="small muted" style="margin-bottom:10px">В файле ${pv.total} позиций. Закупочная цена — <b>VIP дилер</b>, цена продажи — <b>розничная</b>. Совпадающие товары (по коду или названию) обновятся, остатки не меняются.</div>
        <div class="field"><label>Поставщик</label><input name="supplier" value="Спарта Маркет"></div>
        <label>Какие разделы загрузить</label><div class="checkgrid">${pv.groups.map((g) => `<label class="ck"><input type="checkbox" name="g" value="${esc(g.name)}" ${g.def ? 'checked' : ''}> ${esc(g.name)} <span class="muted small">${g.n}</span></label>`).join('')}</div>`,
      { submit: 'Загрузить', onSubmit: async (d, form) => {
        const groups = $$('input[name=g]:checked', form).map((x) => x.value);
        if (!groups.length) { toast('Выберите хотя бы один раздел', true); return false; }
        const r = await POST('/api/products/import-price', { file, mode: 'commit', groups, supplier: d.supplier });
        toast(`Добавлено: ${r.added}, обновлено цен: ${r.updated}`); load();
      } });
    };
    inp.click();
  };
  let rows = [];
  const load = async () => {
    const allRows = await GET('/api/products' + qs({ q: $('#q', page).value, low: low ? 1 : '', all: 1 }));
    const cats = [...new Set(allRows.map((p) => p.category).filter(Boolean))].sort();
    $('#cat', page).innerHTML = '<option value="">Все категории</option>' + cats.map((c) => `<option ${c === cat ? 'selected' : ''}>${esc(c)}</option>`).join('');
    rows = allRows.filter((p) => (!cat || p.category === cat) && (scope === 'site' ? p.site : scope === 'all' || low || $('#q', page).value || p.stock !== 0 || p.min_stock > 0));
    const shown = rows.slice(0, 500);
    const val = allRows.filter((p) => p.active && p.stock > 0).reduce((s, p) => s + p.stock * p.cost, 0);
    $('#sum', page).textContent = `${rows.length} поз.${rows.length > 500 ? ' (показаны первые 500 — уточните поиск)' : ''} · на складе на ${rub(val)} по закупке`;
    $('#list', page).innerHTML = rows.length ? `<table class="tbl resp"><thead><tr><th>Товар</th><th>Артикул</th><th>Категория</th><th class="r">Закупка</th><th class="r">Цена</th><th class="r">Наценка</th><th class="r">Остаток</th><th></th></tr></thead><tbody>
      ${shown.map((p) => `<tr class="click" data-id="${p.id}" style="${p.active ? '' : 'opacity:.5'}"><td data-l="Товар"><b>${esc(p.name)}</b>${p.site ? ' <span class="badge ok" title="Показывается на сайте">на сайте</span>' : ''}${p.brand ? `<div class="small muted">${esc(p.brand)}</div>` : ''}</td><td data-l="Артикул" class="muted">${esc(p.sku || '')}</td><td data-l="Категория">${esc(p.category || '')}</td>
      <td data-l="Закупка" class="r mono">${num(p.cost)}</td><td data-l="Цена" class="r mono">${num(p.price)}</td><td data-l="Наценка" class="r muted">${p.cost ? Math.round((p.price / p.cost - 1) * 100) + '%' : '—'}</td>
      <td data-l="Остаток" class="r"><span class="badge ${p.stock <= 0 ? 'red' : p.min_stock && p.stock <= p.min_stock ? 'warn' : 'ok'}">${num(p.stock)} ${esc(p.unit)}</span></td>
      <td><button class="sm" data-move="${p.id}" title="Корректировка остатка">±</button></td></tr>`).join('')}
      </tbody></table>` : `<div class="empty">${scope === 'site' ? 'На сайте пока ничего не показывается. Откройте товар в «Весь каталог» и отметьте «Показывать на сайте».' : scope === 'stock' && !low ? 'На складе пока ничего нет. Оформите «Приход» или откройте «Весь каталог».' : 'Товаров не найдено'}</div>`;
  };
  const prodModal = (p = { unit: 'шт', warranty_months: 12, active: 1 }) => modal(p.id ? 'Товар' : 'Новый товар', `
    <div class="field"><label>Название *</label><input name="name" required value="${esc(p.name || '')}"></div>
    <div class="row"><div class="field"><label>Артикул</label><input name="sku" value="${esc(p.sku || '')}"></div><div class="field"><label>Бренд</label><input name="brand" value="${esc(p.brand || '')}"></div>
    <div class="field"><label>Категория</label><input name="category" list="cats" value="${esc(p.category || '')}"><datalist id="cats">${['Магнитолы', 'Акустика', 'Сабвуферы', 'Усилители', 'Процессоры DSP', 'Провода и кабели', 'Шумоизоляция', 'Сигнализации', 'Камеры', 'Подсветка', 'Рамки и переходники', 'Расходники', ...new Set(rows.map((x) => x.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div></div>
    <div class="row"><div class="field"><label>Закупка, ₽</label><input name="cost" type="number" step="any" value="${p.cost || 0}"></div><div class="field"><label>Цена продажи, ₽</label><input name="price" type="number" step="any" value="${p.price || 0}"></div>
    <div class="field"><label>Ед. изм.</label><select name="unit">${opts(['шт', 'компл', 'м', 'лист', 'упак', 'л', 'кг'], p.unit)}</select></div></div>
    <div class="row">${p.id ? '' : '<div class="field"><label>Начальный остаток</label><input name="stock" type="number" step="any" value="0"></div>'}
    <div class="field"><label>Мин. остаток (оповещение)</label><input name="min_stock" type="number" step="any" value="${p.min_stock || 0}"></div><div class="field"><label>Гарантия, мес.</label><input name="warranty_months" type="number" value="${p.warranty_months ?? 12}"></div></div>
    ${p.id ? `<label class="inline" style="color:var(--text)"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Активен (показывать в подборе)</label>` : ''}
    <label class="inline" style="color:var(--text)"><input type="checkbox" name="site" ${p.site ? 'checked' : ''}> Показывать на сайте (витрина «Автосигнализации», цена берётся отсюда)</label>`,
  { onSubmit: async (d) => { if (p.id) await PUT('/api/products/' + p.id, d); else await POST('/api/products', d); toast('Сохранено'); load(); } });

  $('#q', page).oninput = debounce(load, 300);
  $('#low', page).onclick = (e) => { low = !low; e.target.classList.toggle('on', low); load(); };
  $('#add', page).onclick = () => prodModal();
  $('#list', page).onclick = (e) => {
    const mv = e.target.closest('[data-move]');
    if (mv) {
      e.stopPropagation(); const p = rows.find((x) => x.id === +mv.dataset.move);
      return modal('Корректировка: ' + p.name, `<p class="muted">Текущий остаток: <b>${num(p.stock)} ${esc(p.unit)}</b></p>
        <div class="row"><div class="field"><label>Изменение (+ приход, − списание)</label><input name="qty" type="number" step="any" required placeholder="-1"></div></div>
        <div class="field"><label>Причина</label><input name="note" placeholder="Брак, инвентаризация, возврат поставщику…"></div>`,
      { onSubmit: async (d) => { await POST(`/api/products/${p.id}/move`, { ...d, kind: 'adjust' }); toast('Остаток изменён'); load(); } });
    }
    const tr = e.target.closest('tr[data-id]'); if (tr) prodModal(rows.find((x) => x.id === +tr.dataset.id));
  };
  $('#moves', page).onclick = async () => {
    const m = await GET('/api/stock/moves');
    modal('Движения товара', m.length ? `<div class="tblwrap" style="max-height:60vh;overflow:auto"><table class="tbl"><thead><tr><th>Дата</th><th>Товар</th><th class="r">Кол-во</th><th>Основание</th><th>Кто</th></tr></thead><tbody>
      ${m.map((x) => `<tr><td class="nowrap">${dt(x.created_at)}</td><td>${esc(x.product)}</td><td class="r mono" style="color:${x.qty > 0 ? 'var(--ok)' : 'var(--bad)'}">${x.qty > 0 ? '+' : ''}${num(x.qty)}</td><td>${x.order_id ? `<a href="#/orders/${x.order_id}" onclick="this.closest('.overlay').remove()">${esc(x.note)}</a>` : esc(x.note || '')}</td><td class="muted">${esc(x.user || '')}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Движений нет</div>', { wide: true, footer: '<button type="button" data-x>Закрыть</button>' });
  };
  $('#imp', page).onclick = () => modal('Загрузка товаров из Excel', `
    <div class="small muted" style="margin-bottom:8px">Выделите в Excel столбцы в порядке <b>Название · Цена · Категория · Бренд · Закупка · Остаток · Артикул</b> (лишние столбцы можно не брать), скопируйте и вставьте сюда. Товар с таким же названием не задвоится — обновятся цены.</div>
    <textarea name="data" rows="12" placeholder="Alphard Machete MF-12S D2	10990	Сабвуферы	Alphard" style="font-family:monospace;font-size:12px"></textarea>`,
  { wide: true, submit: 'Загрузить', onSubmit: async (d) => {
    const rows = d.data.split(/\r?\n/).map((l) => l.split(/\t|;/)).filter((c) => c[0] && c[0].trim() && !/^назв/i.test(c[0].trim()))
      .map((c) => ({ name: c[0], price: (c[1] || '').replace(/[^\d.,]/g, '').replace(',', '.'), category: c[2], brand: c[3], cost: (c[4] || '').replace(/[^\d.,]/g, '').replace(',', '.'), stock: c[5], sku: c[6] }));
    if (!rows.length) { toast('Нет строк для загрузки', true); return false; }
    const r = await POST('/api/products/import', { rows });
    toast(`Добавлено: ${r.added}, обновлено: ${r.updated}`); load();
  } });
  $('#receipt', page).onclick = async () => {
    const contrs = await contractorsList();
    const lines = [];
    const m = modal('Приход товара', `<div><input id="rq" placeholder="Найдите товар и выберите его…"></div>
      <table class="tbl" style="margin-top:10px"><thead><tr><th>Товар</th><th style="width:100px">Кол-во</th><th style="width:130px">Закупка, ₽</th><th class="r">Сумма</th><th></th></tr></thead><tbody id="rl"><tr><td colspan="5" class="muted">Пусто</td></tr></tbody></table>
      <div class="r" style="margin:10px 0;font-weight:700" id="rsum"></div>
      <div class="row"><div class="field"><label>Поставщик</label><select name="contractor_id">${opts(contrs.filter((c) => c.kind === 'supplier' || c.kind === 'other').map((c) => [c.id, c.name]), '', '— не выбран —')}</select></div>
      <div class="field"><label>Накладная / комментарий</label><input name="note" placeholder="накл. 123 от 15.10"></div></div>
      <div class="row"><div class="field"><label>Оплата</label><select name="pay"><option value="now">Оплачено сейчас (расход в кассе)</option><option value="debt">В долг поставщику</option><option value="">Не учитывать оплату</option></select></div>
      <div class="field"><label>Способ</label><select name="method">${opts(Object.entries(WALLET), 'transfer')}</select></div></div>`,
    { wide: true, submit: 'Оприходовать', onSubmit: async (d) => {
      const r = await POST('/api/stock/receipt', { items: lines, note: d.note, pay: d.pay, method: d.method, contractor_id: d.contractor_id || null });
      toast('Оприходовано на ' + rub(r.sum)); load();
    } });
    const draw = () => {
      $('#rl', m.form).innerHTML = lines.length ? lines.map((l, i) => `<tr><td>${esc(l.name)}</td><td><input type="number" step="any" min="0" value="${l.qty}" data-i="${i}" data-k="qty"></td><td><input type="number" step="any" min="0" value="${l.cost}" data-i="${i}" data-k="cost"></td><td class="r mono">${num(l.qty * l.cost)}</td><td><button type="button" class="ghost sm" data-rm="${i}">✕</button></td></tr>`).join('') : '<tr><td colspan="5" class="muted">Пусто</td></tr>';
      $('#rsum', m.form).textContent = 'Итого: ' + rub(lines.reduce((s, l) => s + l.qty * l.cost, 0));
      $$('[data-k]', m.form).forEach((inp) => (inp.onchange = () => { lines[+inp.dataset.i][inp.dataset.k] = +inp.value; draw(); }));
      $$('[data-rm]', m.form).forEach((b) => (b.onclick = () => { lines.splice(+b.dataset.rm, 1); draw(); }));
    };
    autocomplete($('#rq', m.form), {
      search: (q) => GET('/api/products' + qs({ q })).then((r) => r.slice(0, 12)),
      render: (p) => `<div>${esc(p.name)}</div><div class="s">${esc(p.sku || '')} · остаток ${num(p.stock)} · закупка ${rub(p.cost)}</div>`,
      onPick: (p) => { lines.push({ product_id: p.id, name: p.name, qty: 1, cost: p.cost }); $('#rq', m.form).value = ''; draw(); },
    });
  };
  await load();
});

// ================= Услуги =================
route(/^\/services$/, async (page) => {
  const list = await GET('/api/services'); S.services = list;
  const cats = [...new Set(list.map((s) => s.category || 'Без категории'))];
  page.innerHTML = `<div class="topbar"><h1>Услуги и цены</h1><div class="sp"></div><input class="search" id="q" placeholder="Поиск услуги"><button class="primary" id="add">+ Услуга</button></div>
    <div id="list">${cats.map((c) => `<div class="card" data-cat><h3>${esc(c)}</h3><table class="tbl resp"><thead><tr><th>Услуга</th><th class="r">Цена</th><th class="r">Время</th><th class="r">Гарантия</th></tr></thead><tbody>
      ${list.filter((s) => (s.category || 'Без категории') === c).map((s) => `<tr class="click" data-id="${s.id}" data-n="${esc(s.name.toLowerCase())}" style="${s.active ? '' : 'opacity:.45'}"><td data-l="Услуга">${esc(s.name)}</td><td data-l="Цена" class="r mono">${rub(s.price)}</td>
      <td data-l="Время" class="r muted">${s.duration_min >= 60 ? (s.duration_min / 60).toLocaleString('ru-RU') + ' ч' : s.duration_min + ' мин'}</td><td data-l="Гарантия" class="r muted">${s.warranty_months ? s.warranty_months + ' мес.' : '—'}</td></tr>`).join('')}
      </tbody></table></div>`).join('')}</div>`;
  const svcModal = (s = { active: 1, duration_min: 60, warranty_months: 6 }) => modal(s.id ? 'Услуга' : 'Новая услуга', `
    <div class="field"><label>Название *</label><input name="name" required value="${esc(s.name || '')}"></div>
    <div class="row"><div class="field"><label>Категория</label><input name="category" list="scat" value="${esc(s.category || '')}"><datalist id="scat">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
    <div class="field"><label>Цена, ₽</label><input name="price" type="number" step="any" value="${s.price || 0}"></div></div>
    <div class="row"><div class="field"><label>Время, мин</label><input name="duration_min" type="number" value="${s.duration_min}"></div><div class="field"><label>Гарантия, мес.</label><input name="warranty_months" type="number" value="${s.warranty_months}"></div></div>
    <label class="inline" style="color:var(--text)"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Активна</label>`,
  { onSubmit: async (d) => { if (s.id) await PUT('/api/services/' + s.id, d); else await POST('/api/services', { ...d }); S.services = null; navigate(); } });
  $('#add', page).onclick = () => svcModal();
  $('#list', page).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) svcModal(list.find((x) => x.id === +tr.dataset.id)); };
  $('#q', page).oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $$('tr[data-n]', page).forEach((tr) => tr.classList.toggle('hidden', !tr.dataset.n.includes(q)));
    $$('[data-cat]', page).forEach((c) => c.classList.toggle('hidden', !$$('tr[data-n]:not(.hidden)', c).length));
  };
});

// ================= Сообщения сотрудникам =================
route(/^\/messages$/, async (page, query) => {
  let cur = query.u ? +query.u : null;
  let timer = null;
  const renderList = async () => {
    const list = await GET('/api/messages');
    $('#mlist', page).innerHTML = list.map((u) => `<div class="li click ${u.id === cur ? 'active' : ''}" data-u="${u.id}" style="${u.id === cur ? 'background:var(--accentbg)' : ''};padding:10px">
      <div class="grow"><div class="t">${esc(u.name)} ${u.unread ? `<span class="badge red">${u.unread}</span>` : ''}</div>
      <div class="s">${u.last_text ? esc(u.last_text) : `<span class="muted">${u.max ? 'MAX' : ''}${u.max && u.tg ? ' · ' : ''}${u.tg ? 'Telegram' : ''}${!u.max && !u.tg ? 'не подключён' : ''}</span>`}</div></div>
      ${u.max ? '<span class="badge ok" title="MAX подключён">MAX</span>' : ''}</div>`).join('');
    $$('[data-u]', page).forEach((el) => (el.onclick = () => { cur = +el.dataset.u; history.replaceState(null, '', '#/messages?u=' + cur); renderList(); renderThread(); }));
    return list;
  };
  const renderThread = async () => {
    const box = $('#thread', page);
    if (!cur) { box.innerHTML = '<div class="empty">Выберите сотрудника слева</div>'; return; }
    const msgs = await GET('/api/messages/' + cur);
    box.innerHTML = `<div class="chatlog" id="clog">${msgs.map((m) => `<div class="bubble ${m.direction}">${m.order_id ? `<a class="small" href="#/orders/${m.order_id}">${orderNo(m.order_id)}</a>\n` : ''}${esc(m.text)}<div class="meta">${dt(m.created_at)}${m.direction === 'out' ? ' · ' + esc(m.author || '') + ' · ' + esc((m.channel || '').replace('max', 'MAX').replace('telegram', 'Telegram')) : ''}</div></div>`).join('') || '<div class="empty">Переписки пока нет</div>'}</div>
      <form class="inline" id="mform" style="flex-wrap:nowrap;margin-top:10px"><textarea name="text" rows="2" placeholder="Сообщение… (Enter — отправить, Shift+Enter — новая строка)" style="min-height:44px"></textarea><button class="primary">Отправить</button></form>`;
    const log = $('#clog', box); log.scrollTop = log.scrollHeight;
    const f = $('#mform', box);
    f.text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
    f.onsubmit = async (e) => {
      e.preventDefault(); const text = f.text.value.trim(); if (!text) return;
      try { await POST('/api/messages/' + cur, { text }); f.text.value = ''; renderThread(); renderList(); } catch (err) { toast(err.message, true); }
    };
    refreshLeadsBadge();
  };
  page.innerHTML = `<div class="topbar"><h1>Сообщения</h1><div class="sp"></div><button id="bcast">📣 Рассылка нескольким</button></div>
    <div class="grid" style="grid-template-columns:minmax(220px,300px) 1fr;gap:14px"><div class="card" style="padding:4px;max-height:calc(100vh - 140px);overflow:auto"><div class="list" id="mlist"></div></div>
    <div class="card" id="thread"></div></div>`;
  const list = await renderList(); await renderThread();
  $('#bcast', page).onclick = () => modal('Рассылка сотрудникам', `
    <label>Кому</label><div class="checkgrid" style="margin-bottom:10px">${list.filter((u) => u.max || u.tg).map((u) => `<label class="ck"><input type="checkbox" name="to" value="${u.id}" ${u.role === 'master' || u.is_master ? 'checked' : ''}> ${esc(u.name)}</label>`).join('') || '<span class="muted">Никто ещё не подключил MAX или Telegram</span>'}</div>
    <div class="field"><label>Сообщение</label><textarea name="text" rows="4" required placeholder="Напр.: завтра собрание в 9:00"></textarea></div>`,
  { submit: 'Отправить', onSubmit: async (d, form) => {
    const ids = $$('input[name=to]:checked', form).map((x) => +x.value);
    if (!ids.length) { toast('Выберите получателей', true); return false; }
    const r = await POST('/api/messages-broadcast', { user_ids: ids, text: d.text });
    const bad = r.filter((x) => !x.ok);
    toast(bad.length ? `Отправлено ${r.length - bad.length}, не удалось: ${bad.length}` : `Отправлено: ${r.length}`, !!bad.length);
    renderList(); renderThread();
  } });
  timer = setInterval(() => { if (!location.hash.startsWith('#/messages')) return clearInterval(timer); renderList(); if (cur && !document.activeElement?.closest?.('#mform')) renderThread(); }, 15000);
});

// ================= Контрагенты =================
const balTxt = (b) => (Math.abs(b) < 0.5 ? '<span class="muted">0 ₽</span>' : b > 0 ? `<span style="color:var(--ok)">нам должны ${rub(b)}</span>` : `<span style="color:var(--bad)">мы должны ${rub(-b)}</span>`);
function contractorModal(c = { kind: 'supplier', active: 1 }, onDone) {
  const K = S.me.contractor_kinds;
  modal(c.id ? 'Контрагент' : 'Новый контрагент', `
    <div class="row"><div class="field"><label>Название *</label><input name="name" required value="${esc(c.name || '')}" placeholder="ООО «Автозвук», Саша Автодом…"></div>
    <div class="field"><label>Тип</label><select name="kind">${opts(Object.entries(K), c.kind)}</select></div></div>
    <div class="row"><div class="field"><label>Контактное лицо</label><input name="contact" value="${esc(c.contact || '')}"></div>
    <div class="field"><label>Телефон</label><input name="phone" value="${esc(c.phone || '')}"></div><div class="field"><label>ИНН</label><input name="inn" value="${esc(c.inn || '')}"></div></div>
    <div class="field"><label>Реквизиты</label><textarea name="requisites" rows="2">${esc(c.requisites || '')}</textarea></div>
    <div class="field"><label>Заметки</label><textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></div>
    ${c.id ? `<label class="inline" style="color:var(--text)"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Активен</label>` : ''}`,
  { onSubmit: async (d) => { if (!c.id) d.active = true; const r = c.id ? await PUT('/api/contractors/' + c.id, d) : await POST('/api/contractors', d); CACHE_CONTR = null; toast('Сохранено'); onDone ? onDone(r.id) : navigate(); } });
}

route(/^\/contractors$/, async (page) => {
  let kind = '';
  page.innerHTML = `<div class="topbar"><h1>Контрагенты</h1><div class="sp"></div><input class="search" id="q" placeholder="Название, ИНН, телефон"><button class="primary" id="add">+ Контрагент</button></div>
    <div class="grid g3" style="margin-bottom:14px" id="sum"></div>
    <div class="chips" style="margin-bottom:12px">${[['', 'Все'], ...Object.entries(S.me.contractor_kinds)].map(([k, t]) => `<button class="chip ${k === kind ? 'on' : ''}" data-k="${k}">${t}</button>`).join('')}</div>
    <div class="card" style="padding:4px 6px"><div class="tblwrap" id="list"></div></div>`;
  const load = async () => {
    const all = await GET('/api/contractors' + qs({ q: $('#q', page).value, all: 1 })); CACHE_CONTR = all.filter((c) => c.active);
    const rows = all.filter((c) => !kind || c.kind === kind);
    const they = all.reduce((s, c) => s + Math.max(c.balance, 0), 0), we = all.reduce((s, c) => s + Math.max(-c.balance, 0), 0);
    $('#sum', page).innerHTML = `<div class="kpi"><div class="l">Нам должны</div><div class="v ok">${rub(they)}</div></div><div class="kpi"><div class="l">Мы должны</div><div class="v bad">${rub(we)}</div></div><div class="kpi"><div class="l">Сальдо</div><div class="v ${they - we >= 0 ? 'acc' : 'bad'}">${rub(they - we)}</div></div>`;
    $('#list', page).innerHTML = rows.length ? `<table class="tbl resp"><thead><tr><th>Контрагент</th><th>Тип</th><th>Контакт</th><th class="r">Взаиморасчёты</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="click" data-id="${c.id}" style="${c.active ? '' : 'opacity:.45'}"><td data-l="Контрагент"><b>${esc(c.name)}</b>${c.inn ? `<div class="small muted">ИНН ${esc(c.inn)}</div>` : ''}</td>
      <td data-l="Тип">${esc(S.me.contractor_kinds[c.kind] || '')}</td><td data-l="Контакт">${esc([c.contact, c.phone].filter(Boolean).join(' · '))}</td><td data-l="Расчёты" class="r">${balTxt(c.balance)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Контрагентов пока нет. Добавьте поставщиков, партнёров и подрядчиков.</div>';
  };
  $('#q', page).oninput = debounce(load, 300);
  $$('[data-k]', page).forEach((b) => (b.onclick = () => { kind = b.dataset.k; $$('[data-k]', page).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  $('#add', page).onclick = () => contractorModal(undefined, (id) => go('/contractors/' + id));
  $('#list', page).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) go('/contractors/' + tr.dataset.id); };
  await load();
});

route(/^\/contractors\/(\d+)$/, async (page, id) => {
  const c = await GET('/api/contractors/' + id);
  let bal = 0;
  const ledger = c.ledger.map((x) => { bal += x.they - x.we; return { ...x, bal }; }).reverse();
  page.innerHTML = `<div class="topbar"><button class="ghost" onclick="history.back()">←</button><h1>${esc(c.name)}</h1><span class="badge">${esc(S.me.contractor_kinds[c.kind] || '')}</span><div class="sp"></div>
    <button id="edit">Изменить</button><button id="sv">🖨 Акт сверки</button></div>
  <div class="grid g3" style="margin-bottom:14px">
    <div class="kpi"><div class="l">Нам должны</div><div class="v ok">${rub(Math.max(c.they_owe, 0))}</div></div>
    <div class="kpi"><div class="l">Мы должны</div><div class="v bad">${rub(Math.max(c.we_owe, 0))}</div></div>
    <div class="kpi"><div class="l">Итог</div><div class="v" style="font-size:18px">${balTxt(c.balance)}</div></div></div>
  <div class="grid g-main"><div>
    <div class="card"><div class="inline" style="margin-bottom:10px"><h2 style="margin:0;flex:1">Взаиморасчёты</h2>
      <button class="sm" data-op="we_owe">+ Получили товар/услугу</button><button class="sm" data-op="they_owe">+ Начислить им</button>
      <button class="sm" data-op="pay_out">Оплатить им</button><button class="sm primary" data-op="pay_in">Получить оплату</button></div>
      ${ledger.length ? `<div class="tblwrap"><table class="tbl resp"><thead><tr><th>Дата</th><th>Операция</th><th class="r">Нам должны</th><th class="r">Мы должны</th><th class="r">Сальдо</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
      ${ledger.map((x) => `<tr><td data-l="Дата" class="nowrap">${dmy(x.d)}</td><td data-l="Операция">${x.src === 'order' || x.src === 'opay' ? `<a href="#/orders/${x.order_id || x.id}">${esc(x.text)}</a>` : esc(x.text)}${x.note ? ` <span class="muted small">${esc(x.note)}</span>` : ''}</td>
        <td data-l="Нам должны" class="r mono">${x.they ? (x.they > 0 ? '+' : '−') + num(Math.abs(x.they)) : ''}</td><td data-l="Мы должны" class="r mono">${x.we ? (x.we > 0 ? '+' : '−') + num(Math.abs(x.we)) : ''}</td>
        <td data-l="Сальдо" class="r mono" style="color:${x.bal >= 0 ? 'var(--ok)' : 'var(--bad)'}">${num(x.bal)}</td>
        ${isAdmin() ? `<td>${x.src === 'op' ? `<button class="ghost sm danger" data-delop="${x.id}">✕</button>` : x.src === 'pay' ? `<button class="ghost sm danger" data-delpay="${x.id}">✕</button>` : ''}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Операций пока нет</div>'}</div>
    ${c.orders.length ? `<div class="card"><h2>Заказ-наряды контрагента</h2><table class="tbl resp"><thead><tr><th>№</th><th>Статус</th><th>Авто</th><th class="r">Сумма</th><th class="r">Оплачено</th></tr></thead><tbody>
      ${c.orders.map((o) => `<tr class="click" data-o="${o.id}"><td data-l="№"><b>${orderNo(o.id)}</b></td><td data-l="Статус">${stBadge(o.status)}</td><td data-l="Авто">${esc(carStr(o))} <span class="muted small">${esc(o.client || '')}</span></td><td data-l="Сумма" class="r mono">${rub(o.total)}</td><td data-l="Оплачено" class="r mono">${rub(o.paid)}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div><div>
    <div class="card"><h2>Реквизиты</h2>
      ${c.contact || c.phone ? `<div class="field">${esc(c.contact || '')} ${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ''}</div>` : ''}
      ${c.inn ? `<div class="field">ИНН ${esc(c.inn)}</div>` : ''}
      ${c.requisites ? `<div class="field small" style="white-space:pre-wrap">${esc(c.requisites)}</div>` : ''}
      ${c.notes ? `<div class="small muted" style="white-space:pre-wrap">${esc(c.notes)}</div>` : ''}
      <div class="small muted" style="margin-top:10px">Заказ-наряд можно привязать к контрагенту в карточке заказа — неоплаченные выданные заказы попадут в его долг. Приход товара от поставщика в долг оформляется на складе.</div></div>
  </div></div>`;
  $('#edit', page).onclick = () => contractorModal(c);
  $('#sv', page).onclick = () => modal('Акт сверки', `<div class="row"><div class="field"><label>С</label><input type="date" name="from" value="${today().slice(0, 5)}01-01"></div><div class="field"><label>По</label><input type="date" name="to" value="${today()}"></div></div>`,
    { submit: 'Сформировать', onSubmit: (d) => { window.open(`/print/contractor/${c.id}/sverka?from=${d.from}&to=${d.to}`, '_blank'); } });
  const T = { we_owe: 'Получили товар / услугу (мы должны)', they_owe: 'Начислить контрагенту (он должен нам)', pay_out: 'Оплата контрагенту (расход из кассы)', pay_in: 'Оплата от контрагента (приход в кассу)' };
  $$('[data-op]', page).forEach((b) => (b.onclick = () => { const t = b.dataset.op; modal(T[t], `
    <div class="row"><div class="field"><label>Сумма, ₽</label><input type="number" name="amount" step="any" min="0.01" required></div><div class="field"><label>Дата</label><input type="date" name="date" value="${today()}"></div>
    ${t.startsWith('pay') ? `<div class="field"><label>Способ</label><select name="method">${opts(Object.entries(WALLET), 'transfer')}</select></div>` : ''}</div>
    <div class="field"><label>Основание / комментарий</label><input name="note" placeholder="${t === 'we_owe' ? 'Накладная №…, печать стоек, ламинация карбона…' : 'Счёт №…'}"></div>`,
  { onSubmit: async (d) => { await POST(`/api/contractors/${c.id}/op`, { ...d, type: t }); CACHE_CONTR = null; toast('Проведено'); navigate(); } }); }));
  $$('[data-o]', page).forEach((e) => (e.onclick = () => go('/orders/' + e.dataset.o)));
  $$('[data-delop]', page).forEach((b) => (b.onclick = async () => { if (await confirmBox('Удалить операцию?', 'Удалить')) { await DEL('/api/contractor-ops/' + b.dataset.delop); navigate(); } }));
  $$('[data-delpay]', page).forEach((b) => (b.onclick = async () => { if (await confirmBox('Удалить платёж из кассы?', 'Удалить')) { await DEL('/api/payments/' + b.dataset.delpay); navigate(); } }));
});

// ================= Гарантия =================
let WMETA = null;
async function wMeta(force) { if (!WMETA || force) WMETA = await GET('/api/warranty/meta'); return WMETA; }
const W_ST_CLS = { received: 'warn', sent: '', returned: 'ok', closed: '' };
const wBadge = (st) => `<span class="badge ${W_ST_CLS[st] || ''}">${esc((WMETA && WMETA.statuses[st]) || st)}</span>`;
// Дни с приёма: до 30 — обычно, 30+ — жёлтый, 40+ — красный, 45+ — красный с заливкой
function wDays(w) {
  if (w.status === 'closed') return '<span class="muted">—</span>';
  const d = w.days;
  const cls = d >= 45 ? 'red' : d >= 40 ? 'red' : d >= 30 ? 'warn' : '';
  const st = d >= 40 && d < 45 ? 'style="background:rgba(231,76,60,.16);color:var(--bad)"' : '';
  return `<span class="badge ${cls}" ${st} title="Дней с момента приёма">${d} дн.</span>`;
}

async function warrantyModal(c = {}, onDone) {
  const meta = await wMeta();
  const contrs = await contractorsList();
  const sups = [...contrs].sort((a, b) => (a.kind === 'supplier' ? 0 : 1) - (b.kind === 'supplier' ? 0 : 1) || a.name.localeCompare(b.name));
  const defResp = c.id ? c.responsible_id : (meta.controllers[0] || {}).id;
  modal(c.id ? `Гарантия ${c.number}` : 'Приём товара на гарантию', `
    <input type="hidden" name="client_id" value="${esc(c.client_id || '')}"><input type="hidden" name="product_id" value="${esc(c.product_id || '')}">
    <input type="hidden" name="order_id" value="${esc(c.order_id || '')}">
    <div class="row"><div class="field"><label>Дата приёма *</label><input type="date" name="received_at" required value="${esc((c.received_at || today()).slice(0, 10))}"></div>
      <div class="field"><label>Поставщик</label><select name="contractor_id">${opts(sups.map((k) => [k.id, k.name + (k.kind !== 'supplier' ? ' (' + (S.me.contractor_kinds[k.kind] || '') + ')' : '')]), c.contractor_id, '— выберите —')}</select>
        <div class="small"><a href="#" id="newSup">+ новый поставщик</a></div></div></div>
    <div class="field"><label>Клиент</label><input id="wcq" placeholder="Поиск: имя, телефон, госномер" value="${esc(c.client_id ? [c.client_name, c.client_phone].filter(Boolean).join(' · ') : '')}"></div>
    <div class="row"><div class="field"><label>Имя клиента</label><input name="client_name" value="${esc(c.client_name || '')}"></div>
      <div class="field"><label>Телефон</label><input name="client_phone" value="${esc(c.client_phone || '')}"></div></div>
    <div class="field"><label>Товар *</label><input name="product_name" id="wpq" required value="${esc(c.product_name || '')}" placeholder="Начните вводить — подскажем со склада"></div>
    <div class="row"><div class="field"><label>Серийный номер</label><input name="serial" value="${esc(c.serial || '')}"></div>
      <div class="field"><label>Кол-во</label><input type="number" name="qty" min="1" step="any" value="${esc(c.qty || 1)}"></div>
      <div class="field"><label>Дата продажи / установки</label><input type="date" name="sale_date" value="${esc(c.sale_date || '')}"></div></div>
    <div class="field"><label>Неисправность со слов клиента</label><textarea name="defect" rows="2" placeholder="Не включается, хрипит левый канал, нет звука…">${esc(c.defect || '')}</textarea></div>
    <div class="field"><label>Комплектность, внешний вид</label><textarea name="kit" rows="2" placeholder="Коробка, провода, пульт; царапины на корпусе…">${esc(c.kit || '')}</textarea></div>
    <div class="row"><div class="field"><label>Ответственный (контроль сроков)</label><select name="responsible_id">${opts(S.staff.filter((u) => u.role !== 'master').map((u) => [u.id, u.name]), defResp, '—')}</select></div>
      <div class="field"><label>Заметки</label><input name="notes" value="${esc(c.notes || '')}"></div></div>
    ${c.order_id ? `<div class="small muted">Связан с заказом <a href="#/orders/${c.order_id}">${orderNo(c.order_id)}</a></div>` : ''}`,
  { wide: true, submit: c.id ? 'Сохранить' : 'Принять на гарантию',
    onOpen: (f) => {
      autocomplete($('#wcq', f), {
        search: async (q) => (await GET('/api/clients' + qs({ q, limit: 10 }))).rows,
        render: (x) => `<div>${esc(x.name)} <span class="s">${esc(x.phone || '')}</span></div><div class="s">${esc(x.cars || '')}</div>`,
        onPick: (x) => { f.client_id.value = x.id; f.client_name.value = x.name; f.client_phone.value = x.phone || ''; $('#wcq', f).value = x.name + (x.phone ? ' · ' + x.phone : ''); },
      });
      $('#wcq', f).addEventListener('input', () => { f.client_id.value = ''; });
      autocomplete($('#wpq', f), {
        search: async (q) => (q.length < 2 ? [] : (await GET('/api/products' + qs({ q }))).slice(0, 12)),
        render: (p) => `<div>${esc(p.name)}</div><div class="s">${esc([p.sku, p.brand, p.warranty_months ? 'гарантия ' + p.warranty_months + ' мес.' : ''].filter(Boolean).join(' · '))}</div>`,
        onPick: (p) => { f.product_id.value = p.id; $('#wpq', f).value = p.name; },
      });
      $('#wpq', f).addEventListener('input', () => { f.product_id.value = ''; });
      $('#newSup', f).onclick = (e) => { e.preventDefault(); contractorModal({ kind: 'supplier', active: 1 }, async (id) => {
        CACHE_CONTR = null; const list = await contractorsList(); const k = list.find((x) => x.id === id);
        if (k) { f.contractor_id.insertAdjacentHTML('beforeend', `<option value="${k.id}">${esc(k.name)}</option>`); f.contractor_id.value = k.id; } }); };
    },
    onSubmit: async (d) => {
      const r = c.id ? await PUT('/api/warranty/' + c.id, d) : await POST('/api/warranty', d);
      toast(c.id ? 'Сохранено' : 'Принято на гарантию'); refreshLeadsBadge();
      onDone ? onDone(r.id) : navigate();
    } });
}

function warrantySettingsModal(meta) {
  const cur = (meta.controller_ids || '').split(',').filter(Boolean).map(Number);
  const staff = S.staff.filter((u) => u.role !== 'master' || cur.includes(u.id));
  const auto = !cur.length && meta.controllers.length ? meta.controllers.map((u) => u.id) : cur;
  modal('Напоминания по гарантии', `
    <p class="small muted">Напоминание приходит в MAX (если MAX не подключён — в Telegram) контролёрам и ответственному по случаю, пока товар не выдан клиенту. Отсчёт — от даты приёма. По закону срок — не более ${meta.legal_days} дней.</p>
    <div class="field"><label>Кого напоминать</label>${staff.map((u) => `<label class="inline" style="color:var(--text)"><input type="checkbox" name="c_${u.id}" ${auto.includes(u.id) ? 'checked' : ''}> ${esc(u.name)} ${u.max ? '<span class="badge ok">MAX</span>' : '<span class="badge warn">MAX не подключён</span>'}</label>`).join('')}</div>
    <div class="row"><div class="field"><label>На какой день (через запятую)</label><input name="days" value="${esc(meta.days)}"></div>
      <div class="field"><label>Время отправки</label><input type="time" name="time" value="${esc(meta.time)}"></div></div>`,
  { onSubmit: async (d) => {
    const ids = Object.keys(d).filter((k) => k.startsWith('c_') && d[k]).map((k) => +k.slice(2));
    await PUT('/api/warranty/settings', { controllers: ids, days: d.days, time: d.time }); await wMeta(true); toast('Сохранено'); navigate();
  } });
}

route(/^\/warranty$/, async (page, query) => {
  const meta = await wMeta(true);
  let status = query.status || 'open', sup = '';
  const contrs = await contractorsList();
  const ctl = meta.controllers.map((u) => esc(u.name) + (u.max ? '' : ' <span class="badge warn" title="Не подключён к MAX">нет MAX</span>')).join(', ');
  page.innerHTML = `<div class="topbar"><h1>Гарантия</h1><div class="sp"></div><input class="search" id="q" placeholder="Товар, S/N, клиент, номер">
    ${isAdmin() ? '<button id="wset">🔔 Напоминания</button>' : ''}<button class="primary" id="add">+ Принять на гарантию</button></div>
    <div class="grid g4" style="margin-bottom:14px" id="sum"></div>
    <div class="inline" style="margin-bottom:12px;flex-wrap:wrap;gap:8px"><div class="chips">${[['open', 'Открытые'], ...Object.entries(meta.statuses), ['', 'Все']].map(([k, t]) => `<button class="chip ${k === status ? 'on' : ''}" data-s="${k}">${t}</button>`).join('')}</div>
      <div class="sp"></div><select id="sup" style="max-width:240px">${opts(contrs.map((k) => [k.id, k.name]), '', 'Все поставщики')}</select></div>
    <div class="card" style="padding:4px 6px"><div class="tblwrap" id="list"></div></div>
    <div class="small muted" style="margin-top:8px">Напоминания в MAX: ${ctl || '<span style="color:var(--bad)">контролёр не выбран</span>'} — на ${esc(meta.days.split(',').join(', '))} день с приёма, в ${esc(meta.time)}.</div>`;
  const load = async () => {
    const s = await GET('/api/warranty/summary');
    $('#sum', page).innerHTML = `<div class="kpi"><div class="l">Открытых случаев</div><div class="v">${s.open}</div></div>
      <div class="kpi"><div class="l">У поставщиков</div><div class="v">${s.at_supplier}</div></div>
      <div class="kpi"><div class="l">Больше 30 дней</div><div class="v ${s.over30 ? 'bad' : ''}">${s.over30}</div></div>
      <div class="kpi"><div class="l">Срок 45 дней истёк</div><div class="v ${s.over45 ? 'bad' : 'ok'}">${s.over45}</div></div>`;
    const rows = await GET('/api/warranty' + qs({ status, contractor_id: sup, q: $('#q', page).value }));
    $('#list', page).innerHTML = rows.length ? `<table class="tbl resp"><thead><tr><th>№</th><th>Принят</th><th>Дней</th><th>Товар</th><th>Клиент</th><th>Поставщик</th><th>Статус</th></tr></thead><tbody>
      ${rows.map((w) => `<tr class="click" data-id="${w.id}" style="${w.status === 'closed' ? 'opacity:.55' : ''}"><td data-l="№"><b>${esc(w.number)}</b></td><td data-l="Принят" class="nowrap">${dmy(w.received_at)}</td><td data-l="Дней">${wDays(w)}</td>
        <td data-l="Товар">${esc(w.product_name)}${w.serial ? `<div class="small muted">S/N ${esc(w.serial)}</div>` : ''}</td>
        <td data-l="Клиент">${esc(w.client_name || '')}${w.client_phone ? `<div class="small muted">${esc(w.client_phone)}</div>` : ''}</td>
        <td data-l="Поставщик">${w.supplier ? esc(w.supplier) : '<span class="muted">не выбран</span>'}${w.sent_at ? `<div class="small muted">передан ${dmy(w.sent_at)}</div>` : ''}</td>
        <td data-l="Статус">${wBadge(w.status)}</td></tr>`).join('')}</tbody></table>`
      : `<div class="empty">${status === 'open' ? 'Открытых гарантийных случаев нет' : 'Ничего не найдено'}</div>`;
  };
  $$('[data-s]', page).forEach((b) => (b.onclick = () => { status = b.dataset.s; $$('[data-s]', page).forEach((x) => x.classList.toggle('on', x === b)); load(); }));
  $('#sup', page).onchange = (e) => { sup = e.target.value; load(); };
  $('#q', page).oninput = debounce(load, 300);
  $('#add', page).onclick = () => warrantyModal({}, (id) => go('/warranty/' + id));
  const ws = $('#wset', page); if (ws) ws.onclick = () => warrantySettingsModal(meta);
  $('#list', page).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) go('/warranty/' + tr.dataset.id); };
  await load();
});

route(/^\/warranty\/(\d+)$/, async (page, id) => {
  const meta = await wMeta();
  const c = await GET('/api/warranty/' + id);
  const left = meta.legal_days - c.days;
  const steps = [['received', 'Принят от клиента', c.received_at], ['sent', 'Передан поставщику', c.sent_at], ['returned', 'Вернулся от поставщика', c.returned_at], ['closed', 'Выдан клиенту', c.closed_at]];
  const curI = steps.findIndex((s) => s[0] === c.status);
  const next = { received: ['sent', '📦 Передать поставщику'], sent: ['returned', '↩️ Вернулся от поставщика'], returned: ['closed', '✅ Выдать клиенту / закрыть'] }[c.status];
  const contrs = await contractorsList();
  page.innerHTML = `<div class="topbar"><button class="ghost" onclick="history.back()">←</button><h1>Гарантия ${esc(c.number)}</h1>${wBadge(c.status)}<div class="sp"></div>
    <a class="btn sm" target="_blank" href="/print/warranty/${c.id}/accept">🖨 Акт приёма</a><a class="btn sm" target="_blank" href="/print/warranty/${c.id}/supplier">🖨 Акт поставщику</a>
    <button id="edit">Изменить</button>${isAdmin() ? '<button class="ghost danger" id="del">Удалить</button>' : ''}</div>
  <div class="grid g4" style="margin-bottom:14px">
    <div class="kpi"><div class="l">Принят</div><div class="v" style="font-size:18px">${dmy(c.received_at)}</div></div>
    <div class="kpi"><div class="l">Прошло дней</div><div class="v ${c.status === 'closed' ? '' : c.days >= 40 ? 'bad' : c.days >= 30 ? '' : 'acc'}" ${c.status !== 'closed' && c.days >= 30 && c.days < 40 ? 'style="color:var(--warn)"' : ''}>${c.days}</div></div>
    <div class="kpi"><div class="l">Срок ${meta.legal_days} дней</div><div class="v" style="font-size:18px">${dmy(c.deadline)}</div><div class="small ${left < 0 && c.status !== 'closed' ? 'bad' : 'muted'}">${c.status === 'closed' ? 'закрыт ' + dmy(c.closed_at) : left >= 0 ? 'осталось ' + left + ' дн.' : 'просрочено на ' + -left + ' дн.'}</div></div>
    <div class="kpi"><div class="l">Поставщик</div><div class="v" style="font-size:16px">${c.supplier ? `<a href="#/contractors/${c.contractor_id}">${esc(c.supplier)}</a>` : '<span class="muted">не выбран</span>'}</div>${c.supplier_phone ? `<div class="small"><a href="tel:${esc(c.supplier_phone)}">${esc(c.supplier_phone)}</a></div>` : ''}</div></div>
  <div class="card" style="margin-bottom:14px"><div class="pipe">${steps.map((s, i) => `<button type="button" class="${i === curI ? 'cur' : ''}" data-st="${s[0]}" ${i < curI ? 'style="opacity:.7"' : ''}>${i <= curI && s[2] ? '✓ ' : ''}${s[1]}${s[2] ? `<span class="small" style="display:block;opacity:.75">${dmy(s[2])}</span>` : ''}</button>`).join('')}</div>
    <div class="inline" style="margin-top:10px">${next ? `<button class="primary" id="next">${next[1]}</button>` : ''}<button id="remind">🔔 Напомнить в MAX сейчас</button></div></div>
  <div class="grid g-main"><div>
    <div class="card"><h2>Товар</h2>
      <div class="field"><b style="font-size:16px">${esc(c.product_name)}</b>${c.qty > 1 ? ` × ${num(c.qty)}` : ''}</div>
      ${c.serial ? `<div class="field">S/N: <span class="mono">${esc(c.serial)}</span></div>` : ''}
      ${c.sale_date ? `<div class="field">Продан / установлен: ${dmy(c.sale_date)}</div>` : ''}
      ${c.order_id ? `<div class="field">Заказ: <a href="#/orders/${c.order_id}">${orderNo(c.order_id)}</a></div>` : ''}
      <h3>Неисправность</h3><div style="white-space:pre-wrap">${esc(c.defect || '—')}</div>
      <h3>Комплектность, внешний вид</h3><div style="white-space:pre-wrap">${esc(c.kit || '—')}</div>
      ${c.sent_doc ? `<h3>Документ передачи / трек</h3><div>${esc(c.sent_doc)}</div>` : ''}
      ${c.outcome || c.outcome_note ? `<h3>Результат</h3><div>${esc(meta.outcomes[c.outcome] || '')} ${esc(c.outcome_note || '')}</div>` : ''}
      ${c.notes ? `<h3>Заметки</h3><div style="white-space:pre-wrap">${esc(c.notes)}</div>` : ''}</div>
    <div class="card"><h2>История</h2>
      <form id="cm" class="inline" style="margin-bottom:10px;flex-wrap:nowrap"><input name="text" placeholder="Комментарий: звонил поставщику, ответили…"><button class="sm">Добавить</button></form>
      <div class="list">${c.log.map((l) => `<div class="li"><div class="grow"><div class="t" style="font-weight:400;white-space:pre-wrap">${esc(l.text)}</div><div class="s">${dt(l.created_at)}${l.user ? ' · ' + esc(l.user) : ''}</div></div></div>`).join('')}</div></div>
  </div><div>
    <div class="card"><h2>Клиент</h2>
      <div class="field"><b>${c.client_id ? `<a href="#/clients/${c.client_id}">${esc(c.client_name || '')}</a>` : esc(c.client_name || '—')}</b></div>
      ${c.client_phone ? `<div class="field"><a href="tel:${esc(c.client_phone)}">${esc(c.client_phone)}</a></div>` : ''}</div>
    <div class="card"><h2>Контроль сроков</h2>
      <div class="field">Ответственный: <b>${esc(c.responsible || '—')}</b></div>
      <div class="small muted">Напоминания: ${esc(meta.days.split(',').join(', '))} день → ${meta.controllers.map((u) => esc(u.name)).join(', ') || 'контролёр не выбран'}</div>
      ${c.reminders.length ? `<div class="list" style="margin-top:8px">${c.reminders.map((r) => `<div class="li"><div class="grow"><div class="t">🔔 ${r.day} день</div><div class="s">${dt(r.sent_at)} · ${esc(r.channels || '')}</div></div></div>`).join('')}</div>` : ''}</div>
  </div></div>`;

  const statusModal = (st) => {
    const titles = { sent: 'Передача поставщику', returned: 'Товар вернулся от поставщика', closed: 'Выдача клиенту / закрытие', received: 'Вернуть в «Принят от клиента»' };
    modal(titles[st], `<div class="row"><div class="field"><label>Дата</label><input type="date" name="date" value="${today()}"></div>
      ${st === 'sent' ? `<div class="field"><label>Поставщик</label><select name="contractor_id">${opts(contrs.map((k) => [k.id, k.name]), c.contractor_id, '— выберите —')}</select></div>` : ''}</div>
      ${st === 'sent' ? `<div class="field"><label>№ накладной / акта / трек-номер</label><input name="sent_doc" value="${esc(c.sent_doc || '')}" placeholder="СДЭК 1234567890, акт №…"></div>` : ''}
      ${st === 'returned' || st === 'closed' ? `<div class="field"><label>Результат</label><select name="outcome">${opts(Object.entries(meta.outcomes), c.outcome, '—')}</select></div>
        <div class="field"><label>Комментарий</label><input name="outcome_note" value="${esc(c.outcome_note || '')}" placeholder="Заменили на новый S/N…, деньги вернули на карту…"></div>` : ''}`,
    { submit: 'Сохранить', onSubmit: async (d) => {
      if (st === 'sent' && !d.contractor_id) { toast('Выберите поставщика', true); return false; }
      await POST(`/api/warranty/${c.id}/status`, { ...d, status: st }); toast('Готово'); navigate();
    } });
  };
  const nb = $('#next', page); if (nb) nb.onclick = () => statusModal(next[0]);
  $$('[data-st]', page).forEach((b) => (b.onclick = () => { if (b.dataset.st !== c.status) statusModal(b.dataset.st); }));
  $('#edit', page).onclick = () => warrantyModal(c);
  const del = $('#del', page); if (del) del.onclick = async () => { if (await confirmBox(`Удалить гарантийный случай ${c.number}?`, 'Удалить')) { await DEL('/api/warranty/' + c.id); go('/warranty'); } };
  $('#remind', page).onclick = async () => { try { const r = await POST(`/api/warranty/${c.id}/remind`); toast('Отправлено: ' + r.used.join('; ')); navigate(); } catch (e) { toast(e.message, true); } };
  $('#cm', page).onsubmit = async (e) => { e.preventDefault(); const t = e.target.text.value.trim(); if (!t) return; await POST(`/api/warranty/${c.id}/comment`, { text: t }); navigate(); };
});

// ================= Финансы =================
function periodBar(page, from, to, onChange) {
  const t = nowTz();
  const presets = {
    'Сегодня': [today(), today()],
    'Неделя': [ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7))), today()],
    'Месяц': [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), today()],
    'Прошлый месяц': [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))],
    'Год': [ymd(new Date(t.getFullYear(), 0, 1)), today()],
  };
  return `<div class="inline"><div class="chips">${Object.keys(presets).map((k) => `<button class="chip ${presets[k][0] === from && presets[k][1] === to ? 'on' : ''}" data-pr="${k}">${k}</button>`).join('')}</div>
    <input type="date" id="pf" value="${from}" style="width:auto"> — <input type="date" id="pt" value="${to}" style="width:auto"></div>`;
}
function bindPeriod(page, cb) {
  const t = nowTz();
  const presets = {
    'Сегодня': [today(), today()],
    'Неделя': [ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7))), today()],
    'Месяц': [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), today()],
    'Прошлый месяц': [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))],
    'Год': [ymd(new Date(t.getFullYear(), 0, 1)), today()],
  };
  $$('[data-pr]', page).forEach((b) => (b.onclick = () => cb(...presets[b.dataset.pr])));
  $('#pf', page).onchange = $('#pt', page).onchange = () => cb($('#pf', page).value, $('#pt', page).value);
}
const monthStart = () => today().slice(0, 8) + '01';

route(/^\/finance$/, async (page, query) => {
  const from = query.from || monthStart(), to = query.to || today();
  const [r, pays, mb] = await Promise.all([GET('/api/reports/finance' + qs({ from, to })), GET('/api/payments' + qs({ from, to })), GET('/api/money/balances' + qs({ from, to }))]);
  const inc = r.byMethod.filter((x) => x.direction === 'in').reduce((s, x) => s + x.s, 0);
  const exp = r.byMethod.filter((x) => x.direction === 'out').reduce((s, x) => s + x.s, 0);
  const s = r.sales; const revenue = s.services + s.goods; const goodsMargin = s.goods - s.goods_cost;
  const maxDay = Math.max(1, ...r.daily.map((d) => d.inc + d.exp));
  const byM = (dir) => Object.entries(METHODS).map(([k, t]) => [t, r.byMethod.find((x) => x.direction === dir && x.method === k)?.s || 0]);
  const catList = (dir) => r.byCategory.filter((x) => x.direction === dir);
  const maxCat = Math.max(1, ...r.byCategory.map((x) => x.s));
  page.innerHTML = `<div class="topbar"><h1>Финансы</h1><a class="btn sm" href="#/finance/bank">🏦 Банк${mb.bank_new ? ` <span class="badge red">${mb.bank_new}</span>` : ''}</a><div class="sp"></div>${periodBar(page, from, to)}</div>
  <div class="card"><div class="inline" style="margin-bottom:10px;flex-wrap:wrap"><h2 style="margin:0;flex:1">Деньги в кассах</h2>
      <button class="sm" id="cashOut">💵 Обналичить</button><button class="sm" id="moveMoney">⇄ Перемещение</button>${isAdmin() ? '<button class="sm" id="reconcile">✓ Сверка остатков</button>' : ''}</div>
    <div class="grid g4" style="margin-bottom:12px">${Object.entries(WALLET).map(([k, t]) => `<div class="kpi"><div class="l">${t} — сейчас</div><div class="v ${mb.now[k] < 0 ? 'bad' : ''}">${rub(mb.now[k])}</div></div>`).join('')}
      <div class="kpi"><div class="l">Всего денег</div><div class="v acc">${rub(Object.values(mb.now).reduce((a, b) => a + b, 0))}</div></div></div>
    <div class="tblwrap"><table class="tbl resp"><thead><tr><th>За период</th><th class="r">На начало</th><th class="r">Приход</th><th class="r">Расход</th><th class="r">Перемещения</th><th class="r">Корректировки</th><th class="r">На конец</th></tr></thead><tbody>
    ${mb.period.map((w) => `<tr><td data-l="Касса"><b>${w.name}</b></td><td data-l="На начало" class="r mono">${num(w.open)}</td><td data-l="Приход" class="r mono" style="color:var(--ok)">${w.inc ? '+' + num(w.inc) : '—'}</td><td data-l="Расход" class="r mono" style="color:var(--bad)">${w.exp ? '−' + num(w.exp) : '—'}</td>
      <td data-l="Перемещения" class="r mono">${w.t_in || w.t_out ? `${w.t_in ? '+' + num(w.t_in) : ''}${w.t_in && w.t_out ? ' / ' : ''}${w.t_out ? '−' + num(w.t_out) : ''}` : '—'}${w.fee ? `<div class="small muted">в т.ч. комиссия ${num(w.fee)}</div>` : ''}</td>
      <td data-l="Корректировки" class="r mono">${w.adj ? (w.adj > 0 ? '+' : '−') + num(Math.abs(w.adj)) : '—'}</td><td data-l="На конец" class="r mono"><b>${num(w.close)}</b></td></tr>`).join('')}
    </tbody></table></div>
    ${mb.moves.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">Обналичивания, перемещения и сверки за период (${mb.moves.length})</summary><table class="tbl resp" style="margin-top:6px"><tbody>
      ${mb.moves.map((m) => `<tr><td data-l="Дата" class="nowrap">${dt(m.created_at)}</td><td data-l="Операция">${m.kind === 'adjust' ? `Корректировка · ${METHODS[m.to_method]}` : `${METHODS[m.from_method]} → ${METHODS[m.to_method]}${m.to_method === 'cash' ? ' (обналичивание)' : ''}`} <span class="muted">${esc(m.note || '')}${m.user ? ' · ' + esc(m.user) : ''}</span></td>
      <td data-l="Сумма" class="r mono">${m.kind === 'adjust' ? (m.amount > 0 ? '+' : '−') + num(Math.abs(m.amount)) : num(m.amount)}${m.fee ? `<div class="small muted">комиссия ${num(m.fee)}</div>` : ''}</td>${isAdmin() ? `<td><button class="ghost sm danger" data-delm="${m.id}">✕</button></td>` : ''}</tr>`).join('')}
    </tbody></table></details>` : ''}
    <div class="small muted" style="margin-top:8px">Остаток = приходы − расходы ± перемещения ± корректировки. Наличные — оплата наличными; Карта — переводы на карту (без эквайринга); Расчётный счёт — оплаты через терминал (эквайринг списывается отсюда же) и безналичные платежи. Для старта сделайте «Сверку остатков» и внесите фактические суммы.</div></div>
  <div class="grid g4" style="margin-bottom:14px">
    <div class="kpi"><div class="l">Поступления</div><div class="v ok">${rub(inc)}</div></div>
    <div class="kpi"><div class="l">Расходы</div><div class="v bad">${rub(exp)}</div></div>
    <div class="kpi"><div class="l">Сальдо периода</div><div class="v ${inc - exp >= 0 ? 'acc' : 'bad'}">${rub(inc - exp)}</div></div>
    <div class="kpi"><div class="l">Средний чек</div><div class="v">${rub(s.orders ? revenue / s.orders : 0)}</div></div></div>
  <div class="grid g4" style="margin-bottom:14px">
    <a class="kpi" href="#/contractors" style="color:inherit;text-decoration:none"><div class="l">Долг перед контрагентами</div><div class="v bad">${rub(r.contractors.we_owe)}</div></a>
    <a class="kpi" href="#/contractors" style="color:inherit;text-decoration:none"><div class="l">Контрагенты должны нам</div><div class="v ok">${rub(r.contractors.they_owe)}</div></a>
    <div class="kpi"><div class="l">Склад по закупке</div><div class="v">${rub(r.stockValue.cost)}</div></div>
    <div class="kpi"><div class="l">Склад по рознице</div><div class="v">${rub(r.stockValue.retail)}</div></div></div>
  <div class="grid g-main"><div>
    <div class="card"><h2>Движение денег по дням</h2>${r.daily.length ? `<div class="bars">${r.daily.map((d) => `<div class="b" data-t="${dmy(d.d)}\nприход ${rub(d.inc)}\nрасход ${rub(d.exp)}"><i class="in" style="height:${d.inc / maxDay * 130}px"></i><i class="out" style="height:${d.exp / maxDay * 130}px"></i></div>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--accent)"></i>Приход</span><span><i style="background:#4a5160"></i>Расход</span></div>` : '<div class="empty">Нет движения денег</div>'}</div>
    <div class="card"><div class="inline" style="margin-bottom:10px"><h2 style="margin:0;flex:1">Журнал кассы</h2><button class="sm" id="addIn">+ Приход</button><button class="sm" id="addOut">+ Расход</button></div>
      ${pays.length ? `<div class="tblwrap" style="max-height:480px;overflow-y:auto"><table class="tbl resp"><thead><tr><th>Дата</th><th>Статья</th><th>Основание</th><th>Способ</th><th class="r">Сумма</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
      ${pays.map((p) => `<tr><td data-l="Дата" class="nowrap">${dt(p.created_at)}</td><td data-l="Статья">${esc(p.category || '')}${p.employee ? ' · ' + esc(p.employee) : ''}${p.contractor ? ` · <a href="#/contractors/${p.contractor_id}">${esc(p.contractor)}</a>` : ''}</td>
      <td data-l="Основание">${p.order_id ? `<a href="#/orders/${p.order_id}">${orderNo(p.order_id)}</a> ${esc(p.client || '')}` : ''} <span class="muted">${esc(p.note || '')}</span></td><td data-l="Способ" class="muted">${METHODS[p.method] || ''}</td>
      <td data-l="Сумма" class="r mono" style="color:${p.direction === 'in' ? 'var(--ok)' : 'var(--bad)'}">${p.direction === 'in' ? '+' : '−'}${num(p.amount)}</td>${isAdmin() ? `<td><button class="ghost sm danger" data-delp="${p.id}">✕</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Операций нет</div>'}</div>
  </div><div>
    <div class="card"><h2>Выручка по выданным заказам</h2>
      <div class="totals" style="width:100%"><div><span class="muted">Выдано заказов</span><b>${s.orders}</b></div><div><span class="muted">Работы</span><span class="mono">${rub(s.services)}</span></div>
      <div><span class="muted">Товары</span><span class="mono">${rub(s.goods)}</span></div><div><span class="muted">Себестоимость товаров</span><span class="mono">${rub(s.goods_cost)}</span></div>
      <div><span class="muted">Наценка на товарах</span><span class="mono">${rub(goodsMargin)}</span></div>
      <div class="big"><span>Валовая прибыль</span><span class="mono">${rub(s.services + goodsMargin)}</span></div></div>
      <div class="small muted" style="margin-top:6px">Без учёта зарплаты и расходов. Склад: ${rub(r.stockValue.cost)} по закупке.</div></div>
    <div class="card"><h2>По способам оплаты</h2>${byM('in').map(([t, v]) => `<div class="li"><div class="grow">${t}</div><span class="mono">${rub(v)}</span></div>`).join('')}</div>
    <div class="card"><h2>Статьи расходов</h2>${catList('out').map((x) => `<div style="margin-bottom:8px"><div class="inline" style="justify-content:space-between"><span>${esc(x.category)}</span><span class="mono">${rub(x.s)}</span></div><div class="meter"><i style="width:${x.s / maxCat * 100}%;background:#6b7385"></i></div></div>`).join('') || '<div class="muted">Нет расходов</div>'}</div>
    <div class="card"><h2>Топ услуг</h2>${r.topServices.map((x) => `<div class="li"><div class="grow"><div class="t" style="font-weight:500">${esc(x.name)}</div><div class="s">${num(x.n)} раз</div></div><span class="mono">${rub(x.s)}</span></div>`).join('') || '<div class="muted">Нет данных</div>'}</div>
    <div class="card"><h2>Топ товаров</h2>${r.topGoods.map((x) => `<div class="li"><div class="grow"><div class="t" style="font-weight:500">${esc(x.name)}</div><div class="s">${num(x.n)} шт · наценка ${rub(x.margin)}</div></div><span class="mono">${rub(x.s)}</span></div>`).join('') || '<div class="muted">Нет данных</div>'}</div>
    <div class="card"><h2>Откуда клиенты</h2>${r.sources.map((x) => `<div class="li"><div class="grow">${esc(x.source)}</div><b>${x.n}</b></div>`).join('') || '<div class="muted">Нет данных</div>'}</div>
  </div></div>`;
  bindPeriod(page, (f, t) => go('/finance' + qs({ from: f, to: t })));
  const contrs = await contractorsList();
  const payModal = (dir) => modal(dir === 'in' ? 'Приход в кассу' : 'Расход', `
    <div class="row"><div class="field"><label>Сумма, ₽</label><input name="amount" type="number" step="any" min="0.01" required></div>
    <div class="field"><label>Статья</label><select name="category" id="cat">${opts(dir === 'in' ? INCOME_CATS : EXPENSE_CATS.filter((c) => isAdmin() || c !== 'Зарплата'))}</select></div></div>
    <div class="row"><div class="field"><label>Способ</label><select name="method">${opts(Object.entries(dir === 'in' ? { ...PAY_IN, transfer: 'На расчётный счёт (безнал)' } : WALLET), 'cash')}</select></div><div class="field"><label>Дата</label><input type="date" name="date" value="${today()}"></div>
    <div class="field"><label>Контрагент</label><select name="contractor_id">${opts(contrs.map((c) => [c.id, c.name]), '', '—')}</select></div>
    <div class="field hidden" id="empF"><label>Сотрудник</label><select name="employee_id">${opts(S.staff.map((u) => [u.id, u.name]), '', '—')}</select></div></div>
    <div class="field"><label>Комментарий</label><input name="note"></div>`,
  { onSubmit: async (d) => { await POST('/api/payments', { ...d, direction: dir }); toast('Проведено'); navigate(); },
    onOpen: (f) => { const c = $('#cat', f); const t = () => $('#empF', f).classList.toggle('hidden', c.value !== 'Зарплата'); c.onchange = t; t(); } });
  const mopts = (sel, skip) => opts(Object.entries(WALLET).filter(([k]) => k !== skip), sel);
  $('#cashOut', page).onclick = () => modal('Обналичивание', `
    <div class="small muted" style="margin-bottom:8px">Укажите, сколько сняли с каждого источника. «Получено» — сумма, пришедшая в наличные; комиссия банка списывается с источника дополнительно.</div>
    ${[['transfer', 'Со счёта'], ['card', 'С карты']].map(([k, t]) => `<div class="row"><div class="field"><label>${t}: получено, ₽ <span class="muted">(сейчас ${rub(mb.now[k])})</span></label><input name="a_${k}" type="number" step="any" min="0"></div>
      <div class="field"><label>Комиссия, ₽</label><input name="f_${k}" type="number" step="any" min="0"></div></div>`).join('')}
    <div class="row"><div class="field"><label>Дата</label><input type="date" name="date" value="${today()}"></div><div class="field"><label>Комментарий</label><input name="note" placeholder="например: снял в банкомате"></div></div>
    <div class="small" id="coSum"></div>`,
  { onOpen: (f) => { const upd = () => { const v = (n) => +(f.elements[n].value || 0); const got = v('a_transfer') + v('a_card'), fee = v('f_transfer') + v('f_card');
      $('#coSum', f).innerHTML = got || fee ? `В наличные: <b>${rub(got)}</b>${fee ? ` · комиссия: <b>${rub(fee)}</b> · списано всего: <b>${rub(got + fee)}</b>` : ''}` : ''; };
      f.oninput = upd; },
    onSubmit: async (d) => { await POST('/api/money/transfer', { to_method: 'cash', date: d.date, note: d.note || 'Обналичивание',
      parts: ['transfer', 'card'].map((k) => ({ from_method: k, amount: d['a_' + k], fee: d['f_' + k] })) }); toast('Обналичивание проведено'); navigate(); } });
  $('#moveMoney', page).onclick = () => modal('Перемещение денег', `
    <div class="row"><div class="field"><label>Откуда</label><select name="from">${mopts('cash')}</select></div><div class="field"><label>Куда</label><select name="to">${mopts('transfer')}</select></div></div>
    <div class="row"><div class="field"><label>Сумма, ₽</label><input name="amount" type="number" step="any" min="0.01" required></div><div class="field"><label>Комиссия, ₽</label><input name="fee" type="number" step="any" min="0"></div></div>
    <div class="row"><div class="field"><label>Дата</label><input type="date" name="date" value="${today()}"></div><div class="field"><label>Комментарий</label><input name="note" placeholder="например: сдал наличные на счёт"></div></div>`,
  { onSubmit: async (d) => { if (d.from === d.to) throw new Error('Выберите разные кассы');
      await POST('/api/money/transfer', { to_method: d.to, date: d.date, note: d.note, parts: [{ from_method: d.from, amount: d.amount, fee: d.fee }] }); toast('Перемещение проведено'); navigate(); } });
  if ($('#reconcile', page)) $('#reconcile', page).onclick = () => modal('Сверка остатков', `
    <div class="small muted" style="margin-bottom:8px">Пересчитайте деньги и впишите фактические остатки. Если факт отличается от CRM, будет проведена корректировка на разницу. Пустое поле — не менять.</div>
    ${Object.entries(WALLET).map(([k, t]) => `<div class="row"><div class="field"><label>${t}: по CRM</label><input value="${num(mb.now[k])}" disabled></div>
      <div class="field"><label>Фактически, ₽</label><input name="${k}" type="number" step="any" data-crm="${mb.now[k]}"></div><div class="field"><label>Разница</label><input disabled id="df_${k}"></div></div>`).join('')}
    <div class="field"><label>Комментарий</label><input name="note" placeholder="например: ввод начальных остатков"></div>`,
  { onOpen: (f) => { f.oninput = () => Object.keys(WALLET).forEach((k) => { const i = f.elements[k]; $('#df_' + k, f).value = i.value === '' ? '' : ((+i.value - +i.dataset.crm) > 0 ? '+' : '') + num(+i.value - +i.dataset.crm); }); },
    onSubmit: async (d) => { const r = await POST('/api/money/reconcile', d); toast(r.made.length ? 'Корректировки проведены: ' + r.made.length : 'Расхождений нет'); navigate(); } });
  $$('[data-delm]', page).forEach((b) => (b.onclick = async () => { if (await confirmBox('Удалить операцию? Обналичивание удаляется целиком (все источники).', 'Удалить')) { await DEL('/api/money/moves/' + b.dataset.delm); navigate(); } }));
  $('#addIn', page).onclick = () => payModal('in');
  $('#addOut', page).onclick = () => payModal('out');
  $$('[data-delp]', page).forEach((b) => (b.onclick = async () => { if (await confirmBox('Удалить операцию из кассы? Если это оплата картой, вместе с ней удалится и её эквайринг.', 'Удалить')) { await DEL('/api/payments/' + b.dataset.delp); navigate(); } }));
});

// ================= Банк: операции по расчётному счёту (Альфа-Банк) =================
const fileToDataURL = (file) => new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => no(new Error('Не удалось прочитать файл')); fr.readAsDataURL(file); });
route(/^\/finance\/bank$/, async (page, query) => {
  const st = query.st ?? 'new';
  const [d, mb, alfa, contrs] = await Promise.all([GET('/api/bank/tx' + qs({ status: st })), GET('/api/money/balances'), isAdmin() ? GET('/api/alfa').catch(() => null) : null, contractorsList()]);
  const crmAcc = mb.now.transfer;
  const diff = d.bank_balance === null ? null : Math.round((d.bank_balance - crmAcc) * 100) / 100;
  const aText = (r) => r.status === 'skip' ? `<span class="muted">${esc(r.note || 'Пропущено')}</span>`
    : r.status === 'done' ? `${String(r.action || '').startsWith('auto:') ? '<span class="badge">авто</span> ' : ''}${esc(r.note || r.p_category || '')}${r.p_order ? ` · <a href="#/orders/${r.p_order}">${orderNo(r.p_order)}</a>` : ''}${r.p_contractor ? ' · ' + esc(r.p_contractor) : ''}`
    : r.suggestion ? `<span style="color:var(--warn)">Предлагаю: ${esc(r.suggestion.text)}</span>` : '<span class="muted">Нужно выбрать, куда отнести</span>';
  page.innerHTML = `<div class="topbar"><button class="ghost" onclick="location.hash='#/finance'">←</button><h1>Банк</h1><div class="sp"></div>
    ${alfa && alfa.connected ? '<button id="sync">⟳ Загрузить из Альфа-Банка</button>' : ''}<label class="btn">⬆ Файл выписки (1С)<input type="file" id="bf" accept=".txt,text/plain" hidden></label>
    ${isAdmin() ? '<a class="btn ghost" href="#/settings">Подключение</a>' : ''}</div>
  <div class="grid g4" style="margin-bottom:14px">
    <div class="kpi"><div class="l">Остаток в банке${d.bank_balance_date ? ' на ' + dmy(d.bank_balance_date) : ''}</div><div class="v">${d.bank_balance === null ? '—' : rub(d.bank_balance)}</div><div class="small muted">по последней выписке</div></div>
    <div class="kpi"><div class="l">Расчётный счёт в CRM</div><div class="v">${rub(crmAcc)}</div></div>
    <div class="kpi"><div class="l">Расхождение</div><div class="v ${diff && Math.abs(diff) > 1 ? 'bad' : 'ok'}">${diff === null ? '—' : rub(diff)}</div><div class="small muted">${diff && Math.abs(diff) > 1 ? 'разнесите операции или сверьте остатки' : diff === null ? 'загрузите выписку' : 'совпадает'}</div></div>
    <div class="kpi"><div class="l">Требуют решения</div><div class="v ${d.counts.new ? 'bad' : 'ok'}">${d.counts.new || 0}</div></div></div>
  ${alfa && !alfa.connected ? `<div class="card small muted">Альфа-Банк ещё не подключён по API — пока можно загружать выписку файлом: Альфа-Бизнес → Выписка → «Экспорт в 1С» (файл .txt). <a href="#/settings">Подключить Alfa API</a></div>` : ''}
  ${alfa && alfa.error ? `<div class="card" style="border-color:var(--bad)"><b>Ошибка связи с банком:</b> ${esc(alfa.error)}</div>` : ''}
  <div class="chips" style="margin-bottom:12px">${[['new', `Требуют решения (${d.counts.new || 0})`], ['done', `Разнесены (${d.counts.done || 0})`], ['skip', `Пропущены (${d.counts.skip || 0})`], ['', 'Все']].map(([k, t]) => `<button class="chip ${k === st ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</div>
  <div class="card" style="padding:4px 6px">${d.rows.length ? `<div class="tblwrap"><table class="tbl resp"><thead><tr><th>Дата</th><th class="r">Сумма</th><th>Контрагент</th><th>Назначение</th><th>Разноска</th><th></th></tr></thead><tbody>
    ${d.rows.map((r) => `<tr><td data-l="Дата" class="nowrap">${dmy(r.date)}</td>
      <td data-l="Сумма" class="r mono" style="color:${r.direction === 'in' ? 'var(--ok)' : 'var(--bad)'}">${r.direction === 'in' ? '+' : '−'}${num(r.amount)}</td>
      <td data-l="Контрагент">${esc(r.cp_name || '—')}${r.cp_inn ? `<div class="small muted">ИНН ${esc(r.cp_inn)}</div>` : ''}</td>
      <td data-l="Назначение" class="small" style="max-width:360px">${esc(r.purpose || '')}</td>
      <td data-l="Разноска" class="small">${aText(r)}</td>
      <td class="nowrap">${r.status === 'new' ? `${r.suggestion ? `<button class="sm primary" data-ok="${r.id}">Провести</button> ` : ''}<button class="sm" data-man="${r.id}">Разнести…</button>` : isAdmin() ? `<button class="ghost sm" data-undo="${r.id}" title="Отменить разноску">↺</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">${st === 'new' ? 'Все операции банка разнесены' : 'Операций нет'}</div>`}</div>
  <div class="small muted">Автоматически разносятся: оплаты, которые уже есть в CRM (та же сумма ±3 дня), возмещение по терминалу (оплаты уже учтены в заказах), платежи контрагентам и от них по ИНН, оплаты с номером заказа «БС-…» в назначении, аренда, налоги, кредит и комиссии банка. Остальное — вручную кнопкой «Разнести…».</div>`;
  $$('[data-st]', page).forEach((b) => (b.onclick = () => go('/finance/bank' + qs({ st: b.dataset.st }))));
  const sy = $('#sync', page);
  if (sy) sy.onclick = async () => { sy.disabled = true; sy.textContent = 'Загружаю…'; try { const r = await POST('/api/alfa/sync', {}); toast(`Из банка: ${r.fetched}, новых ${r.added}, разнесено автоматически ${r.auto}`); } catch (e) { toast(e.message, true); } navigate(); };
  $('#bf', page).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await POST('/api/bank/upload', { data: await fileToDataURL(f) }); toast(`Операций в файле: ${r.total}, новых ${r.added}, разнесено автоматически ${r.auto}`); } catch (err) { toast(err.message, true); }
    navigate();
  };
  const byId = (id) => d.rows.find((x) => x.id === +id);
  $$('[data-ok]', page).forEach((b) => (b.onclick = async () => { const r = byId(b.dataset.ok); try { await POST(`/api/bank/tx/${r.id}/apply`, r.suggestion); toast('Проведено'); navigate(); } catch (e) { toast(e.message, true); } }));
  $$('[data-undo]', page).forEach((b) => (b.onclick = async () => { if (await confirmBox('Отменить разноску? Созданная в кассе операция будет удалена, банковская операция вернётся в «Требуют решения».', 'Отменить')) { await POST(`/api/bank/tx/${b.dataset.undo}/undo`, {}); navigate(); } }));
  $$('[data-man]', page).forEach((b) => (b.onclick = async () => {
    const r = byId(b.dataset.man); const cand = await GET(`/api/bank/tx/${r.id}/candidates`);
    const inc = r.direction === 'in';
    const types = [['category', inc ? 'Приход по статье' : 'Расход по статье'], ['contractor', inc ? 'Оплата от контрагента' : 'Оплата контрагенту'], ...(inc ? [['order', 'Оплата заказа']] : [['cash', 'Снятие наличных (в кассу «Наличные»)']]),
      ...(cand.length ? [['link', 'Это операция, уже внесённая в CRM']] : []), ['skip', 'Пропустить (не учитывать в CRM)']];
    modal(`${inc ? 'Поступление' : 'Списание'} ${rub(r.amount)} · ${dmy(r.date)}`, `
      <div class="small muted" style="margin-bottom:10px">${esc(r.cp_name || '')}${r.cp_inn ? ' · ИНН ' + esc(r.cp_inn) : ''}<br>${esc(r.purpose || '')}</div>
      <div class="field"><label>Куда отнести</label><select name="type" id="bt">${opts(types, r.suggestion?.type && types.some((t) => t[0] === r.suggestion.type) ? r.suggestion.type : 'category')}</select></div>
      <div class="field bt-x" data-for="category"><label>Статья</label><input name="category" list="bcats" value="${esc(r.suggestion?.category || (inc ? 'Прочий приход' : ''))}" placeholder="Например: Аренда"><datalist id="bcats">${(inc ? INCOME_CATS : EXPENSE_CATS).map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field bt-x" data-for="contractor"><label>Контрагент</label><select name="contractor_id">${opts(contrs.map((c) => [c.id, c.name + (c.inn ? ' · ИНН ' + c.inn : '')]), r.suggestion?.contractor_id || '', '— выберите —')}</select></div>
      <div class="field bt-x" data-for="order"><label>Номер заказа</label><input name="order_id" type="number" placeholder="например 12 (для БС-00012)" value="${r.suggestion?.order_id || ''}"></div>
      <div class="field bt-x" data-for="link"><label>Операция в CRM</label><select name="payment_id">${opts(cand.map((p) => [p.id, `${dt(p.created_at)} · ${rub(p.amount)} · ${p.category || ''}${p.contractor ? ' · ' + p.contractor : ''}${p.order_id ? ' · ' + orderNo(p.order_id) : ''}`]), cand[0]?.id)}</select></div>
      <div class="field bt-x" data-for="skip"><label>Причина</label><select name="skipwhy">${opts([['Перевод между своими счетами', 'Перевод между своими счетами'], ['Возмещение по терминалу (уже учтено в заказах)', 'Возмещение по терминалу (уже учтено в заказах)'], ['Не относится к студии', 'Не относится к студии']])}</select></div>`,
    { submit: 'Провести', onOpen: (f) => { const sync = () => $$('.bt-x', f).forEach((x) => x.classList.toggle('hidden', x.dataset.for !== f.type.value)); f.type.onchange = sync; sync(); },
      onSubmit: async (v) => {
        const a = { type: v.type };
        if (v.type === 'category') { if (!v.category) { toast('Укажите статью', true); return false; } a.category = v.category; a.text = (inc ? 'Приход: ' : 'Расход: ') + v.category; }
        if (v.type === 'contractor') { if (!v.contractor_id) { toast('Выберите контрагента', true); return false; } a.contractor_id = v.contractor_id; a.text = (inc ? 'Оплата от ' : 'Оплата ') + (contrs.find((c) => c.id === +v.contractor_id)?.name || ''); }
        if (v.type === 'order') { if (!v.order_id) { toast('Укажите номер заказа', true); return false; } a.order_id = v.order_id; a.text = 'Оплата заказа ' + orderNo(+v.order_id); }
        if (v.type === 'link') { a.payment_id = v.payment_id; a.text = 'Связано с операцией в CRM'; }
        if (v.type === 'cash') a.text = 'Снятие наличных';
        if (v.type === 'skip') a.text = v.skipwhy;
        await POST(`/api/bank/tx/${r.id}/apply`, a); toast('Проведено'); navigate();
      } });
  }));
});
// отзывы клиентов для сайта (переносятся с 2ГИС)
async function loadReviewsCard(page) {
  const box = $('#revCard', page); if (!box) return;
  let d; try { d = await GET('/api/site/reviews'); } catch { box.remove(); return; }
  const star = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  box.innerHTML = `<h2>Отзывы на сайте</h2>
    <div class="small muted" style="margin-bottom:10px">Перенесите сюда настоящие отзывы клиентов с вашей карточки 2ГИС — они появятся на сайте в блоке «Отзывы клиентов» вместе с рейтингом и кнопкой «Все отзывы на 2ГИС». Публикуйте только реальные отзывы, без изменений по смыслу.</div>
    <form id="rvMeta"><div class="row"><div class="field" style="flex:2"><label>Ссылка на карточку 2ГИС</label><input name="twogis_url" value="${esc(d.twogis_url)}" placeholder="https://2gis.ru/irkutsk/firm/…"></div>
      <div class="field"><label>Рейтинг на 2ГИС</label><input name="twogis_rating" type="number" step="0.1" min="1" max="5" value="${esc(d.twogis_rating)}" placeholder="4.9"></div>
      <div class="field"><label>Всего отзывов</label><input name="twogis_count" type="number" min="0" value="${esc(d.twogis_count)}"></div></div>
      <button class="sm primary">Сохранить</button> <a class="btn sm ghost" href="/#reviews" target="_blank">Посмотреть на сайте</a></form>
    <div class="inline" style="margin:16px 0 8px"><h3 style="margin:0;flex:1">Отзывы (${d.reviews.length})</h3><button type="button" class="sm" id="rvAdd">+ Добавить отзыв</button></div>
    ${d.reviews.length ? d.reviews.map((r) => `<div class="li" style="align-items:flex-start;${r.visible ? '' : 'opacity:.5'}"><div class="grow"><div class="t"><b>${esc(r.author)}</b> ${r.rating ? `<span style="color:#f2a900">${star(r.rating)}</span>` : ''} <span class="muted small">${r.date ? dmy(r.date) : ''} · ${esc(r.source || '')}${r.visible ? '' : ' · скрыт'}</span></div>
      <div class="s" style="white-space:pre-line">${esc(r.text.length > 240 ? r.text.slice(0, 240) + '…' : r.text)}</div></div><button type="button" class="ghost sm" data-rve="${r.id}">✎</button><button type="button" class="ghost sm danger" data-rvd="${r.id}">✕</button></div>`).join('')
      : '<div class="muted small">Пока нет отзывов. Откройте карточку на 2ГИС, скопируйте имя, дату, оценку и текст отзыва и нажмите «+ Добавить отзыв».</div>'}`;
  $('#rvMeta', box).onsubmit = async (e) => { e.preventDefault(); try { await PUT('/api/site/reviews-meta', formData(e.target)); toast('Сохранено'); loadReviewsCard(page); } catch (err) { toast(err.message, true); } };
  const edit = (r = { rating: 0, source: '2ГИС', visible: 1 }) => modal(r.id ? 'Отзыв' : 'Новый отзыв', `
    <div class="row"><div class="field"><label>Имя автора (как на 2ГИС)</label><input name="author" value="${esc(r.author || '')}" required></div>
      <div class="field"><label>Дата отзыва</label><input type="date" name="date" value="${esc(r.date || '')}"></div>
      <div class="field"><label>Оценка</label><select name="rating">${opts([[0, '— не указана —'], ...[5, 4, 3, 2, 1].map((n) => [n, star(n)])], r.rating ?? 0)}</select></div></div>
    <div class="field"><label>Текст отзыва</label><textarea name="text" rows="7" required>${esc(r.text || '')}</textarea></div>
    <div class="row"><div class="field"><label>Источник</label><input name="source" value="${esc(r.source || '2ГИС')}"></div>
      <div class="field"><label>&nbsp;</label><label class="inline" style="color:var(--text)"><input type="checkbox" name="visible" ${r.visible ? 'checked' : ''} style="width:auto"> Показывать на сайте</label></div></div>`,
  { onSubmit: async (v) => { if (r.id) await PUT('/api/site/reviews/' + r.id, v); else await POST('/api/site/reviews', v); toast('Сохранено'); loadReviewsCard(page); } });
  $('#rvAdd', box).onclick = () => edit();
  $$('[data-rve]', box).forEach((b) => (b.onclick = () => edit(d.reviews.find((x) => x.id === +b.dataset.rve))));
  $$('[data-rvd]', box).forEach((b) => (b.onclick = async () => { if (await confirmBox('Удалить отзыв с сайта?', 'Удалить')) { await DEL('/api/site/reviews/' + b.dataset.rvd); loadReviewsCard(page); } }));
}

// карточка онлайн-кассы Saby (Нева-01-Ф + терминал Альфа-Банка) в Настройках
async function loadSabyCard(page) {
  const box = $('#sabyCard', page); if (!box) return;
  let a; try { a = await GET('/api/saby'); } catch { box.remove(); return; }
  let nom = null; try { nom = JSON.parse(a.saby_nom || 'null'); } catch {}
  box.innerHTML = `<h2>Онлайн-касса Saby ${a.ready ? '<span class="badge ok">работает</span>' : a.configured ? '<span class="badge warn">не завершена</span>' : '<span class="badge">не подключена</span>'}</h2>
    <div class="small muted" style="margin-bottom:10px">При оплате «Терминал» CRM отправляет заказ с суммой на кассу Saby. Кассир открывает его в разделе «Заказы» и проводит оплату картой: Saby сам передаёт сумму на терминал Альфа-Банка и пробивает чек, а CRM записывает оплату.
    Ключи: в Saby откройте <b>Настройки → Интеграция / API → Подключить приложение</b> (или попросите менеджера Saby), выберите сервисную авторизацию — Saby выдаст <b>ID приложения</b>, <b>защищённый ключ</b> и <b>сервисный ключ</b>.</div>
    <form id="sabyF">
    <div class="row"><div class="field"><label>ID приложения (app_client_id)</label><input name="saby_client_id" value="${esc(a.saby_client_id)}" autocomplete="off"></div></div>
    <div class="row"><div class="field"><label>Защищённый ключ ${a.has_app_secret ? '<span class="muted">(сохранён)</span>' : ''}</label><input name="saby_app_secret" type="password" autocomplete="new-password" placeholder="${a.has_app_secret ? '•••••• (не менять)' : ''}"></div>
      <div class="field"><label>Сервисный ключ ${a.has_secret_key ? '<span class="muted">(сохранён)</span>' : ''}</label><input name="saby_secret_key" type="password" autocomplete="new-password" placeholder="${a.has_secret_key ? '•••••• (не менять)' : ''}"></div></div>
    <div class="inline" style="flex-wrap:wrap;gap:8px;margin-bottom:10px"><button class="primary">Сохранить</button>${a.configured ? '<button type="button" id="sbTest">Проверить и выбрать точку продаж</button><button type="button" class="ghost danger" id="sbOff">Отключить</button>' : ''}</div>
    <div id="sbPick"></div>
    ${a.saby_point_id ? `<div class="small" style="margin:6px 0">Точка продаж: <b>${esc(a.saby_point_name || a.saby_point_id)}</b> · прайс: <b>${esc(a.saby_price_list_name || a.saby_price_list_id || '—')}</b> · позиция для чека: <b>${esc(nom?.name || '—')}</b></div>` : ''}
    ${a.saby_point_id ? `<div class="field"><label>Как пробивать позиции</label><select name="saby_mode">${opts([['items', 'Построчно — каждая услуга и товар отдельной строкой (если оплачивают весь заказ)'], ['single', 'Одной строкой — «Оплата по заказ-наряду №…»']], a.saby_mode || 'items')}</select></div>` : ''}
    ${a.error ? `<div class="small" style="color:var(--bad)">Ошибка: ${esc(a.error)}</div>` : ''}</form>`;
  const f = $('#sabyF', box);
  f.onsubmit = async (e) => { e.preventDefault(); try { await PUT('/api/saby', formData(f)); toast('Сохранено'); loadSabyCard(page); } catch (err) { toast(err.message, true); } };
  const off = $('#sbOff', box); if (off) off.onclick = async () => { if (await confirmBox('Отключить кассу Saby? Оплаты, уже записанные в CRM, останутся.', 'Отключить')) { await PUT('/api/saby', { disconnect: 1 }); loadSabyCard(page); } };
  const tb = $('#sbTest', box); if (tb) tb.onclick = async () => {
    const pick = $('#sbPick', box); pick.innerHTML = '<div class="muted small">Связываемся с Saby…</div>';
    let pts; try { pts = (await POST('/api/saby/test', {})).points; } catch (e) { pick.innerHTML = `<div class="small" style="color:var(--bad)">${esc(e.message)}</div>`; return; }
    if (!pts.length) { pick.innerHTML = '<div class="small" style="color:var(--bad)">Связь есть, но точек продаж не найдено. Проверьте, что у приложения есть доступ к разделу «Бизнес / Розница» и что касса подключена к точке.</div>'; return; }
    pick.innerHTML = `<div class="row"><div class="field"><label>Точка продаж</label><select id="sbPt">${pts.map((p) => `<option value="${p.id}" ${String(p.id) === a.saby_point_id ? 'selected' : ''}>${esc(p.name || p.id)}${p.address ? ' — ' + esc(p.address) : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Прайс-лист</label><select id="sbPl"></select></div></div>
      <div class="field"><label>Позиция Saby, через которую пробиваются услуги и товары (например «Услуги автосервиса»)</label><div class="inline"><input id="sbQ" placeholder="Поиск по каталогу Saby"><button type="button" id="sbFind">Найти</button></div><div id="sbNoms" class="small" style="margin-top:6px"></div></div>`;
    const loadPl = async () => {
      const pl = $('#sbPl', pick); pl.innerHTML = '<option>…</option>';
      try { const list = await GET('/api/saby/prices' + qs({ pointId: $('#sbPt', pick).value })); const p = pts.find((x) => String(x.id) === $('#sbPt', pick).value);
        pl.innerHTML = list.map((x) => `<option value="${x.id}" ${String(x.id) === (a.saby_price_list_id || String(p?.defaultPriceList || '')) ? 'selected' : ''}>${esc(x.name)}</option>`).join('') || '<option value="">Прайс-листов нет</option>'; }
      catch (e) { pl.innerHTML = '<option value="">ошибка</option>'; toast(e.message, true); }
    };
    $('#sbPt', pick).onchange = loadPl; await loadPl();
    const find = async () => {
      const out = $('#sbNoms', pick); out.textContent = 'Ищем…';
      try { const list = await GET('/api/saby/noms' + qs({ pointId: $('#sbPt', pick).value, priceListId: $('#sbPl', pick).value, q: $('#sbQ', pick).value }));
        out.innerHTML = list.length ? list.map((x, i) => `<div class="inline" style="justify-content:space-between;border-bottom:1px solid var(--line);padding:4px 0"><span>${esc(x.name)} <span class="muted">${x.cost ? rub(x.cost) : ''}</span></span><button type="button" class="sm" data-nom="${i}">Выбрать</button></div>`).join('') : 'Ничего не найдено — создайте в Saby услугу «Услуги автосервиса» с ценой 0 и найдите её здесь.';
        $$('[data-nom]', out).forEach((b) => (b.onclick = async () => {
          const n = list[+b.dataset.nom]; const pt = $('#sbPt', pick), pl = $('#sbPl', pick);
          try { await PUT('/api/saby', { saby_point_id: pt.value, saby_point_name: pt.selectedOptions[0]?.textContent || '', saby_price_list_id: pl.value, saby_price_list_name: pl.selectedOptions[0]?.textContent || '', saby_nom: n });
            toast('Касса Saby настроена'); loadSabyCard(page); S.me.saby_on = true; } catch (e) { toast(e.message, true); }
        }));
      } catch (e) { out.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
    };
    $('#sbFind', pick).onclick = find; $('#sbQ', pick).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } };
  };
}

// карточка подключения Alfa API в Настройках
async function loadAlfaCard(page, query = {}) {
  const box = $('#alfaCard', page); if (!box) return;
  let a; try { a = await GET('/api/alfa'); } catch { box.remove(); return; }
  if (query.alfa) toast(query.alfa === 'ok' ? 'Альфа-Банк подключён' : 'Альфа-Банк: ' + query.alfa, query.alfa !== 'ok');
  const redirect = a.alfa_redirect_uri || location.origin + '/api/alfa/callback';
  box.innerHTML = `<h2>Альфа-Банк (Alfa API) ${a.connected ? '<span class="badge ok">подключён</span>' : '<span class="badge">не подключён</span>'}</h2>
    <div class="small muted" style="margin-bottom:10px">Выписка по расчётному счёту загружается автоматически каждые 30 минут и разносится по кассе CRM (страница Финансы → Банк).
    Чтобы подключить: в Альфа-Бизнесе оформите доступ к <b>Alfa API</b> (раздел «Интеграции / API» или через менеджера банка), зарегистрируйте приложение с адресом возврата
    <code style="user-select:all">${esc(redirect)}</code> — банк выдаст <b>client_id</b>, <b>client_secret</b> и <b>сертификат с ключом</b>. Сначала банк даёт тестовый стенд, затем боевой.</div>
    <form id="alfaF">
    <div class="row"><div class="field"><label>Среда</label><select name="alfa_env">${opts([['sandbox', 'Тестовая (sandbox)'], ['prod', 'Боевая']], a.alfa_env || 'sandbox')}</select></div>
      <div class="field"><label>Расчётный счёт (20 цифр)</label><input name="alfa_account" value="${esc(a.alfa_account)}" inputmode="numeric" maxlength="20"></div></div>
    <div class="row"><div class="field"><label>client_id</label><input name="alfa_client_id" value="${esc(a.alfa_client_id)}" autocomplete="off"></div>
      <div class="field"><label>client_secret ${a.has_secret ? '<span class="muted">(сохранён)</span>' : ''}</label><input name="alfa_client_secret" type="password" autocomplete="new-password" placeholder="${a.has_secret ? '•••••• (не менять)' : ''}"></div></div>
    <div class="row"><div class="field"><label>Сертификат банка (.crt/.pem) ${a.has_cert ? '<span class="badge ok">загружен</span>' : ''}</label><input type="file" id="acrt" accept=".crt,.pem,.cer,.txt"></div>
      <div class="field"><label>Закрытый ключ (.key/.pem) ${a.has_key ? '<span class="badge ok">загружен</span>' : ''}</label><input type="file" id="akey" accept=".key,.pem,.txt"></div>
      <div class="field"><label>Пароль ключа (если есть)</label><input name="alfa_key_pass" type="password" autocomplete="new-password"></div></div>
    <details style="margin:4px 0 10px"><summary class="muted small" style="cursor:pointer">Адреса API (менять, только если банк дал другие)</summary>
      <div class="row" style="margin-top:8px"><div class="field"><label>Адрес API</label><input name="alfa_api_url" value="${esc(a.alfa_api_url)}" placeholder="${esc(a.defaults.env[a.alfa_env === 'prod' ? 'prod' : 'sandbox'].api)}"></div>
        <div class="field"><label>Адрес входа Alfa ID</label><input name="alfa_auth_url" value="${esc(a.alfa_auth_url)}" placeholder="${esc(a.defaults.env[a.alfa_env === 'prod' ? 'prod' : 'sandbox'].auth)}"></div></div>
      <div class="row"><div class="field"><label>Метод выписки</label><input name="alfa_statement_path" value="${esc(a.alfa_statement_path)}" placeholder="${esc(a.defaults.statement_path)}"></div>
        <div class="field"><label>Scope</label><input name="alfa_scope" value="${esc(a.alfa_scope)}" placeholder="${esc(a.defaults.scope)}"></div>
        <div class="field"><label>Адрес возврата (redirect_uri)</label><input name="alfa_redirect_uri" value="${esc(a.alfa_redirect_uri)}" placeholder="${esc(location.origin + '/api/alfa/callback')}"></div></div></details>
    <div class="inline" style="flex-wrap:wrap;gap:8px"><button class="primary">Сохранить</button>
      <button type="button" id="alogin">🔑 Войти через Alfa ID</button>${a.connected ? '<button type="button" id="atest">Проверить связь</button><button type="button" id="async">⟳ Загрузить выписку</button><button type="button" class="ghost danger" id="aoff">Отключить</button>' : ''}</div>
    <div class="field" style="margin-top:10px"><label>Если после входа банк открыл адрес, которого нет (например localhost), — вставьте его сюда целиком или только code</label>
      <div class="inline"><input id="acode" placeholder="https://…?code=…"><button type="button" id="acodeBtn">Подтвердить</button></div></div>
    <div class="small muted">${a.last_sync ? 'Последняя загрузка: ' + dt(a.last_sync) : ''}${a.error ? ` <span style="color:var(--bad)">Ошибка: ${esc(a.error)}</span>` : ''}</div></form>`;
  const f = $('#alfaF', box);
  const readFile = (inp) => new Promise((ok) => { const file = inp.files[0]; if (!file) return ok(''); const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsText(file); });
  f.onsubmit = async (e) => {
    e.preventDefault(); const d = formData(f);
    d.alfa_cert = await readFile($('#acrt', f)); d.alfa_key = await readFile($('#akey', f));
    try { await PUT('/api/alfa', d); toast('Сохранено'); loadAlfaCard(page); } catch (err) { toast(err.message, true); }
  };
  $('#alogin', box).onclick = async () => { try { await PUT('/api/alfa', formData(f)); const r = await POST('/api/alfa/auth-url', {}); location.href = r.url; } catch (e) { toast(e.message, true); } };
  $('#acodeBtn', box).onclick = async () => { try { await POST('/api/alfa/code', { code: $('#acode', box).value }); toast('Альфа-Банк подключён'); loadAlfaCard(page); } catch (e) { toast(e.message, true); } };
  const t = $('#atest', box); if (t) t.onclick = async () => { try { const r = await POST('/api/alfa/test', {}); toast('Связь есть: ' + (r.info?.organizationName || r.info?.name || r.info?.shortName || 'данные компании получены')); } catch (e) { toast(e.message, true); } };
  const sy = $('#async', box); if (sy) sy.onclick = async () => { try { const r = await POST('/api/alfa/sync', { days: 7 }); toast(`Операций: ${r.fetched}, новых ${r.added}, разнесено ${r.auto}`); } catch (e) { toast(e.message, true); } };
  const off = $('#aoff', box); if (off) off.onclick = async () => { if (await confirmBox('Отключить Альфа-Банк? Загруженные операции останутся.', 'Отключить')) { await PUT('/api/alfa', { disconnect: 1 }); loadAlfaCard(page); } };
}

// ================= Зарплата =================
route(/^\/salary$/, async (page, query) => {
  const from = query.from || monthStart(), to = query.to || today();
  const rows = await GET('/api/reports/salary' + qs({ from, to }));
  page.innerHTML = `<div class="topbar"><h1>${isAdmin() ? 'Зарплата' : 'Моя зарплата'}</h1><div class="sp"></div>${periodBar(page, from, to)}</div>
    <div class="small muted" style="margin-bottom:12px">Мастерам начисляется % от стоимости работ по выданным заказам (с учётом скидки), товары в зарплату не входят. Руководителям начисления ведутся вне CRM (поставьте им 0%). Проценты задаются в разделе «Сотрудники».</div>
    ${rows.length ? rows.map((u) => `<div class="card"><div class="inline" style="margin-bottom:8px"><h2 style="margin:0;flex:1">${esc(u.name)} <span class="muted small">${ROLES[u.role]} · работы ${u.salary_percent || 0}%${u.goods_percent ? ' · товары ' + u.goods_percent + '%' : ''}</span></h2>
      ${isAdmin() ? `<button class="sm" data-adj="${u.id}" data-name="${esc(u.name)}">± Премия / удержание</button>` : ''}
      ${isAdmin() && u.due > 0 ? `<button class="sm primary" data-pay="${u.id}" data-due="${u.due}">Выплатить ${rub(u.due)}</button>` : ''}</div>
      <div class="grid g4"><div class="kpi"><div class="l">Работы${u.adj_sum ? ' · премии/удерж.' : ''}</div><div class="v" style="font-size:18px">${rub(u.works_sum)}${u.adj_sum ? ` <span class="small" style="color:${u.adj_sum > 0 ? 'var(--ok)' : 'var(--bad)'}">${u.adj_sum > 0 ? '+' : '−'}${rub(Math.abs(u.adj_sum))}</span>` : ''}</div></div><div class="kpi"><div class="l">Начислено</div><div class="v acc" style="font-size:18px">${rub(u.accrued)}</div></div>
      <div class="kpi"><div class="l">Выплачено</div><div class="v" style="font-size:18px">${rub(u.paid)}</div></div><div class="kpi"><div class="l">К выплате</div><div class="v ${u.due > 0 ? 'ok' : ''}" style="font-size:18px">${rub(u.due)}</div></div></div>
      ${u.adjustments.length ? `<table class="tbl" style="margin-top:10px"><tbody>${u.adjustments.map((a) => `<tr><td class="nowrap">${dmy(a.date)}</td><td>${a.amount > 0 ? 'Премия' : 'Удержание'}: ${esc(a.note || '')}</td><td class="r mono" style="color:${a.amount > 0 ? 'var(--ok)' : 'var(--bad)'}">${a.amount > 0 ? '+' : '−'}${rub(Math.abs(a.amount))}</td>${isAdmin() ? `<td style="width:40px"><button class="ghost sm danger" data-deladj="${a.id}">✕</button></td>` : ''}</tr>`).join('')}</tbody></table>` : ''}
      ${u.works.length ? `<details style="margin-top:10px" ${isAdmin() ? '' : ''}><summary class="muted" style="cursor:pointer">Выполненные работы (${u.works.length})${isAdmin() ? ' — нажмите ✎, чтобы изменить начисление' : ''}</summary><table class="tbl" style="margin-top:6px"><tbody>${u.works.map((w) => `<tr><td class="nowrap">${dmy(w.issued_at)}</td><td><a href="#/orders/${w.order_id}">${orderNo(w.order_id)}</a></td><td>${esc(w.name)}${w.manual ? `<div class="small" style="color:var(--warn)">изменено вручную${w.note ? ': ' + esc(w.note) : ''}</div>` : ''}</td><td class="r mono muted">${rub(w.sum)}</td><td class="r muted">${w.manual ? '' : w.percent + '%'}</td><td class="r mono">${rub(w.amount)}</td>${isAdmin() ? `<td style="width:40px"><button class="ghost sm" data-acc="${w.id}" data-amount="${w.amount}" data-manual="${w.manual}" data-calc="${Math.round(w.sum * w.percent) / 100}" title="Изменить сумму">✎</button></td>` : ''}</tr>`).join('')}</tbody></table></details>` : ''}
    </div>`).join('') : '<div class="card empty">Нет начислений за период</div>'}`;
  bindPeriod(page, (f, t) => go('/salary' + qs({ from: f, to: t })));
  $$('[data-acc]', page).forEach((b) => (b.onclick = () => modal('Изменить начисление', `
    <div class="small muted" style="margin-bottom:8px">Расчётная сумма: ${rub(+b.dataset.calc)}. Ручная сумма сохранится, даже если заказ потом поправят.</div>
    <div class="row"><div class="field"><label>Сумма к начислению, ₽</label><input name="amount" type="number" step="any" min="0" required value="${b.dataset.amount}"></div></div>
    <div class="field"><label>Причина</label><input name="note" placeholder="Напр.: работу доделывал другой мастер"></div>`,
  { footer: b.dataset.manual === '1' ? '<button type="button" class="ghost" data-reset style="margin-right:auto">Вернуть расчётную</button><button type="button" data-x>Отмена</button><button class="primary">Сохранить</button>' : undefined,
    onSubmit: async (d) => { await PUT('/api/salary/accruals/' + b.dataset.acc, d); toast('Начисление изменено'); navigate(); },
    onOpen: (f, close) => { const r = $('[data-reset]', f); if (r) r.onclick = async () => { await PUT('/api/salary/accruals/' + b.dataset.acc, { reset: true }); close(); navigate(); }; } })));
  $$('[data-adj]', page).forEach((b) => (b.onclick = () => modal('Премия или удержание · ' + b.dataset.name, `
    <div class="row"><div class="field"><label>Тип</label><select name="kind"><option value="1">Премия (+)</option><option value="-1">Удержание (−)</option></select></div>
    <div class="field"><label>Сумма, ₽</label><input name="amount" type="number" step="any" min="0.01" required></div>
    <div class="field"><label>Дата</label><input name="date" type="date" value="${to <= today() ? to : today()}"></div></div>
    <div class="field"><label>Причина *</label><input name="note" required placeholder="Премия за месяц, штраф за брак, аванс…"></div>`,
  { onSubmit: async (d) => { await POST('/api/salary/adjustments', { user_id: b.dataset.adj, amount: Math.abs(+d.amount) * +d.kind, date: d.date, note: d.note }); toast('Сохранено'); navigate(); } })));
  $$('[data-deladj]', page).forEach((b) => (b.onclick = async () => { if (await confirmBox('Удалить премию / удержание?', 'Удалить')) { await DEL('/api/salary/adjustments/' + b.dataset.deladj); navigate(); } }));
  $$('[data-pay]', page).forEach((b) => (b.onclick = () => modal('Выплата зарплаты', `
    <div class="row"><div class="field"><label>Сумма, ₽</label><input name="amount" type="number" step="any" required value="${b.dataset.due}"></div><div class="field"><label>Способ</label><select name="method">${opts(Object.entries(WALLET), 'cash')}</select></div></div>
    <div class="field"><label>Комментарий</label><input name="note" value="Зарплата ${dmy(from)}–${dmy(to)}"></div>`,
  { submit: 'Провести выплату', onSubmit: async (d) => { await POST('/api/payments', { ...d, direction: 'out', category: 'Зарплата', employee_id: b.dataset.pay, date: to <= today() ? to : today() }); toast('Выплата проведена'); navigate(); } })));
});

// ================= Сотрудники =================
// карточка сотрудника (общая для «Списка» и «Руководителей»)
const userModal = (u = { role: 'master', active: 1, salary_percent: 50 }) => modal(u.id ? 'Сотрудник' : 'Новый сотрудник', `
    <div class="row"><div class="field"><label>Имя *</label><input name="name" required value="${esc(u.name || '')}"></div>
    <div class="field"><label>Логин *</label><input name="login" required value="${esc(u.login || '')}" autocapitalize="off" pattern="[a-zA-Z0-9._\-]{3,32}" title="3–32 символа: латинские буквы, цифры, точка, дефис, подчёркивание"></div></div>
    <div class="row"><div class="field"><label>Роль</label><select name="role">${opts(Object.entries(ROLES), u.role)}</select></div><div class="field"><label>Телефон</label><input name="phone" value="${esc(u.phone || '')}"></div></div>
    <div class="row"><div class="field"><label>% от работ</label><input name="salary_percent" type="number" step="any" min="0" max="100" value="${u.salary_percent || 0}"></div>
    <div class="field"><label>% от товаров</label><input name="goods_percent" type="number" step="any" min="0" max="100" value="${u.goods_percent || 0}"></div>
    <div class="field" id="dhF"><label>Часов в рабочий день</label><input name="default_hours" type="number" step="0.5" min="0" max="24" value="${u.default_hours ?? ''}" placeholder="8"></div></div>
    <div class="row"><div class="field"><label>${u.id ? 'Новый пароль (пусто — не менять)' : 'Пароль * (от 6 символов)'}</label><input name="password" type="text" ${u.id ? '' : 'required minlength="6"'} autocomplete="new-password"></div>
    <div class="field"><label>Telegram chat ID</label><input name="tg_chat_id" value="${esc(u.tg_chat_id || '')}" placeholder="заполнится сам"></div></div>
    ${u.id ? `<label class="inline" style="color:var(--text)"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Активен (может входить)</label>
    <h3 style="margin-top:14px">MAX и уведомления</h3>
    <div class="inline" style="margin-bottom:8px">${u.max_linked ? '<span class="badge ok">MAX подключён</span>' : '<span class="badge">MAX не подключён</span>'}
      <button type="button" class="sm" data-mxl>${u.max_linked ? 'Переподключить' : '📲 Подключить MAX'}</button>${u.max_linked ? '<button type="button" class="sm ghost danger" data-mxu>Отключить</button>' : ''}</div>
    <div id="ntf" class="checkgrid"><span class="muted small">Загрузка…</span></div>` : ''}`,
  { footer: u.id && u.id !== S.me.user.id ? '<button type="button" class="ghost danger" data-delu style="margin-right:auto">Удалить сотрудника</button><button type="button" data-x>Отмена</button><button class="primary">Сохранить</button>' : undefined,
    onSubmit: async (d, form) => {
      if (u.id) await PUT('/api/users/' + u.id, d); else await POST('/api/users', d);
      if (u.id && $('#ntf input', form)) await PUT(`/api/users/${u.id}/notify`, { subs: $$('#ntf input:checked', form).map((x) => x.value) });
      S.staff = await GET('/api/staff');
      if (u.id === S.me.user.id) S.me = await GET('/api/me');
      toast('Сохранено'); renderShell(); navigate();
    },
    // руководителям начисления ведутся вне CRM, мастерам — 50% от работ
    onOpen: (f, close) => {
      if (u.id) {
        Promise.all([GET('/api/notify/events'), GET(`/api/users/${u.id}/notify`)]).then(([ev, n]) => {
          $('#ntf', f).innerHTML = Object.entries(ev).map(([k, e]) => `<label class="ck"><input type="checkbox" value="${k}" ${n.subs.includes(k) ? 'checked' : ''}> ${esc(e.title)}${e.group === 'master' ? ' <span class="muted small">(мастеру)</span>' : ''}</label>`).join('');
        }).catch(() => {});
        $('[data-mxl]', f).onclick = async () => { try { maxLinkModal(await POST(`/api/users/${u.id}/max-link`), u.name); } catch (e) { toast(e.message, true); } };
        const mu = $('[data-mxu]', f); if (mu) mu.onclick = async () => { await DEL(`/api/users/${u.id}/max-link`); close(); toast('MAX отключён'); navigate(); };
      }
      const del = $('[data-delu]', f);
      if (del) del.onclick = async () => {
        if (!(await confirmBox(`Удалить сотрудника «${u.name}»? Он больше не сможет войти. Если у него есть заказы или начисления, его имя останется в старых документах.`, 'Удалить'))) return;
        try { const r = await DEL('/api/users/' + u.id); close(); S.staff = await GET('/api/staff'); toast(r.mode === 'archived' ? 'Сотрудник удалён (история заказов сохранена)' : 'Сотрудник удалён'); navigate(); } catch (e) { toast(e.message, true); }
      };
      const dh = () => $('#dhF', f).classList.toggle('hidden', f.role.value !== 'senior'); dh(); f.role.addEventListener('change', dh);
      f.role.addEventListener('change', () => { if (f.role.value === 'senior' || f.role.value === 'admin' || f.role.value === 'manager') f.salary_percent.value = 0; else if (f.role.value === 'master' && !+f.salary_percent.value) f.salary_percent.value = 50; }); } });

route(/^\/users$/, async (page) => {
  const rows = (await GET('/api/users')).filter((u) => u.role !== 'senior'); // руководители — на своей вкладке
  page.innerHTML = `<div class="topbar"><h1>Сотрудники</h1>${staffTabs('list')}<div class="sp"></div><button class="primary" id="add">+ Сотрудник</button></div>
    <div class="card tblwrap" style="padding:4px 6px"><table class="tbl resp"><thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th>Телефон</th><th class="r">% работ</th><th class="r">% товаров</th><th>MAX</th><th>Telegram</th></tr></thead><tbody>
    ${rows.map((u) => `<tr class="click" data-id="${u.id}" style="${u.active ? '' : 'opacity:.45'}"><td data-l="Имя"><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="badge">отключён</span>'}</td><td data-l="Логин" class="muted">${esc(u.login)}</td><td data-l="Роль">${ROLES[u.role]}</td>
    <td data-l="Телефон">${esc(u.phone || '')}</td><td data-l="% работ" class="r">${u.salary_percent || 0}%</td><td data-l="% товаров" class="r">${u.goods_percent || 0}%</td><td data-l="MAX">${u.max_linked ? '<span class="badge ok">подключён</span>' : '<span class="muted">—</span>'}</td><td data-l="Telegram">${u.tg_chat_id ? '<span class="badge ok">подключён</span>' : '<span class="muted">—</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="card small muted"><b>Роли.</b> Администратор и руководитель-мастер — всё, включая сотрудников, настройки, кассу и зарплату (руководитель-мастер к тому же может быть назначен мастером на работы). Менеджер — клиенты, заказы, склад, касса, отчёты. Мастер — только свои заказы и календарь, смена статусов «В работе / Ждёт запчасти / Готов», своя зарплата.<br>
    <b>Telegram мастера:</b> укажите телефон сотрудника, затем пусть он откроет бота студии и нажмёт «Поделиться номером» — уведомления о назначенных заказах начнут приходить автоматически.</div>`;
  $('#add', page).onclick = () => userModal();
  $$('tr[data-id]', page).forEach((tr) => (tr.onclick = () => userModal(rows.find((x) => x.id === +tr.dataset.id))));
});

const staffTabs = (cur) => isAdmin() ? `<div class="chips"><a class="chip ${cur === 'list' ? 'on' : ''}" href="#/users">Список</a><a class="chip ${cur === 'sched' ? 'on' : ''}" href="#/users/schedule">График работы</a><a class="chip ${cur === 'mgmt' ? 'on' : ''}" href="#/users/seniors">Руководители</a></div>` : '';
const SCH_CODE = { off: 'В', vac: 'О', sick: 'Б', abs: 'Н/Р' };
route(/^\/users\/schedule$/, async (page, query) => {
  const month = query.m || today().slice(0, 7);
  const d = await GET('/api/schedule' + qs({ month }));
  const E = {}; for (const e of d.entries) E[e.user_id + '|' + e.date] = e;
  const days = []; for (let x = d.from; x <= d.to; ) { days.push(x); const t = new Date(x + 'T12:00'); t.setDate(t.getDate() + 1); x = ymd(t); }
  const hrs = (u) => u.role === 'senior';
  const info = (u, ds) => { const e = E[u.id + '|' + ds]; const off = isDayOff(ds);
    if (e) return { st: e.status, h: e.status === 'work' ? (e.hours ?? u.default_hours ?? 0) : 0, ex: true, note: e.note, by: e.updated_by_name };
    return { st: off ? 'off' : 'work', h: off ? 0 : (u.default_hours || 0), ex: false, dflt: true }; };
  const shift = (n) => { const t = new Date(month + '-15T12:00'); t.setMonth(t.getMonth() + n); return ymd(t).slice(0, 7); };
  const mName = (m) => `${MONTHS_NOM[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const cell = (u, ds) => { const i = info(u, ds); let cls = 'c', txt = '';
    if (i.st === 'work') { cls += ' w' + (hrs(u) && i.ex && E[u.id + '|' + ds].hours != null ? ' ex' : ''); txt = hrs(u) ? num(i.h) : '•'; }
    else if (i.dflt) { cls += ' dflt-off'; txt = ''; }
    else { cls += ' st-' + i.st; txt = SCH_CODE[i.st]; }
    if (ds === today()) cls += ' today'; if (i.note) cls += ' hasnote';
    const tip = [dmy(ds), d.statuses[i.st] + (hrs(u) && i.st === 'work' ? ` · ${num(i.h)} ч` : ''), i.note, i.by ? 'изменил: ' + i.by : ''].filter(Boolean).join('\n');
    return `<td class="${cls}" data-u="${u.id}" data-d="${ds}" title="${esc(tip)}">${txt}</td>`; };
  const tot = (u) => { let dn = 0, h = 0, ab = 0; for (const ds of days) { const i = info(u, ds); if (i.st === 'work') { dn++; h += i.h; } else if (!i.dflt && i.st !== 'off') ab++; } return { dn, h, ab }; };
  page.innerHTML = `<div class="topbar"><h1>Сотрудники</h1>${staffTabs('sched')}<div class="sp"></div>
    <div class="inline"><button id="pm">‹</button><b style="min-width:130px;text-align:center">${mName(month)}</b><button id="nm">›</button><button id="cm">Текущий</button></div></div>
    <div class="legend" style="margin:-4px 0 10px"><span><i style="background:rgba(120,130,150,.5)"></i>В — выходной</span><span><i style="background:rgba(80,140,230,.6)"></i>О — отпуск</span><span><i style="background:rgba(230,160,40,.6)"></i>Б — больничный</span><span><i style="background:rgba(229,72,77,.7)"></i>Н/Р — отсутствует</span><span><i style="background:var(--accent)"></i>часы изменены вручную</span></div>
    <div class="card" style="padding:0;overflow:auto;max-height:calc(100vh - 210px)"><table class="sched"><thead><tr><th class="nm">Сотрудник</th>
      ${days.map((ds) => { const x = new Date(ds + 'T12:00'); return `<th class="${isDayOff(ds) ? 'we' : ''}">${x.getDate()}<br>${DOW[x.getDay()]}</th>`; }).join('')}
      <th class="tot">Дней</th><th class="tot">Часов</th></tr></thead><tbody>
      ${d.users.map((u) => { const t = tot(u); return `<tr><td class="nm"><b>${esc(u.name)}</b><small>${ROLES[u.role]}${hrs(u) ? ` · ${num(u.default_hours || 0)} ч/день` : ''}${t.ab ? ` · отсутствий: ${t.ab}` : ''}</small></td>${days.map((ds) => cell(u, ds)).join('')}
        <td class="tot">${t.dn}</td><td class="tot" style="color:var(--accent)">${hrs(u) ? num(t.h) : '—'}</td></tr>`; }).join('') || `<tr><td class="nm" colspan="${days.length + 3}">Нет сотрудников</td></tr>`}
    </tbody></table></div>
    <div class="small muted">Нажмите на ячейку, чтобы отметить выходной, отпуск, больничный или отсутствие, либо поправить часы. Можно сразу указать период «по дату». По умолчанию сотрудники работают во все рабочие дни студии (выходные задаются в Настройках). Часы считаются для руководителей-мастеров: норма в день задаётся в карточке сотрудника. Если мастер не работает в какой-то день, при записи на эту дату он отмечается в списке как «(Н/Р)».</div>`;
  $('#pm', page).onclick = () => go('/users/schedule' + qs({ m: shift(-1) }));
  $('#nm', page).onclick = () => go('/users/schedule' + qs({ m: shift(1) }));
  $('#cm', page).onclick = () => go('/users/schedule');
  $$('td.c', page).forEach((td) => (td.onclick = () => {
    const u = d.users.find((x) => x.id === +td.dataset.u), ds = td.dataset.d, i = info(u, ds), e = E[u.id + '|' + ds];
    const m = modal(`${u.name} · ${dmy(ds)}`, `
      <div class="field"><label>Статус</label><div class="chips" id="stc">${Object.entries(d.statuses).map(([k, t]) => `<label class="chip ${i.st === k ? 'on' : ''}"><input type="radio" name="status" value="${k}" hidden ${i.st === k ? 'checked' : ''}>${t}</label>`).join('')}</div></div>
      <div class="row">${hrs(u) ? `<div class="field" id="hF"><label>Часов (норма ${num(u.default_hours || 0)})</label><input name="hours" type="number" step="0.5" min="0" max="24" value="${e && e.hours != null ? e.hours : ''}" placeholder="${num(u.default_hours || 0)}"></div>` : ''}
      <div class="field"><label>По дату (включительно)</label><input type="date" name="to" min="${ds}" placeholder="только этот день"></div></div>
      <div class="field"><label>Комментарий</label><input name="note" value="${esc(e?.note || '')}" placeholder="например: отпросился к врачу"></div>
      ${e ? `<div class="small muted">Изменено вручную${e.updated_by_name ? ': ' + esc(e.updated_by_name) : ''}</div>` : ''}`,
    { footer: `${e ? '<button type="button" class="ghost" data-rst style="margin-right:auto">↺ Как по графику</button>' : ''}<button type="button" data-x>Отмена</button><button class="primary">Сохранить</button>`,
      onOpen: (f, close) => {
        const sync = () => { $$('#stc .chip', f).forEach((c) => c.classList.toggle('on', $('input', c).checked)); const hf = $('#hF', f); if (hf) hf.classList.toggle('hidden', f.querySelector('input[name=status]:checked')?.value !== 'work'); };
        $('#stc', f).onchange = sync; sync();
        const r = $('[data-rst]', f); if (r) r.onclick = async () => { await PUT('/api/schedule', { user_id: u.id, date: ds, to: f.to.value, reset: 1 }); ABS = {}; close(); navigate(); };
      },
      onSubmit: async (v) => { const st = v.status || 'work';
        await PUT('/api/schedule', { user_id: u.id, date: ds, to: v.to, status: st, hours: st === 'work' ? v.hours : '', note: v.note });
        ABS = {}; toast('Сохранено'); navigate(); } });
  }));
});

// ================= Руководители: часы, нормочас, выплата =================
route(/^\/users\/seniors$/, async (page, query) => {
  const month = query.m || today().slice(0, 7);
  const [d, users] = await Promise.all([GET('/api/mgmt' + qs({ month })), GET('/api/users')]);
  const seniors = users.filter((u) => u.role === 'senior');
  const shift = (n) => { const t = new Date(month + '-15T12:00'); t.setMonth(t.getMonth() + n); return ymd(t).slice(0, 7); };
  const mName = `${MONTHS_NOM[+month.slice(5, 7) - 1]} ${month.slice(0, 4)}`;
  const paid = d.payouts.filter((x) => !x.cancelled);
  page.innerHTML = `<div class="topbar"><h1>Сотрудники</h1>${staffTabs('mgmt')}<div class="sp"></div>
    <div class="inline"><button id="pm">‹</button><b style="min-width:130px;text-align:center">${mName}</b><button id="nm">›</button><button id="cm">Текущий</button></div>
    <button class="primary" id="addS">+ Руководитель</button></div>
  <div class="grid g4" style="margin-bottom:14px">
    <div class="kpi"><div class="l">Остаток всех денег сейчас</div><div class="v acc">${rub(d.balance)}</div><div class="small muted">нал. ${num(d.balances.cash)} · карта ${num(d.balances.card)} · счёт ${num(d.balances.transfer)}</div></div>
    <div class="kpi"><div class="l">Часов руководителей за месяц</div><div class="v">${num(d.hours)} ч</div></div>
    <div class="kpi"><div class="l">Стоимость нормочаса</div><div class="v ok">${d.hours ? rub(d.rate) : '—'}</div><div class="small muted">остаток ÷ все часы</div></div>
    <div class="kpi"><div class="l">Обязательные расходы</div><div class="v bad">${rub(d.exp_total)}</div><div class="small muted">по ${rub(d.share)} на каждого (÷${d.rows.length || 0})</div></div></div>
  <div class="grid g-main"><div>
    <div class="card"><h2>Распределение по руководителям</h2>
      ${d.rows.length ? `<div class="tblwrap"><table class="tbl resp"><thead><tr><th>Руководитель</th><th class="r">Дней</th><th class="r">Часов</th><th class="r">Доход по часам</th><th class="r">Обяз. расходы</th><th class="r">Чистый доход</th></tr></thead><tbody>
      ${d.rows.map((x) => `<tr class="click" data-u="${x.id}"><td data-l="Руководитель"><b>${esc(x.name)}</b><div class="small muted">норма ${num(x.default_hours || 0)} ч/день</div></td><td data-l="Дней" class="r">${x.days}</td><td data-l="Часов" class="r mono">${num(x.hours)}</td>
        <td data-l="Доход по часам" class="r mono">${rub(x.gross)}</td><td data-l="Обяз. расходы" class="r mono" style="color:var(--bad)">−${rub(x.share)}</td>
        <td data-l="Чистый доход" class="r mono"><b style="color:${x.net < 0 ? 'var(--bad)' : 'var(--ok)'}">${rub(x.net)}</b></td></tr>`).join('')}
      <tr><td data-l=""><b>Итого</b></td><td></td><td data-l="Часов" class="r mono"><b>${num(d.hours)}</b></td><td data-l="Доход" class="r mono"><b>${rub(d.rows.reduce((a, x) => a + x.gross, 0))}</b></td><td data-l="Расходы" class="r mono" style="color:var(--bad)"><b>−${rub(d.exp_total)}</b></td><td data-l="К выплате" class="r mono"><b>${rub(d.pay_total)}</b></td></tr>
      </tbody></table></div>
      <div class="inline" style="margin-top:12px;flex-wrap:wrap"><button class="primary" id="payAll" ${d.pay_total > 0 ? '' : 'disabled'}>💸 Выплатить зарплату всем руководителям · ${rub(d.pay_total)}</button>
        <a class="btn sm" href="#/users/schedule${month !== today().slice(0, 7) ? '?m=' + month : ''}">Поправить часы в графике</a></div>
      ${d.rows.some((x) => x.net < 0) ? '<div class="small" style="color:var(--bad);margin-top:6px">У кого чистый доход отрицательный, тому выплачивается 0.</div>' : ''}`
      : '<div class="empty">Нет руководителей-мастеров. Добавьте сотрудника с ролью «Руководитель-мастер».</div>'}
      <div class="small muted" style="margin-top:10px">Нормочас = остаток всех денег (наличные + карта + счёт) ÷ часы всех руководителей за месяц. Доход по часам = часы × нормочас. Обязательные расходы делятся поровну на всех руководителей и вычитаются. Часы берутся из графика работы.
      Справочно, ещё не выплачено: мастерам за месяц ${rub(d.info.masters_due)}, долг контрагентам ${rub(d.info.contractors_debt)}.</div></div>
    ${d.payouts.length ? `<div class="card"><h2>Выплаты за ${mName.toLowerCase()}</h2>${d.payouts.map((x) => `<div class="li"><div class="grow"><div class="t"><b>${rub(x.total)}</b> · ${dt(x.created_at)}${x.user ? ' · ' + esc(x.user) : ''}${x.cancelled ? ' <span class="badge">операция удалена в кассе</span>' : ''}</div>
      <div class="s">${x.details.map((r) => `${esc(r.name)}: ${rub(r.pay)} (${num(r.hours)} ч)`).join(' · ')}</div></div></div>`).join('')}</div>` : ''}
  </div><div>
    <form class="card" id="expF"><h2>Обязательные расходы за месяц</h2>
      <div id="expL">${d.expenses.filter((e) => e.name !== '—' || e.amount).map((e) => expRow(e)).join('')}</div>
      <div class="inline" style="margin:6px 0 12px;flex-wrap:wrap">${['Аренда', 'Кредит', 'Налог'].map((n) => `<button type="button" class="sm" data-addexp="${n}">+ ${n}</button>`).join('')}<button type="button" class="sm" data-addexp="">+ Своя строка</button></div>
      <div class="totals" style="width:100%"><div class="big"><span>Итого</span><span class="mono" id="expT">${rub(d.exp_total)}</span></div></div>
      <button class="primary" style="margin-top:10px">Сохранить и пересчитать</button>
      <div class="small muted" style="margin-top:8px">Для нового месяца строки переносятся из прошлого — поправьте суммы. Сами платежи (аренда, кредит, налог) проводите в «Финансах» как расход.</div></form>
    <div class="card"><h2>Руководители</h2>${seniors.map((u) => `<div class="li click" data-u="${u.id}"><div class="grow"><div class="t"><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="badge">отключён</span>'}</div><div class="s">${esc(u.login)} · ${num(u.default_hours || 0)} ч/день${u.phone ? ' · ' + esc(u.phone) : ''}</div></div>${u.max_linked ? '<span class="badge ok">MAX</span>' : ''}</div>`).join('') || '<div class="muted">Пока нет</div>'}</div>
  </div></div>`;
  $('#pm', page).onclick = () => go('/users/seniors' + qs({ m: shift(-1) }));
  $('#nm', page).onclick = () => go('/users/seniors' + qs({ m: shift(1) }));
  $('#cm', page).onclick = () => go('/users/seniors');
  $('#addS', page).onclick = () => userModal({ role: 'senior', active: 1, salary_percent: 0, default_hours: 8 });
  $$('[data-u]', page).forEach((el) => (el.onclick = () => { const u = users.find((x) => x.id === +el.dataset.u); if (u) userModal(u); }));
  // расходы
  const f = $('#expF', page), L = $('#expL', f);
  const recalc = () => { $('#expT', f).textContent = rub($$('input[name=amount]', L).reduce((a, i) => a + (+i.value || 0), 0)); };
  const bindRows = () => { $$('[data-delexp]', L).forEach((b) => (b.onclick = () => { b.closest('.exprow').remove(); recalc(); })); L.oninput = recalc; };
  $$('[data-addexp]', f).forEach((b) => (b.onclick = () => { L.insertAdjacentHTML('beforeend', expRow({ name: b.dataset.addexp, amount: '' })); bindRows(); const r = L.lastElementChild; $(b.dataset.addexp ? 'input[name=amount]' : 'input[name=name]', r).focus(); }));
  bindRows();
  f.onsubmit = async (e) => { e.preventDefault();
    const items = $$('.exprow', L).map((r) => ({ name: $('input[name=name]', r).value, amount: $('input[name=amount]', r).value }));
    await PUT('/api/mgmt/expenses', { month, items }); toast('Расходы сохранены'); navigate(); };
  // выплата
  const pb = $('#payAll', page);
  if (pb) pb.onclick = () => modal('Выплата зарплаты руководителям', `
    <div class="small muted" style="margin-bottom:8px">${mName}. Будет проведена <b>одна операция</b> расхода в «Финансах» — статья «Зарплата руководителей».</div>
    ${d.rows.map((x) => `<div class="li"><div class="grow"><b>${esc(x.name)}</b> <span class="muted small">${num(x.hours)} ч × ${rub(d.rate)} − ${rub(x.share)}</span></div><span class="mono">${rub(x.pay)}</span></div>`).join('')}
    <div class="totals" style="width:100%;margin:8px 0"><div class="big"><span>Всего</span><span class="mono">${rub(d.pay_total)}</span></div></div>
    ${paid.length ? `<div class="offwarn">⚠️ За этот месяц уже была выплата ${rub(paid[0].total)} (${dt(paid[0].created_at)}). Будет ещё одна.</div>` : ''}
    <div class="field"><label>Из какой кассы</label><select name="method">${Object.entries(WALLET).map(([k, t]) => `<option value="${k}" ${k === 'cash' ? 'selected' : ''}>${t} — сейчас ${rub(d.balances[k])}</option>`).join('')}</select></div>`,
  { submit: 'Выплатить', onSubmit: async (v) => {
      if (d.balances[v.method] < d.pay_total && !(await confirmBox(`В кассе «${WALLET[v.method]}» сейчас ${rub(d.balances[v.method])} — меньше суммы выплаты. Всё равно провести?`, 'Провести'))) return false;
      await POST('/api/mgmt/payout', { month, method: v.method, expect_total: d.pay_total }); toast('Выплата проведена — операция в «Финансах»'); navigate(); } });
});
function expRow(e) {
  return `<div class="exprow row" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto;align-items:end;margin-bottom:6px"><div class="field" style="margin:0"><input name="name" value="${esc(e.name || '')}" placeholder="Название расхода"></div>
    <div class="field" style="margin:0"><input name="amount" type="number" step="any" min="0" value="${e.amount === '' ? '' : esc(e.amount)}" placeholder="Сумма, ₽"></div><button type="button" class="ghost sm danger" data-delexp title="Убрать">✕</button></div>`;
}

// ================= Настройки =================
async function loadUpdateCard(page) {
  const box = $('#updCard', page); if (!box) return;
  let u;
  try { u = await GET('/api/admin/update'); } catch (e) { box.innerHTML = '<h2>Обновление и домен</h2><div class="muted">Сервер перезапускается, подождите…</div>'; setTimeout(() => pollUpdate(page), 4000); return; }
  const running = u.pending || (u.log && !/=== (Готово|Ошибка)/.test(u.log) && /=== Старт/.test(u.log));
  box.innerHTML = `<h2>Обновление и домен</h2>
    <div class="small muted" style="margin-bottom:10px">Версия CRM: <b>${esc(u.version)}</b>${u.domain ? ` · домен: <b>${esc(u.domain)}</b>` : ' · домен не подключён'}</div>
    ${u.updater ? '' : '<div class="small" style="color:var(--warn);margin-bottom:10px">Кнопки заработают после одной установки из консоли сервера (команда go.sh).</div>'}
    <button type="button" class="primary" id="updBtn" ${running ? 'disabled' : ''}>${running ? '⏳ Идёт обновление…' : '⟳ Обновить CRM'}</button>
    <h3 style="margin-top:16px">Подключить домен с HTTPS</h3>
    <div class="small muted" style="margin-bottom:8px">Сначала у регистратора создайте A-запись домена на IP сервера <b>${esc(location.hostname)}</b> и подождите 10–30 минут.</div>
    <div class="row"><div class="field"><label>Домен</label><input id="dom" placeholder="crm.boomsystem.ru" value="${esc(u.domain || '')}"></div>
    <div class="field"><label>Email для сертификата</label><input id="dmail" type="email" value="${esc(u.email || '')}"></div></div>
    <button type="button" id="domBtn" ${running ? 'disabled' : ''}>🔒 Подключить домен</button>
    ${u.log ? `<details ${running ? 'open' : ''} style="margin-top:12px"><summary class="muted small" style="cursor:pointer">Журнал последнего обновления</summary><pre class="code" style="max-height:260px;overflow:auto">${esc(u.log)}</pre></details>` : ''}`;
  const start = async (body, msg) => {
    try { await POST('/api/admin/update', body); toast(msg); } catch (e) { return toast(e.message, true); }
    setTimeout(() => pollUpdate(page), 3000);
    loadUpdateCard(page);
  $$('#doff input', page).forEach((cb) => cb.addEventListener('change', () => {
    cb.parentElement.classList.toggle('on', cb.checked);
    $('input[name=days_off]', page).value = $$('#doff input:checked', page).map((x) => x.value).join(',');
  }));
  if (s.max_token) GET('/api/max/status').then((st) => {
    $('#maxStatus', page).innerHTML = st.ok && st.bot ? `<span style="color:var(--ok)">✓ Подключён бот <b>${esc(st.bot.name || '')}</b>${st.bot.username ? ' (@' + esc(st.bot.username) + ')' : ''}</span>${st.group ? ' · общий чат подключён' : ' · общий чат не подключён'}`
      : `<span style="color:var(--bad)">Нет связи с MAX: ${esc(st.error || 'неизвестная ошибка')}</span>`;
  }).catch(() => {});
  $('#maxTest', page).onclick = async () => { try { await POST('/api/max/test'); toast('Сообщение отправлено в MAX'); } catch (e) { toast(e.message, true); } };
  $('#digNow', page).onclick = async () => { await POST('/api/max/digest-now'); toast('Сводка отправлена'); };
  };
  $('#updBtn', box).onclick = async () => { if (await confirmBox('Обновить CRM до последней версии? Займёт 1–3 минуты, данные сохранятся.', 'Обновить')) start({}, 'Обновление запущено'); };
  $('#domBtn', box).onclick = async () => {
    const domain = $('#dom', box).value.trim(); if (!domain) return toast('Введите домен', true);
    if (await confirmBox(`Подключить ${domain}? После этого CRM будет открываться по адресу https://${domain}`, 'Подключить')) start({ domain, email: $('#dmail', box).value.trim(), server_ip: location.hostname }, 'Подключаю домен, 2–4 минуты…');
  };
  if (running) setTimeout(() => pollUpdate(page), 4000);
}
function pollUpdate(page) { if (location.hash.startsWith('#/settings')) loadUpdateCard(page).catch(() => setTimeout(() => pollUpdate(page), 4000)); }
route(/^\/settings$/, async (page, query = {}) => {
  const s = await GET('/api/settings');
  const origin = location.origin;
  page.innerHTML = `<div class="topbar"><h1>Настройки</h1></div>
  <form id="sf"><div class="grid g2">
    <div class="card"><h2>Студия</h2>
      <div class="field"><label>Название</label><input name="company_name" value="${esc(s.company_name)}"></div>
      <div class="field"><label>Подзаголовок</label><input name="company_subtitle" value="${esc(s.company_subtitle)}"></div>
      <div class="field"><label>Адрес</label><input name="company_address" value="${esc(s.company_address)}"></div>
      <div class="row"><div class="field"><label>Телефон</label><input name="company_phone" value="${esc(s.company_phone)}"></div><div class="field"><label>ИНН</label><input name="company_inn" value="${esc(s.company_inn)}"></div></div>
      <div class="field"><label>Реквизиты для документов (ИП/ООО, ОГРН, р/с)</label><textarea name="company_requisites">${esc(s.company_requisites)}</textarea></div></div>
    <div class="card"><h2>Запись</h2>
      <div class="field"><label>Посты (через запятую)</label><input name="bays" value="${esc(s.bays)}"></div>
      <div class="field"><label>Сайт ателье на главной странице</label><select name="landing_on"><option value="1" ${s.landing_on !== '0' ? 'selected' : ''}>Включён — по адресу сервера открывается сайт, CRM — по кнопке «Вход» (/crm)</option><option value="0" ${s.landing_on === '0' ? 'selected' : ''}>Выключен — сразу открывается CRM</option></select></div>
      <div class="field"><label>Наценка при безналичной оплате, %</label><input type="number" name="cashless_markup" min="0" max="50" step="any" value="${esc(s.cashless_markup)}"></div>
      <div class="field"><label>Эквайринг (комиссия банка с оплат через терминал), %</label><input type="number" name="acquiring_percent" min="0" max="10" step="any" value="${esc(s.acquiring_percent ?? '2')}"><div class="small muted">Не добавляется к сумме клиента — автоматически проводится нашим расходом «Эквайринг» с расчётного счёта. Переводы на карту — без эквайринга.</div></div>
      <div class="field"><label>Выходные дни (запись возможна только как исключение)</label><div class="chips" id="doff">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="chip ${(s.days_off || '0').split(',').includes(String(d)) ? 'on' : ''}"><input type="checkbox" value="${d}" hidden ${(s.days_off || '0').split(',').includes(String(d)) ? 'checked' : ''}>${DOW[d]}</label>`).join('')}</div><input type="hidden" name="days_off" value="${esc(s.days_off ?? '0')}"></div>
      <div class="row"><div class="field"><label>Начало дня</label><input type="time" name="work_start" value="${esc(s.work_start)}"></div><div class="field"><label>Конец дня</label><input type="time" name="work_end" value="${esc(s.work_end)}"></div></div>
      <h2 style="margin-top:16px">Тексты документов</h2>
      <div class="field"><label>Условия в заказ-наряде и акте</label><textarea name="order_terms" rows="4">${esc(s.order_terms)}</textarea></div>
      <div class="field"><label>Условия гарантии</label><textarea name="warranty_terms" rows="4">${esc(s.warranty_terms)}</textarea></div></div>
    <div class="card" style="border-color:rgba(59,158,255,.35)"><h2>MAX — бот для сотрудников</h2>
      <ol class="small muted" style="padding-left:18px;margin-top:0">
        <li>На платформе MAX для партнёров (business.max.ru) создайте чат-бота «${esc(s.company_name)}» и дождитесь модерации.</li>
        <li>Скопируйте токен бота (Чат-боты → ⋮ → Настройки) и вставьте ниже, затем «Сохранить настройки».</li>
        <li>Каждый сотрудник подключается сам: кнопка «Подключить мой MAX» внизу меню, или администратор — в карточке сотрудника.</li>
        <li>Для общего чата: добавьте бота в групповой чат MAX и сделайте администратором — события начнут дублироваться туда.</li></ol>
      <div class="field"><label>Токен бота MAX</label><input name="max_token" value="${esc(s.max_token)}" placeholder="вставьте токен" autocomplete="off"></div>
      <div id="maxStatus" class="small muted" style="margin-bottom:10px">${s.max_token ? 'Проверяю подключение…' : 'Бот не подключён'}</div>
      <div class="row"><div class="field"><label>Время вечерней сводки</label><input type="time" name="digest_time" value="${esc(s.digest_time || '19:00')}"></div>
      <div class="field"><label>Общий чат сотрудников</label><select name="max_group_on"><option value="1" ${s.max_group_on !== '0' ? 'selected' : ''}>Дублировать события</option><option value="0" ${s.max_group_on === '0' ? 'selected' : ''}>Не дублировать</option></select></div></div>
      <div class="inline"><button type="button" class="sm" id="maxTest">Отправить мне тест</button><button type="button" class="sm" id="digNow">Прислать сводку сейчас</button></div>
      <div class="small muted" style="margin-top:8px">Руководству: заявки, записи, «готово», выдача с оплатой и долгом, остатки, итоги дня, сообщения мастеров. Мастерам: назначенные заказы с кнопками «В работе / Ждёт запчасти / Готово», переносы, записи на завтра. Кто что получает — в карточке сотрудника.</div></div>
    <div class="card"><h2>Telegram-бот</h2>
      <ol class="small muted" style="padding-left:18px;margin-top:0"><li>Создайте бота у @BotFather, скопируйте токен.</li><li>Создайте группу сотрудников, добавьте туда бота и напишите в группе <code>/id</code> — бот ответит ID чата.</li><li>Клиенты и мастера пишут боту /start и делятся номером — привязка по телефону.</li></ol>
      <div class="field"><label>Токен бота</label><input name="tg_token" value="${esc(s.tg_token)}" placeholder="123456:ABC…"></div>
      <div class="field"><label>ID чата сотрудников</label><input name="tg_staff_chat" value="${esc(s.tg_staff_chat)}" placeholder="-100…"></div>
      <label class="inline" style="color:var(--text);margin-bottom:10px"><input type="checkbox" id="tgc" ${s.tg_notify_client_done === '1' ? 'checked' : ''}> Сообщать клиенту, что авто готово</label>
      <button type="button" class="sm" id="tgTest">Отправить тест</button>
      <div class="small muted" style="margin-top:8px">Бот присылает: новые заявки, новые записи, «авто готово», в 18:00 — список записей на завтра; клиентам — напоминание за день.</div></div>
    <div class="card"><h2>Заявки с сайта</h2>
      <div class="field"><label>Ключ API</label><div class="inline" style="flex-wrap:nowrap"><input value="${esc(s.api_key)}" readonly id="ak"><button type="button" class="sm" id="regen">Новый</button></div></div>
      <div class="small muted">Добавьте форму на сайт — заявки попадут в раздел «Заявки» и в Telegram:</div>
      <pre class="code">&lt;form id="boomForm"&gt;
  &lt;input name="name" placeholder="Имя"&gt;
  &lt;input name="phone" placeholder="Телефон" required&gt;
  &lt;input name="car" placeholder="Марка и модель авто"&gt;
  &lt;textarea name="message" placeholder="Что хотите сделать?"&gt;&lt;/textarea&gt;
  &lt;input name="website" style="display:none"&gt;
  &lt;button&gt;Отправить&lt;/button&gt;
&lt;/form&gt;
&lt;script&gt;
document.getElementById('boomForm').onsubmit = async (e) =&gt; {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target));
  d.source = 'Сайт';
  await fetch('${esc(origin)}/api/public/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': '${esc(s.api_key)}' },
    body: JSON.stringify(d)
  });
  e.target.innerHTML = 'Спасибо! Мы перезвоним.';
};
&lt;/script&gt;</pre>
      <div class="small muted">Тот же адрес подходит для Тильды (вебхук), квизов и чат-ботов: POST JSON или form-data, поля name, phone, car, message, source, ключ — в заголовке X-API-Key или параметре ?key=.</div></div>
    <div class="card"><h2>Резервные копии</h2><div class="small muted" style="margin-bottom:10px">Сервер делает копию базы каждую ночь и хранит 30 последних. Скачивайте копию себе раз в неделю.</div>
      <a class="btn" href="/api/backup">⬇ Скачать копию базы</a></div>
  </div><div style="margin-top:14px"><button class="primary">Сохранить настройки</button></div></form>
  <div class="grid g2" style="margin-top:14px">
    <div class="card" id="updCard"><h2>Обновление и домен</h2><div class="muted">Загрузка…</div></div>
    <div class="card" id="alfaCard"><h2>Альфа-Банк (Alfa API)</h2><div class="muted">Загрузка…</div></div>
    <div class="card" id="sabyCard"><h2>Онлайн-касса Saby</h2><div class="muted">Загрузка…</div></div>
    <div class="card" id="revCard"><h2>Отзывы на сайте</h2><div class="muted">Загрузка…</div></div>
    <div class="card"><h2>Импорт журнала из Excel</h2>
      <div class="small muted" style="margin-bottom:10px">Загрузите файл <b>journal-import.json</b>, подготовленный из вашей таблицы «Журнал записи». Записи появятся в календаре как заметки с теми же цветами. Повторная загрузка не создаёт дублей.</div>
      <input type="file" id="jfile" accept=".json,application/json" style="display:none"><button type="button" id="jbtn">⬆ Загрузить файл журнала</button></div>
  </div>`;
  $('#jbtn', page).onclick = () => $('#jfile', page).click();
  $('#jfile', page).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await POST('/api/cal-notes/import', { notes: Array.isArray(data) ? data : data.notes });
      toast(`Импортировано записей: ${r.added} из ${r.total}`);
    } catch (err) { toast('Не удалось импортировать: ' + err.message, true); }
    e.target.value = '';
  };
  loadUpdateCard(page);
  loadAlfaCard(page, query);
  loadSabyCard(page);
  loadReviewsCard(page);
  $('#sf', page).onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target); d.tg_notify_client_done = $('#tgc', page).checked ? '1' : '0';
    try { await PUT('/api/settings', d); S.me = await GET('/api/me'); toast('Настройки сохранены'); renderShell(); navigate(); } catch (err) { toast(err.message, true); }
  };
  $('#tgTest', page).onclick = async () => {
    try { const d = formData($('#sf', page)); d.tg_notify_client_done = $('#tgc', page).checked ? '1' : '0'; await PUT('/api/settings', d); await POST('/api/telegram/test'); toast('Сообщение отправлено'); } catch (e) { toast(e.message, true); }
  };
  $('#regen', page).onclick = async () => { if (await confirmBox('Старый ключ перестанет работать — формы на сайте нужно будет обновить. Продолжить?', 'Создать новый')) { await POST('/api/settings/regen-key'); navigate(); } };
});

boot();
