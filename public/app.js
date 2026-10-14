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
const today = () => ymd(new Date());
const dmy = (s) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '');
const dt = (s) => (s ? dmy(s) + (s.length > 10 ? ' ' + s.slice(11, 16) : '') : '');
const orderNo = (id) => 'БС-' + String(id).padStart(5, '0');
const carStr = (o) => [o.brand, o.model].filter(Boolean).join(' ') + (o.plate ? ` · ${o.plate}` : '');
const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const METHODS = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод' };
const ROLES = { admin: 'Администратор', manager: 'Менеджер', master: 'Мастер' };
const LEAD_ST = { new: 'Новая', work: 'В работе', converted: 'Заказ создан', lost: 'Отказ' };
const SOURCES = ['Рекомендация', 'Авито', 'Яндекс Карты', '2ГИС', 'ВКонтакте', 'Telegram', 'Instagram', 'Сайт', 'Проезжал мимо', 'Постоянный клиент'];
const EXPENSE_CATS = ['Аренда', 'Закупка товара', 'Расходники', 'Зарплата', 'Коммунальные', 'Реклама', 'Инструмент', 'Налоги', 'Прочее'];
const INCOME_CATS = ['Оплата заказа', 'Продажа без заказа', 'Внесение в кассу', 'Прочее'];

const S = { me: null, staff: [], services: null };
const role = () => S.me.user.role;
const isOffice = () => role() !== 'master';
const isAdmin = () => role() === 'admin';
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
    else o[el.name] = el.value;
  }
  return o;
}
function opts(list, cur, empty) {
  return (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    list.map((x) => { const [v, t] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${esc(t)}</option>`; }).join('');
}
const masters = () => S.staff.filter((u) => u.role === 'master' || u.role === 'admin');

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
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
};

// ================= Каркас =================
const NAV = [
  ['/', 'Главная', 'home', 'all'],
  ['/calendar', 'Календарь', 'cal', 'all'],
  ['/orders', 'Заказ-наряды', 'orders', 'all'],
  ['/clients', 'Клиенты', 'clients', 'office'],
  ['/leads', 'Заявки', 'leads', 'office'],
  ['/stock', 'Склад', 'stock', 'office'],
  ['/services', 'Услуги и цены', 'services', 'office'],
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
    <div class="logo"><div class="mark">Б</div><div><b>${esc(S.me.company)}</b><span>CRM автозвук и тюнинг</span></div></div>
    <nav class="nav">${allowed.map(([p, t, ic]) => `<a href="#${p}" data-p="${p}">${ICONS[ic]}<span>${t}</span>${p === '/leads' ? '<span class="badge red hidden" id="leadsBadge"></span>' : ''}</a>`).join('')}</nav>
    <div class="foot"><div class="who">${esc(u.name)}</div><div class="role">${ROLES[u.role]}</div>
      <div class="inline"><button class="sm" id="myPass">Пароль</button><button class="sm" id="logout">Выйти</button></div></div>
  </aside><main class="main" id="page"></main></div>`;
  $('#logout').onclick = async () => { await POST('/api/logout'); S.me = null; renderLogin(); };
  $('#myPass').onclick = changeMyPassword;
  $('#burger').onclick = () => $('#side').classList.toggle('open');
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
}

function setActiveNav(path) {
  $$('.nav a').forEach((a) => {
    const p = a.dataset.p;
    a.classList.toggle('active', p === '/' ? path === '/' : path.startsWith(p));
  });
}

async function refreshLeadsBadge() {
  if (!isOffice()) return;
  try {
    const d = await GET('/api/leads?status=new');
    const b = $('#leadsBadge'); if (!b) return;
    b.textContent = d.length; b.classList.toggle('hidden', !d.length);
  } catch {}
}

function changeMyPassword() {
  modal('Сменить пароль', `<div class="field"><label>Текущий пароль</label><input type="password" name="old" required></div>
    <div class="field"><label>Новый пароль (от 6 символов)</label><input type="password" name="new" minlength="6" required></div>`,
  { onSubmit: async (d) => { await POST('/api/me/password', d); toast('Пароль изменён'); } });
}

function renderLogin() {
  $('#root').innerHTML = `<div class="login"><form class="box card" id="lf">
    <div class="logo"><div class="mark">Б</div><div><b>Бумсистем</b><span>CRM автозвук и тюнинг</span></div></div>
    <div class="field"><label>Логин</label><input name="login" autocomplete="username" required></div>
    <div class="field"><label>Пароль</label><input name="password" type="password" autocomplete="current-password" required></div>
    <button class="primary" style="width:100%;justify-content:center;padding:10px">Войти</button></form></div>`;
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

async function services() { if (!S.services) S.services = await GET('/api/services'); return S.services; }

// ================= Главная =================
route(/^\/$/, async (page) => {
  const d = await GET('/api/dashboard');
  const d0 = new Date();
  const stCounts = Object.fromEntries(d.by_status.map((x) => [x.status, x.n]));
  page.innerHTML = `<div class="topbar"><div><h1>${d0.getHours() < 12 ? 'Доброе утро' : d0.getHours() < 18 ? 'Добрый день' : 'Добрый вечер'}, ${esc(S.me.user.name.split(' ')[0])}</h1>
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
    <div class="card"><h2>Записи на сегодня</h2>${d.today.length ? `<div class="list">${d.today.map((o) => `
      <div class="li click" data-o="${o.id}"><div class="time">${o.scheduled_at.slice(11, 16)}</div><div class="grow"><div class="t">${esc(o.client)} <span class="muted small">${esc(o.phone || '')}</span></div>
      <div class="s">${esc(carStr(o))}${o.bay ? ' · ' + esc(o.bay) : ''}${o.master ? ' · ' + esc(o.master) : ''}</div></div>${stBadge(o.status)}</div>`).join('')}</div>` : '<div class="empty">На сегодня записей нет</div>'}</div>
    <div class="card"><h2>В работе</h2>${d.in_work.length ? `<div class="list">${d.in_work.map((o) => `
      <div class="li click" data-o="${o.id}"><div class="grow"><div class="t">${orderNo(o.id)} · ${esc(o.client)}</div><div class="s">${esc(carStr(o))}${o.master ? ' · ' + esc(o.master) : ''}</div></div>${stBadge(o.status)}</div>`).join('')}</div>` : '<div class="empty">Нет автомобилей в работе</div>'}</div>
  </div><div>
    ${d.new_leads ? `<a class="card" href="#/leads" style="display:block;border-color:var(--accent);color:inherit;text-decoration:none;margin-bottom:14px"><h2 style="margin:0">🔥 Новых заявок: ${d.new_leads}</h2><div class="muted small">Перезвоните, пока клиент тёплый</div></a>` : ''}
    ${d.debts ? `<div class="card"><h2>Долги клиентов</h2>${d.debts.length ? `<div class="list">${d.debts.map((x) => `<div class="li click" data-o="${x.id}"><div class="grow"><div class="t">${esc(x.client)}</div><div class="s">${orderNo(x.id)}</div></div><b class="mono">${rub(x.total - x.paid)}</b></div>`).join('')}</div>` : '<div class="empty">Долгов нет</div>'}</div>` : ''}
    ${d.low_stock ? `<div class="card"><h2>Заканчивается на складе</h2>${d.low_stock.length ? `<div class="list">${d.low_stock.map((p) => `<div class="li"><div class="grow t">${esc(p.name)}</div><span class="badge warn">${num(p.stock)} ${esc(p.unit)}</span></div>`).join('')}</div>` : '<div class="empty">Всё в наличии</div>'}</div>` : ''}
  </div></div>`;
  page.addEventListener('click', (e) => { const li = e.target.closest('[data-o]'); if (li) go('/orders/' + li.dataset.o); });
  const nb = $('#newOrder', page); if (nb) nb.onclick = () => newOrderModal();
});

// ================= Новый заказ =================
async function newOrderModal(pre = {}) {
  const bays = S.me.bays;
  const m = modal('Новый заказ-наряд', `
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
      <div class="field"><label>Длительность, ч</label><input type="number" name="duration_h" value="${pre.duration_h || 2}" step="0.5" min="0.5"></div>
      <div class="field"><label>Бокс</label><select name="bay">${opts(bays, pre.bay, '—')}</select></div>
      <div class="field"><label>Мастер</label><select name="master_id">${opts(masters().map((u) => [u.id, u.name]), pre.master_id, '—')}</select></div></div>
    <div class="field"><label>Что хочет клиент</label><textarea name="complaint" placeholder="Например: замена штатной акустики, шумоизоляция дверей, сабвуфер в багажник">${esc(pre.complaint || '')}</textarea></div>`,
  { wide: true, submit: 'Создать заказ', onSubmit: async (d) => {
    const body = { client_id: d.client_id || null, lead_id: d.lead_id || null, car_id: d.car_id || null, scheduled_at: d.scheduled_at || null,
      duration_min: Math.round((+d.duration_h || 2) * 60), bay: d.bay, master_id: d.master_id, complaint: d.complaint };
    if (!body.client_id) {
      if (!d.nc_name) { toast('Выберите клиента или заполните нового', true); return false; }
      body.new_client = { name: d.nc_name, phone: d.nc_phone, source: d.nc_source };
    }
    if (!body.car_id) body.new_car = { brand: d.car_brand, model: d.car_model, plate: d.car_plate, year: d.car_year };
    const r = await POST('/api/orders', body);
    toast('Заказ ' + orderNo(r.id) + ' создан');
    go('/orders/' + r.id);
  } });
  const f = m.form;
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
    ${isOffice() ? '<button class="primary" id="newOrder">+ Новый заказ</button>' : ''}</div>
    <div class="chips" style="margin-bottom:12px">${[['active', 'Активные'], ...Object.entries(S.me.statuses), ['', 'Все']].map(([k, t]) => `<button class="chip ${k === st ? 'on' : ''}" data-st="${k}">${t}</button>`).join('')}</div>
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
  await load();
});

route(/^\/orders\/(\d+)$/, async (page, id) => {
  const o = await GET('/api/orders/' + id);
  const office = isOffice();
  const statusButtons = (role() === 'master' ? ['in_work', 'waiting', 'done'] : Object.keys(S.me.statuses));
  const t = o.totals;
  const svc = o.items.filter((i) => i.kind === 'service'); const prd = o.items.filter((i) => i.kind === 'product');
  const itemRows = (list, kind) => list.map((i) => `<tr data-item="${i.id}">
    <td data-l="Позиция" style="min-width:240px">${office ? `<input value="${esc(i.name)}" data-f="name" title="${esc(i.name)}">` : esc(i.name)}</td>
    ${kind === 'service' ? `<td data-l="Мастер">${office ? `<select data-f="master_id">${opts(masters().map((u) => [u.id, u.name]), i.master_id, '—')}</select>` : esc(i.master_name || '—')}</td>` : ''}
    <td data-l="Кол-во" style="width:90px">${office ? `<input type="number" step="any" min="0" value="${i.qty}" data-f="qty">` : i.qty}</td>
    <td data-l="Цена" style="width:120px">${office ? `<input type="number" step="any" min="0" value="${i.price}" data-f="price">` : num(i.price)}</td>
    <td data-l="Сумма" class="r mono" style="width:110px">${num(i.qty * i.price)}</td>
    <td data-l="Гарантия" style="width:80px">${office ? `<input type="number" min="0" value="${i.warranty_months}" data-f="warranty_months" title="Гарантия, мес.">` : (i.warranty_months || '—')}</td>
    ${office ? `<td style="width:40px"><button type="button" class="ghost sm danger" data-del="${i.id}" title="Удалить">✕</button></td>` : ''}</tr>`).join('');
  const issuedLocked = o.status === 'issued';

  page.innerHTML = `<div class="topbar"><button class="ghost" onclick="history.back()">←</button><h1>Заказ ${o.number}</h1>${stBadge(o.status)}<div class="sp"></div>
    ${office ? `<div class="inline"><a class="btn sm" target="_blank" href="/print/order/${o.id}/naryad">🖨 Заказ-наряд</a><a class="btn sm" target="_blank" href="/print/order/${o.id}/act">🖨 Акт</a><a class="btn sm" target="_blank" href="/print/order/${o.id}/warranty">🖨 Гарантия</a></div>` : ''}</div>
  <div class="card" style="margin-bottom:14px"><h3>Статус</h3><div class="pipe">${statusButtons.map((s) => `<button type="button" data-st="${s}" class="${s === o.status ? 'cur' : ''}">${S.me.statuses[s]}</button>`).join('')}</div>
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
      <div><span class="muted">Оплачено</span><span class="mono">${rub(t.paid)}</span></div>
      <div style="font-weight:700;color:${t.due > 0.5 ? 'var(--warn)' : 'var(--ok)'}"><span>${t.due < -0.5 ? 'Переплата' : 'К оплате'}</span><span class="mono">${rub(Math.abs(t.due))}</span></div>
      <div style="margin-top:10px;gap:8px;justify-content:flex-end"><button type="button" class="sm" id="refund">Возврат</button><button type="button" class="primary" id="pay">Принять оплату</button></div>
    </div>
    ${o.payments.length ? `<h3 style="margin-top:14px">Платежи</h3><table class="tbl"><tbody>${o.payments.map((p) => `<tr><td class="nowrap">${dt(p.created_at)}</td><td>${p.direction === 'out' ? 'Возврат' : 'Оплата'} · ${METHODS[p.method] || p.method}</td><td class="muted">${esc(p.user || '')}</td><td class="r mono" style="color:${p.direction === 'out' ? 'var(--bad)' : 'inherit'}">${p.direction === 'out' ? '−' : ''}${rub(p.amount)}</td></tr>`).join('')}</tbody></table>` : ''}</div>` : ''}
  </div><div>
    <div class="card"><h2>Клиент и автомобиль</h2>
      <div class="field"><b>${o.client_id && office ? `<a href="#/clients/${o.client_id}">${esc(o.client_name)}</a>` : esc(o.client_name || '—')}</b>
      ${o.client_phone ? `<div><a href="tel:${esc(o.client_phone)}">${esc(o.client_phone)}</a></div>` : ''}</div>
      <div class="field"><div>${esc([o.brand, o.model, o.year].filter(Boolean).join(' ') || '—')}</div>
      <div class="muted small">${o.plate ? 'Госномер ' + esc(o.plate) : ''}${o.vin ? ' · VIN ' + esc(o.vin) : ''}${o.color ? ' · ' + esc(o.color) : ''}</div></div>
    </div>
    <form class="card" id="of"><h2>Детали</h2>
      <div class="field"><label>Запись</label><input type="datetime-local" name="scheduled_at" value="${esc(o.scheduled_at || '')}" step="900" ${office ? '' : 'disabled'}></div>
      <div class="row"><div class="field"><label>Длительность, ч</label><input type="number" name="duration_h" value="${(o.duration_min || 120) / 60}" step="0.5" min="0.5" ${office ? '' : 'disabled'}></div>
      <div class="field"><label>Бокс</label><select name="bay" ${office ? '' : 'disabled'}>${opts(S.me.bays, o.bay, '—')}</select></div></div>
      <div class="row"><div class="field"><label>Мастер</label><select name="master_id" ${office ? '' : 'disabled'}>${opts(masters().map((u) => [u.id, u.name]), o.master_id, '—')}</select></div>
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
    if (st === 'issued' && t.due > 0.5 && !(await confirmBox(`По заказу не оплачено ${rub(t.due)}. Всё равно выдать автомобиль?`, 'Выдать'))) return;
    if (st === 'cancelled' && !(await confirmBox('Отменить заказ?', 'Отменить заказ'))) return;
    try { await POST(`/api/orders/${o.id}/status`, { status: st }); toast('Статус: ' + S.me.statuses[st]); reload(); } catch (e) { toast(e.message, true); }
  }));
  $('#addCmt', page).onclick = async () => {
    const v = $('#cmt', page).value.trim(); if (!v) return;
    await POST(`/api/orders/${o.id}/comment`, { text: v }); reload();
  };
  $('#cmt', page).onkeydown = (e) => { if (e.key === 'Enter') $('#addCmt', page).click(); };
  if (!office) return;

  $('#of', page).onsubmit = async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    d.duration_min = Math.round((+d.duration_h || 2) * 60); delete d.duration_h;
    try { await PUT('/api/orders/' + o.id, d); toast('Сохранено'); reload(); } catch (err) { toast(err.message, true); }
  };
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
    search: (q) => GET('/api/products' + qs({ q })).then((r) => r.slice(0, 15)),
    render: (p) => `<div>${esc(p.name)} ${p.sku ? `<span class="s">${esc(p.sku)}</span>` : ''}</div><div class="s">${rub(p.price)} · на складе ${num(p.stock)} ${esc(p.unit)}</div>`,
    onPick: async (p) => {
      if (p.stock <= 0 && !(await confirmBox(`«${p.name}» нет на складе (остаток ${num(p.stock)}). Всё равно добавить?`, 'Добавить'))) return;
      try { await POST(`/api/orders/${o.id}/items`, { kind: 'product', ref_id: p.id, qty: 1 }); reload(); } catch (e) { toast(e.message, true); }
    },
  });
  const payModal = (refund) => modal(refund ? 'Возврат клиенту' : 'Принять оплату', `
    <div class="row"><div class="field"><label>Сумма, ₽</label><input type="number" name="amount" step="any" min="0.01" required value="${refund ? '' : Math.max(t.due, 0)}"></div>
    <div class="field"><label>Способ</label><select name="method">${opts(Object.entries(METHODS), 'cash')}</select></div></div>
    <div class="field"><label>Комментарий</label><input name="note"></div>`,
  { submit: refund ? 'Оформить возврат' : 'Принять', onSubmit: async (d) => { await POST(`/api/orders/${o.id}/pay`, { ...d, refund }); toast(refund ? 'Возврат проведён' : 'Оплата принята'); reload(); } });
  $('#pay', page).onclick = () => payModal(false);
  $('#refund', page).onclick = () => payModal(true);
  const dl = $('#delOrder', page);
  if (dl) dl.onclick = async () => { if (await confirmBox('Удалить заказ безвозвратно? Платежи останутся в кассе без привязки.', 'Удалить')) { await DEL('/api/orders/' + o.id); toast('Заказ удалён'); go('/orders'); } };
});

// ================= Календарь =================
route(/^\/calendar$/, async (page, query) => {
  let date = query.d || today();
  let view = query.v || (window.innerWidth < 860 ? 'week' : 'day');
  const [ws, we] = [S.me.work_start, S.me.work_end].map((t) => +t.split(':')[0] + (+t.split(':')[1] || 0) / 60);
  const SLOT = 28; // px на 30 минут
  const render = async () => {
    const d = new Date(date + 'T00:00');
    let from = date, to = date;
    if (view === 'week') { const st = new Date(d); st.setDate(d.getDate() - ((d.getDay() + 6) % 7)); from = ymd(st); const en = new Date(st); en.setDate(st.getDate() + 6); to = ymd(en); }
    const rows = await GET('/api/calendar' + qs({ from, to }));
    const title = view === 'day' ? `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}` : `${dmy(from)} — ${dmy(to)}`;
    page.innerHTML = `<div class="topbar"><h1>Календарь</h1><div class="inline"><button id="prev">‹</button><button id="tod">Сегодня</button><button id="next">›</button></div>
      <b style="font-size:16px">${title}</b><div class="sp"></div><input type="date" id="pick" value="${date}" style="width:auto">
      <div class="chips"><button class="chip ${view === 'day' ? 'on' : ''}" data-v="day">День</button><button class="chip ${view === 'week' ? 'on' : ''}" data-v="week">Неделя</button></div></div><div id="cal"></div>`;
    const box = $('#cal', page);
    if (view === 'day') {
      const cols = S.me.bays.length ? S.me.bays : ['Запись'];
      const unassigned = rows.filter((r) => !r.bay || !cols.includes(r.bay));
      const allCols = unassigned.length ? [...cols, 'Без бокса'] : cols;
      const hours = []; for (let h = Math.floor(ws); h < Math.ceil(we); h++) hours.push(h);
      const pos = (s) => { const [hh, mm] = s.slice(11, 16).split(':').map(Number); return ((hh + mm / 60) - Math.floor(ws)) * 2 * SLOT; };
      box.innerHTML = `<div class="cal" style="grid-template-columns:56px repeat(${allCols.length}, minmax(140px,1fr))">
        <div class="hcol"><div class="colh"></div>${hours.map((h) => `<div class="hl">${pad(h)}:00</div>`).join('')}</div>
        ${allCols.map((c) => `<div class="col"><div class="colh">${esc(c)}</div><div class="cbody" style="position:relative">
          ${hours.map((h) => `<div class="slot" data-t="${pad(h)}:00" data-bay="${esc(c)}"></div><div class="slot hr" data-t="${pad(h)}:30" data-bay="${esc(c)}"></div>`).join('')}
          ${rows.filter((r) => (c === 'Без бокса' ? unassigned.includes(r) : r.bay === c)).map((r) => `<div class="ev st-${r.status}" data-id="${r.id}" style="top:${pos(r.scheduled_at)}px;height:${Math.max((r.duration_min || 60) / 30 * SLOT - 3, 24)}px">
            <b>${r.scheduled_at.slice(11, 16)} ${esc(r.client || '')}</b>${esc(carStr(r))}${r.master ? `<div class="muted">${esc(r.master)}</div>` : ''}${r.complaint ? `<div class="muted">${esc(r.complaint)}</div>` : ''}</div>`).join('')}
        </div></div>`).join('')}</div>`;
      if (date === today()) {
        const n = new Date(); const top = ((n.getHours() + n.getMinutes() / 60) - Math.floor(ws)) * 2 * SLOT;
        if (top > 0 && top < hours.length * 2 * SLOT) $$('.cbody', box).forEach((c) => c.insertAdjacentHTML('beforeend', `<div class="now" style="top:${top}px"></div>`));
      }
      if (isOffice()) $$('.slot', box).forEach((s) => (s.onclick = () => newOrderModal({ scheduled_at: `${date}T${s.dataset.t}`, bay: s.dataset.bay === 'Без бокса' ? '' : s.dataset.bay })));
    } else {
      const st = new Date(from + 'T00:00'); const days = [];
      for (let i = 0; i < 7; i++) { const x = new Date(st); x.setDate(st.getDate() + i); days.push(ymd(x)); }
      box.innerHTML = `<div class="week">${days.map((ds) => { const x = new Date(ds + 'T00:00'); const list = rows.filter((r) => r.scheduled_at.slice(0, 10) === ds);
        return `<div class="day ${ds === today() ? 'today' : ''}"><div class="dh" data-d="${ds}"><span>${DOW[x.getDay()]} ${x.getDate()}.${pad(x.getMonth() + 1)}</span><span class="muted small">${list.length || ''}</span></div>
        ${list.map((r) => `<div class="wev st-${r.status}" data-id="${r.id}" style="border-left-color:var(--${{ in_work: 'accent', done: 'ok', waiting: 'warn', issued: 'violet' }[r.status] || 'info'})"><b>${r.scheduled_at.slice(11, 16)}</b> ${esc(r.client || '')}<div class="muted">${esc(carStr(r))}${r.bay ? ' · ' + esc(r.bay) : ''}</div></div>`).join('') || '<div class="muted small">—</div>'}</div>`; }).join('')}</div>`;
      $$('.dh', box).forEach((h) => (h.onclick = () => { date = h.dataset.d; view = 'day'; render(); }));
    }
    $$('[data-id]', box).forEach((e) => (e.onclick = (ev) => { ev.stopPropagation(); go('/orders/' + e.dataset.id); }));
    const shift = (n) => { const x = new Date(date + 'T00:00'); x.setDate(x.getDate() + n * (view === 'week' ? 7 : 1)); date = ymd(x); render(); };
    $('#prev', page).onclick = () => shift(-1); $('#next', page).onclick = () => shift(1);
    $('#tod', page).onclick = () => { date = today(); render(); };
    $('#pick', page).onchange = (e) => { if (e.target.value) { date = e.target.value; render(); } };
    $$('[data-v]', page).forEach((b) => (b.onclick = () => { view = b.dataset.v; render(); }));
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
  let low = false;
  page.innerHTML = `<div class="topbar"><h1>Склад</h1><span class="muted" id="sum"></span><div class="sp"></div>
    <input class="search" id="q" placeholder="Название, артикул, бренд"><button class="chip" id="low">Заканчиваются</button>
    <button id="moves">Движения</button><button id="receipt">Приход</button><button class="primary" id="add">+ Товар</button></div>
    <div class="card" style="padding:4px 6px"><div class="tblwrap" id="list"></div></div>`;
  let rows = [];
  const load = async () => {
    rows = await GET('/api/products' + qs({ q: $('#q', page).value, low: low ? 1 : '', all: 1 }));
    const val = rows.filter((p) => p.active && p.stock > 0).reduce((s, p) => s + p.stock * p.cost, 0);
    $('#sum', page).textContent = `${rows.length} поз. · на складе на ${rub(val)} по закупке`;
    $('#list', page).innerHTML = rows.length ? `<table class="tbl resp"><thead><tr><th>Товар</th><th>Артикул</th><th>Категория</th><th class="r">Закупка</th><th class="r">Цена</th><th class="r">Наценка</th><th class="r">Остаток</th><th></th></tr></thead><tbody>
      ${rows.map((p) => `<tr class="click" data-id="${p.id}" style="${p.active ? '' : 'opacity:.5'}"><td data-l="Товар"><b>${esc(p.name)}</b>${p.brand ? `<div class="small muted">${esc(p.brand)}</div>` : ''}</td><td data-l="Артикул" class="muted">${esc(p.sku || '')}</td><td data-l="Категория">${esc(p.category || '')}</td>
      <td data-l="Закупка" class="r mono">${num(p.cost)}</td><td data-l="Цена" class="r mono">${num(p.price)}</td><td data-l="Наценка" class="r muted">${p.cost ? Math.round((p.price / p.cost - 1) * 100) + '%' : '—'}</td>
      <td data-l="Остаток" class="r"><span class="badge ${p.stock <= 0 ? 'red' : p.min_stock && p.stock <= p.min_stock ? 'warn' : 'ok'}">${num(p.stock)} ${esc(p.unit)}</span></td>
      <td><button class="sm" data-move="${p.id}" title="Корректировка остатка">±</button></td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">Товаров нет. Добавьте первый товар.</div>';
  };
  const prodModal = (p = { unit: 'шт', warranty_months: 12, active: 1 }) => modal(p.id ? 'Товар' : 'Новый товар', `
    <div class="field"><label>Название *</label><input name="name" required value="${esc(p.name || '')}"></div>
    <div class="row"><div class="field"><label>Артикул</label><input name="sku" value="${esc(p.sku || '')}"></div><div class="field"><label>Бренд</label><input name="brand" value="${esc(p.brand || '')}"></div>
    <div class="field"><label>Категория</label><input name="category" list="cats" value="${esc(p.category || '')}"><datalist id="cats">${['Магнитолы', 'Акустика', 'Сабвуферы', 'Усилители', 'Процессоры DSP', 'Провода и кабели', 'Шумоизоляция', 'Сигнализации', 'Камеры', 'Подсветка', 'Рамки и переходники', 'Расходники', ...new Set(rows.map((x) => x.category).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div></div>
    <div class="row"><div class="field"><label>Закупка, ₽</label><input name="cost" type="number" step="any" value="${p.cost || 0}"></div><div class="field"><label>Цена продажи, ₽</label><input name="price" type="number" step="any" value="${p.price || 0}"></div>
    <div class="field"><label>Ед. изм.</label><select name="unit">${opts(['шт', 'компл', 'м', 'лист', 'упак', 'л', 'кг'], p.unit)}</select></div></div>
    <div class="row">${p.id ? '' : '<div class="field"><label>Начальный остаток</label><input name="stock" type="number" step="any" value="0"></div>'}
    <div class="field"><label>Мин. остаток (оповещение)</label><input name="min_stock" type="number" step="any" value="${p.min_stock || 0}"></div><div class="field"><label>Гарантия, мес.</label><input name="warranty_months" type="number" value="${p.warranty_months ?? 12}"></div></div>
    ${p.id ? `<label class="inline" style="color:var(--text)"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Активен (показывать в подборе)</label>` : ''}`,
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
  $('#receipt', page).onclick = () => {
    const lines = [];
    const m = modal('Приход товара', `<div><input id="rq" placeholder="Найдите товар и выберите его…"></div>
      <table class="tbl" style="margin-top:10px"><thead><tr><th>Товар</th><th style="width:100px">Кол-во</th><th style="width:130px">Закупка, ₽</th><th class="r">Сумма</th><th></th></tr></thead><tbody id="rl"><tr><td colspan="5" class="muted">Пусто</td></tr></tbody></table>
      <div class="r" style="margin:10px 0;font-weight:700" id="rsum"></div>
      <div class="row"><div class="field"><label>Поставщик / накладная</label><input name="note" placeholder="ООО Автозвук, накл. 123"></div>
      <div class="field"><label>Оплата</label><select name="pay"><option value="">Не проводить расход</option><option value="1">Провести расход в кассе</option></select></div>
      <div class="field"><label>Способ</label><select name="method">${opts(Object.entries(METHODS), 'transfer')}</select></div></div>`,
    { wide: true, submit: 'Оприходовать', onSubmit: async (d) => {
      const r = await POST('/api/stock/receipt', { items: lines, note: d.note, pay: !!d.pay, method: d.method });
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

// ================= Финансы =================
function periodBar(page, from, to, onChange) {
  const t = new Date();
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
  const t = new Date();
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
  const [r, pays] = await Promise.all([GET('/api/reports/finance' + qs({ from, to })), GET('/api/payments' + qs({ from, to }))]);
  const inc = r.byMethod.filter((x) => x.direction === 'in').reduce((s, x) => s + x.s, 0);
  const exp = r.byMethod.filter((x) => x.direction === 'out').reduce((s, x) => s + x.s, 0);
  const s = r.sales; const revenue = s.services + s.goods; const goodsMargin = s.goods - s.goods_cost;
  const maxDay = Math.max(1, ...r.daily.map((d) => Math.max(d.inc, d.exp)));
  const byM = (dir) => Object.entries(METHODS).map(([k, t]) => [t, r.byMethod.find((x) => x.direction === dir && x.method === k)?.s || 0]);
  const catList = (dir) => r.byCategory.filter((x) => x.direction === dir);
  const maxCat = Math.max(1, ...r.byCategory.map((x) => x.s));
  page.innerHTML = `<div class="topbar"><h1>Финансы</h1><div class="sp"></div>${periodBar(page, from, to)}</div>
  <div class="grid g4" style="margin-bottom:14px">
    <div class="kpi"><div class="l">Поступления</div><div class="v ok">${rub(inc)}</div></div>
    <div class="kpi"><div class="l">Расходы</div><div class="v bad">${rub(exp)}</div></div>
    <div class="kpi"><div class="l">Сальдо периода</div><div class="v ${inc - exp >= 0 ? 'acc' : 'bad'}">${rub(inc - exp)}</div></div>
    <div class="kpi"><div class="l">Средний чек</div><div class="v">${rub(s.orders ? revenue / s.orders : 0)}</div></div></div>
  <div class="grid g-main"><div>
    <div class="card"><h2>Движение денег по дням</h2>${r.daily.length ? `<div class="bars">${r.daily.map((d) => `<div class="b" data-t="${dmy(d.d)}\nприход ${rub(d.inc)}\nрасход ${rub(d.exp)}"><i class="in" style="height:${d.inc / maxDay * 130}px"></i><i class="out" style="height:${d.exp / maxDay * 130}px"></i></div>`).join('')}</div>
      <div class="legend"><span><i style="background:var(--accent)"></i>Приход</span><span><i style="background:#4a5160"></i>Расход</span></div>` : '<div class="empty">Нет движения денег</div>'}</div>
    <div class="card"><div class="inline" style="margin-bottom:10px"><h2 style="margin:0;flex:1">Журнал кассы</h2><button class="sm" id="addIn">+ Приход</button><button class="sm" id="addOut">+ Расход</button></div>
      ${pays.length ? `<div class="tblwrap" style="max-height:480px;overflow-y:auto"><table class="tbl resp"><thead><tr><th>Дата</th><th>Статья</th><th>Основание</th><th>Способ</th><th class="r">Сумма</th>${isAdmin() ? '<th></th>' : ''}</tr></thead><tbody>
      ${pays.map((p) => `<tr><td data-l="Дата" class="nowrap">${dt(p.created_at)}</td><td data-l="Статья">${esc(p.category || '')}${p.employee ? ' · ' + esc(p.employee) : ''}</td>
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
  const payModal = (dir) => modal(dir === 'in' ? 'Приход в кассу' : 'Расход', `
    <div class="row"><div class="field"><label>Сумма, ₽</label><input name="amount" type="number" step="any" min="0.01" required></div>
    <div class="field"><label>Статья</label><select name="category" id="cat">${opts(dir === 'in' ? INCOME_CATS : EXPENSE_CATS.filter((c) => isAdmin() || c !== 'Зарплата'))}</select></div></div>
    <div class="row"><div class="field"><label>Способ</label><select name="method">${opts(Object.entries(METHODS), 'cash')}</select></div><div class="field"><label>Дата</label><input type="date" name="date" value="${today()}"></div>
    <div class="field hidden" id="empF"><label>Сотрудник</label><select name="employee_id">${opts(S.staff.map((u) => [u.id, u.name]), '', '—')}</select></div></div>
    <div class="field"><label>Комментарий</label><input name="note"></div>`,
  { onSubmit: async (d) => { await POST('/api/payments', { ...d, direction: dir }); toast('Проведено'); navigate(); },
    onOpen: (f) => { const c = $('#cat', f); const t = () => $('#empF', f).classList.toggle('hidden', c.value !== 'Зарплата'); c.onchange = t; t(); } });
  $('#addIn', page).onclick = () => payModal('in');
  $('#addOut', page).onclick = () => payModal('out');
  $$('[data-delp]', page).forEach((b) => (b.onclick = async () => { if (await confirmBox('Удалить операцию из кассы?', 'Удалить')) { await DEL('/api/payments/' + b.dataset.delp); navigate(); } }));
});

// ================= Зарплата =================
route(/^\/salary$/, async (page, query) => {
  const from = query.from || monthStart(), to = query.to || today();
  const rows = await GET('/api/reports/salary' + qs({ from, to }));
  page.innerHTML = `<div class="topbar"><h1>${isAdmin() ? 'Зарплата' : 'Моя зарплата'}</h1><div class="sp"></div>${periodBar(page, from, to)}</div>
    <div class="small muted" style="margin-bottom:12px">Начисление: % мастера от стоимости работ по выданным заказам (с учётом скидки) + % менеджера от товаров в его заказах. Проценты задаются в разделе «Сотрудники».</div>
    ${rows.length ? rows.map((u) => `<div class="card"><div class="inline" style="margin-bottom:8px"><h2 style="margin:0;flex:1">${esc(u.name)} <span class="muted small">${ROLES[u.role]} · работы ${u.salary_percent || 0}%${u.goods_percent ? ' · товары ' + u.goods_percent + '%' : ''}</span></h2>
      ${isAdmin() && u.due > 0 ? `<button class="sm primary" data-pay="${u.id}" data-due="${u.due}">Выплатить ${rub(u.due)}</button>` : ''}</div>
      <div class="grid g4"><div class="kpi"><div class="l">Работы</div><div class="v" style="font-size:18px">${rub(u.works_sum)}</div></div><div class="kpi"><div class="l">Начислено</div><div class="v acc" style="font-size:18px">${rub(u.accrued)}</div></div>
      <div class="kpi"><div class="l">Выплачено</div><div class="v" style="font-size:18px">${rub(u.paid)}</div></div><div class="kpi"><div class="l">К выплате</div><div class="v ${u.due > 0 ? 'ok' : ''}" style="font-size:18px">${rub(u.due)}</div></div></div>
      ${u.works.length ? `<details style="margin-top:10px"><summary class="muted" style="cursor:pointer">Выполненные работы (${u.works.length})</summary><table class="tbl" style="margin-top:6px"><tbody>${u.works.map((w) => `<tr><td class="nowrap">${dmy(w.issued_at)}</td><td><a href="#/orders/${w.order_id}">${orderNo(w.order_id)}</a></td><td>${esc(w.name)}</td><td class="r mono">${rub(w.sum)}</td><td class="r mono muted">${rub(w.sum * (u.salary_percent || 0) / 100)}</td></tr>`).join('')}</tbody></table></details>` : ''}
    </div>`).join('') : '<div class="card empty">Нет начислений за период</div>'}`;
  bindPeriod(page, (f, t) => go('/salary' + qs({ from: f, to: t })));
  $$('[data-pay]', page).forEach((b) => (b.onclick = () => modal('Выплата зарплаты', `
    <div class="row"><div class="field"><label>Сумма, ₽</label><input name="amount" type="number" step="any" required value="${b.dataset.due}"></div><div class="field"><label>Способ</label><select name="method">${opts(Object.entries(METHODS), 'cash')}</select></div></div>
    <div class="field"><label>Комментарий</label><input name="note" value="Зарплата ${dmy(from)}–${dmy(to)}"></div>`,
  { submit: 'Провести выплату', onSubmit: async (d) => { await POST('/api/payments', { ...d, direction: 'out', category: 'Зарплата', employee_id: b.dataset.pay, date: to <= today() ? to : today() }); toast('Выплата проведена'); navigate(); } })));
});

// ================= Сотрудники =================
route(/^\/users$/, async (page) => {
  const rows = await GET('/api/users');
  page.innerHTML = `<div class="topbar"><h1>Сотрудники</h1><div class="sp"></div><button class="primary" id="add">+ Сотрудник</button></div>
    <div class="card" style="padding:4px 6px"><table class="tbl resp"><thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th>Телефон</th><th class="r">% работ</th><th class="r">% товаров</th><th>Telegram</th></tr></thead><tbody>
    ${rows.map((u) => `<tr class="click" data-id="${u.id}" style="${u.active ? '' : 'opacity:.45'}"><td data-l="Имя"><b>${esc(u.name)}</b>${u.active ? '' : ' <span class="badge">отключён</span>'}</td><td data-l="Логин" class="muted">${esc(u.login)}</td><td data-l="Роль">${ROLES[u.role]}</td>
    <td data-l="Телефон">${esc(u.phone || '')}</td><td data-l="% работ" class="r">${u.salary_percent || 0}%</td><td data-l="% товаров" class="r">${u.goods_percent || 0}%</td><td data-l="Telegram">${u.tg_chat_id ? '<span class="badge ok">подключён</span>' : '<span class="muted">—</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="card small muted"><b>Роли.</b> Администратор — всё, включая сотрудников и настройки. Менеджер — клиенты, заказы, склад, касса, отчёты. Мастер — только свои заказы и календарь, смена статусов «В работе / Ждёт запчасти / Готов», своя зарплата.<br>
    <b>Telegram мастера:</b> укажите телефон сотрудника, затем пусть он откроет бота студии и нажмёт «Поделиться номером» — уведомления о назначенных заказах начнут приходить автоматически.</div>`;
  const userModal = (u = { role: 'master', active: 1 }) => modal(u.id ? 'Сотрудник' : 'Новый сотрудник', `
    <div class="row"><div class="field"><label>Имя *</label><input name="name" required value="${esc(u.name || '')}"></div>
    <div class="field"><label>Логин *</label><input name="login" required value="${esc(u.login || '')}" ${u.id ? 'disabled' : ''} autocapitalize="off"></div></div>
    <div class="row"><div class="field"><label>Роль</label><select name="role">${opts(Object.entries(ROLES), u.role)}</select></div><div class="field"><label>Телефон</label><input name="phone" value="${esc(u.phone || '')}"></div></div>
    <div class="row"><div class="field"><label>% от работ</label><input name="salary_percent" type="number" step="any" min="0" max="100" value="${u.salary_percent || 0}"></div>
    <div class="field"><label>% от товаров</label><input name="goods_percent" type="number" step="any" min="0" max="100" value="${u.goods_percent || 0}"></div></div>
    <div class="row"><div class="field"><label>${u.id ? 'Новый пароль (пусто — не менять)' : 'Пароль * (от 6 символов)'}</label><input name="password" type="text" ${u.id ? '' : 'required minlength="6"'} autocomplete="new-password"></div>
    <div class="field"><label>Telegram chat ID</label><input name="tg_chat_id" value="${esc(u.tg_chat_id || '')}" placeholder="заполнится сам"></div></div>
    ${u.id ? `<label class="inline" style="color:var(--text)"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Активен (может входить)</label>` : ''}`,
  { onSubmit: async (d) => { if (u.id) await PUT('/api/users/' + u.id, d); else await POST('/api/users', d); S.staff = await GET('/api/staff'); toast('Сохранено'); navigate(); } });
  $('#add', page).onclick = () => userModal();
  $$('tr[data-id]', page).forEach((tr) => (tr.onclick = () => userModal(rows.find((x) => x.id === +tr.dataset.id))));
});

// ================= Настройки =================
route(/^\/settings$/, async (page) => {
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
      <div class="field"><label>Боксы / посты (через запятую)</label><input name="bays" value="${esc(s.bays)}"></div>
      <div class="row"><div class="field"><label>Начало дня</label><input type="time" name="work_start" value="${esc(s.work_start)}"></div><div class="field"><label>Конец дня</label><input type="time" name="work_end" value="${esc(s.work_end)}"></div></div>
      <h2 style="margin-top:16px">Тексты документов</h2>
      <div class="field"><label>Условия в заказ-наряде и акте</label><textarea name="order_terms" rows="4">${esc(s.order_terms)}</textarea></div>
      <div class="field"><label>Условия гарантии</label><textarea name="warranty_terms" rows="4">${esc(s.warranty_terms)}</textarea></div></div>
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
  </div><div style="margin-top:14px"><button class="primary">Сохранить настройки</button></div></form>`;
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
