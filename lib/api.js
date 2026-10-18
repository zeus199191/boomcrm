'use strict';
const { db, all, get, run, tx, getSetting, setSetting, normPhone } = require('./db');
const { createRouter, HttpError } = require('./http');
const auth = require('./auth');
const tg = require('./telegram');
const max = require('./max');
const notify = require('./notify');
const warranty = require('./warranty');

const r = createRouter();
const STATUSES = ['new', 'scheduled', 'in_work', 'waiting', 'done', 'issued', 'cancelled', 'estimate'];
const STATUS_RU = { new: 'Новый', scheduled: 'Записан', in_work: 'В работе', waiting: 'Ждёт запчасти', done: 'Готов', issued: 'Выдан', cancelled: 'Отменён', estimate: 'Предварительный расчёт' };

const ADMIN = auth.requireRole('admin');
const OFFICE = auth.requireRole('admin', 'manager');
const num = (v, d = 0) => (v === '' || v === null || v === undefined || isNaN(+v) ? d : +v);
const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const need = (v, msg) => { if (v === undefined || v === null || String(v).trim() === '') throw new HttpError(400, msg); return v; };
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
function period(q) {
  const t = today();
  const from = q.from || t.slice(0, 8) + '01';
  const to = q.to || t;
  return [from, to + ' 23:59:59'];
}
// дата окончания не раньше даты начала
function isDayOff(dt) {
  if (!dt) return false;
  const off = getSetting('days_off', '0').split(',').filter((x) => x !== '').map(Number);
  return off.includes(new Date(String(dt).slice(0, 10) + 'T12:00:00').getDay());
}
function endDate(start, end) {
  if (!start) return null;
  const sd = String(start).slice(0, 10);
  const e = end ? String(end).slice(0, 10) : null;
  return e && e > sd ? e : null;
}
const lc = (s) => String(s).toLowerCase().replace(/ё/g, 'е');
// цифры из поискового запроса для поиска по телефону (8912... и +7912... → 912...)
function phoneDigits(q) {
  let d = String(q).replace(/\D/g, '');
  if (d.length < 3 || /[a-zа-яё]/i.test(q)) return '';
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')) d = d.slice(1);
  return d;
}
const orderNo = (id) => 'БС-' + String(id).padStart(5, '0');

function logOrder(orderId, user, text) {
  run('INSERT INTO order_log(order_id,user_id,text) VALUES(?,?,?)', orderId, user ? user.id : null, text);
}

// ---------- Авторизация ----------
r.post('/api/login', (ctx) => {
  const ip = ctx.req.headers['x-real-ip'] || ctx.req.socket.remoteAddress;
  auth.checkRate(ip);
  const { login, password } = ctx.body;
  const u = get('SELECT * FROM users WHERE login=? AND active=1', String(login || '').trim().toLowerCase());
  if (!u || !auth.verifyPassword(password || '', u.pass_hash)) throw new HttpError(401, 'Неверный логин или пароль');
  const token = auth.createSession(u.id);
  const secure = ctx.req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  ctx.res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${auth.SESSION_DAYS * 86400}${secure}`);
  return { ok: true };
}, { public: true });

r.post('/api/logout', (ctx) => {
  run('DELETE FROM sessions WHERE token=?', ctx.token);
  ctx.res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  return { ok: true };
});

r.get('/api/me', (ctx) => ({
  user: ctx.user,
  company: getSetting('company_name'),
  bays: getSetting('bays').split(',').map((s) => s.trim()).filter(Boolean),
  work_start: getSetting('work_start', '09:00'), work_end: getSetting('work_end', '21:00'),
  tz: process.env.TZ || 'Asia/Irkutsk',
  days_off: getSetting('days_off', '0').split(',').filter((x) => x !== '').map(Number),
  statuses: STATUS_RU,
  accept_lists: (({ KIT, WORKS, FUEL }) => ({ kit: KIT, works: WORKS, fuel: FUEL }))(require('./print')),
  cashless_markup: +getSetting('cashless_markup', '0') || 0,
  acquiring_percent: +getSetting('acquiring_percent', '2') || 0,
  contractor_kinds: { supplier: 'Поставщик', partner: 'Партнёр', contractor: 'Подрядчик', client: 'Клиент-юрлицо', other: 'Прочее' },
  version: require('../package.json').version,
  max_on: !!getSetting('max_token'),
  saby_on: require('./saby').ready(),
  company_phone: getSetting('company_phone') || '',
  twogis_url: getSetting('twogis_url') || '',
  social: { tg: getSetting('social_tg') || '', vk: getSetting('social_vk') || '', max: getSetting('social_max') || '', avito: getSetting('social_avito') || '' },
  max_group: !!getSetting('max_group_chat_id'),
  my_max: !!(get('SELECT max_user_id, max_chat_id FROM users WHERE id=?', ctx.user.id) || {}).max_user_id,
}));

r.post('/api/me/password', (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!auth.verifyPassword(ctx.body.old || '', u.pass_hash)) throw new HttpError(400, 'Текущий пароль неверен');
  if (String(ctx.body.new || '').length < 6) throw new HttpError(400, 'Пароль должен быть не короче 6 символов');
  run('UPDATE users SET pass_hash=? WHERE id=?', auth.hashPassword(ctx.body.new), u.id);
  return { ok: true };
});

// ---------- Сотрудники ----------
// role 'senior' (руководитель-мастер) хранится как manager + is_master=1
const uiRole = (u) => (u.role === 'manager' && u.is_master ? 'senior' : u.role);
function dbRole(role) {
  if (!['admin', 'manager', 'master', 'senior'].includes(role)) throw new HttpError(400, 'Неверная роль');
  return role === 'senior' ? ['manager', 1] : [role, 0];
}
r.get('/api/staff', () => all("SELECT id,name,role,is_master,default_hours,(max_user_id IS NOT NULL OR max_chat_id IS NOT NULL) max FROM users WHERE active=1 ORDER BY role='master' DESC, is_master DESC, name")
  .map((u) => ({ ...u, role: uiRole(u), can_work: u.role === 'master' || u.is_master ? 1 : 0 })));

r.get('/api/users', ADMIN, () => all('SELECT id,login,name,role,is_master,default_hours,phone,salary_percent,goods_percent,tg_chat_id,(max_user_id IS NOT NULL OR max_chat_id IS NOT NULL) max_linked,active,created_at FROM users WHERE COALESCE(deleted,0)=0 ORDER BY active DESC, name').map((u) => ({ ...u, role: uiRole(u) })));
r.post('/api/users', ADMIN, (ctx) => {
  const b = ctx.body;
  const login = String(need(b.login, 'Укажите логин')).trim().toLowerCase();
  if (!LOGIN_RE.test(login)) throw new HttpError(400, 'Логин: 3–32 символа, латинские буквы, цифры, точка, дефис или подчёркивание');
  if (get('SELECT 1 FROM users WHERE login=?', login)) throw new HttpError(400, 'Такой логин уже есть');
  if (String(b.password || '').length < 6) throw new HttpError(400, 'Пароль не короче 6 символов');
  const [role, isMaster] = dbRole(b.role);
  const res = run('INSERT INTO users(login,name,role,is_master,pass_hash,phone,salary_percent,goods_percent,tg_chat_id,default_hours) VALUES(?,?,?,?,?,?,?,?,?,?)',
    login, need(b.name, 'Укажите имя'), role, isMaster, auth.hashPassword(b.password), str(b.phone), num(b.salary_percent), num(b.goods_percent), str(b.tg_chat_id),
    b.default_hours === undefined || b.default_hours === '' ? (b.role === 'senior' ? defaultHoursFor(b.name) : null) : num(b.default_hours));
  return { id: Number(res.lastInsertRowid) };
});
const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
// норма часов руководителя-мастера по умолчанию: Никита и Артём — 8, Александр — 4
function defaultHoursFor(name) { return /александр|саша/i.test(String(name || '')) ? 4 : 8; }
function otherAdmins(id) { return get("SELECT COUNT(*) n FROM users WHERE (role='admin' OR (role='manager' AND is_master=1)) AND active=1 AND COALESCE(deleted,0)=0 AND id<>?", id).n; }
r.put('/api/users/:id', ADMIN, (ctx) => {
  const b = ctx.body; const id = +ctx.params.id;
  const u = get('SELECT * FROM users WHERE id=? AND COALESCE(deleted,0)=0', id);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  if (id === ctx.user.id && (!b.active || !['admin', 'senior'].includes(b.role))) throw new HttpError(400, 'Нельзя отключить или понизить самого себя');
  if (u.role === 'admin' && (b.role !== 'admin' || !b.active) && !otherAdmins(id)) throw new HttpError(400, 'Должен остаться хотя бы один активный администратор');
  const [role, isMaster] = dbRole(b.role);
  let login = u.login;
  if (b.login !== undefined && String(b.login).trim().toLowerCase() !== u.login) {
    login = String(b.login).trim().toLowerCase();
    if (!LOGIN_RE.test(login)) throw new HttpError(400, 'Логин: 3–32 символа, латинские буквы, цифры, точка, дефис или подчёркивание');
    if (get('SELECT 1 FROM users WHERE login=? AND id<>?', login, id)) throw new HttpError(400, 'Такой логин уже занят');
  }
  run('UPDATE users SET login=?,name=?,role=?,is_master=?,phone=?,salary_percent=?,goods_percent=?,tg_chat_id=?,active=? WHERE id=?',
    login, need(b.name, 'Укажите имя'), role, isMaster, str(b.phone), num(b.salary_percent), num(b.goods_percent), str(b.tg_chat_id), b.active ? 1 : 0, id);
  if (b.default_hours !== undefined) run('UPDATE users SET default_hours=? WHERE id=?', b.default_hours === '' || b.default_hours === null ? null : Math.max(0, Math.min(24, num(b.default_hours))), id);
  if (b.password) {
    if (String(b.password).length < 6) throw new HttpError(400, 'Пароль не короче 6 символов');
    run('UPDATE users SET pass_hash=? WHERE id=?', auth.hashPassword(b.password), id);
    if (id !== ctx.user.id) run('DELETE FROM sessions WHERE user_id=?', id);
  }
  if (!b.active) run('DELETE FROM sessions WHERE user_id=?', id);
  return { ok: true };
});
// Удаление: без истории — полностью; с историей (заказы, начисления, касса) — в архив,
// имя остаётся в старых документах, логин освобождается, вход закрыт.
r.delete('/api/users/:id', ADMIN, (ctx) => {
  const id = +ctx.params.id;
  const u = get('SELECT * FROM users WHERE id=? AND COALESCE(deleted,0)=0', id);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  if (id === ctx.user.id) throw new HttpError(400, 'Нельзя удалить самого себя');
  if (u.role === 'admin' && !otherAdmins(id)) throw new HttpError(400, 'Должен остаться хотя бы один активный администратор');
  const used = get(`SELECT (SELECT COUNT(*) FROM orders WHERE master_id=?1 OR manager_id=?1 OR created_by=?1 OR accept_by=?1)
    + (SELECT COUNT(*) FROM order_items WHERE master_id=?1) + (SELECT COUNT(*) FROM salary_accruals WHERE user_id=?1)
    + (SELECT COUNT(*) FROM payments WHERE user_id=?1 OR employee_id=?1) + (SELECT COUNT(*) FROM order_log WHERE user_id=?1)
    + (SELECT COUNT(*) FROM stock_moves WHERE user_id=?1) + (SELECT COUNT(*) FROM contractor_ops WHERE user_id=?1)
    + (SELECT COUNT(*) FROM cal_notes WHERE created_by=?1) n`, id).n;
  run('DELETE FROM sessions WHERE user_id=?', id);
  if (!used) { run('DELETE FROM users WHERE id=?', id); return { ok: true, mode: 'deleted' }; }
  run("UPDATE users SET deleted=1, active=0, login=?, tg_chat_id=NULL WHERE id=?", `deleted-${id}-${u.login}`.slice(0, 60), id);
  return { ok: true, mode: 'archived' };
});

// ---------- Дашборд ----------
r.get('/api/dashboard', (ctx) => {
  const t = today();
  const isMaster = ctx.user.role === 'master';
  const mf = isMaster ? ' AND o.master_id=' + ctx.user.id : '';
  const out = {
    today: all(`SELECT o.id,o.status,o.scheduled_at,o.end_date,o.complaint,o.bay,o.duration_min,c.name client,c.phone,ca.brand,ca.model,ca.plate,u.name master
                FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id LEFT JOIN users u ON u.id=o.master_id
                WHERE substr(o.scheduled_at,1,10)<=? AND COALESCE(o.end_date,substr(o.scheduled_at,1,10))>=? AND o.status NOT IN ('cancelled','issued','estimate')${mf}
                ORDER BY substr(o.scheduled_at,1,10)<? , o.scheduled_at`, t, t, t),
    by_status: all(`SELECT status, COUNT(*) n FROM orders o WHERE status NOT IN ('issued','cancelled','estimate')${mf} GROUP BY status`),
    in_work: all(`SELECT o.id,o.status,o.scheduled_at,c.name client,ca.brand,ca.model,ca.plate,u.name master FROM orders o
                  LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id LEFT JOIN users u ON u.id=o.master_id
                  WHERE o.status IN ('in_work','waiting','done')${mf} ORDER BY o.status, o.scheduled_at LIMIT 30`),
  };
  if (!isMaster) {
    const m = t.slice(0, 8) + '01';
    out.money = {
      today_in: get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='in' AND substr(created_at,1,10)=?", t).s,
      month_in: get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='in' AND created_at>=?", m).s,
      month_out: get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='out' AND created_at>=?", m).s,
      orders_month: get("SELECT COUNT(*) n FROM orders WHERE status='issued' AND issued_at>=?", m).n,
    };
    out.new_leads = get("SELECT COUNT(*) n FROM leads WHERE status='new'").n;
    out.warranty = all(`SELECT w.id, w.product_name, w.status, w.received_at, COALESCE(w.client_name, c.name) client, k.name supplier,
                        CAST(julianday(?) - julianday(substr(w.received_at,1,10)) AS INTEGER) days
                        FROM warranty_claims w LEFT JOIN clients c ON c.id=w.client_id LEFT JOIN contractors k ON k.id=w.contractor_id
                        WHERE w.status!='closed' ORDER BY w.received_at LIMIT 30`, t);
    out.low_stock = all('SELECT id,name,stock,min_stock,unit FROM products WHERE active=1 AND min_stock>0 AND stock<=min_stock ORDER BY name LIMIT 20');
    out.debts = all(`SELECT * FROM (SELECT o.id, c.name client, ${totalSql('o')} total,
                     (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM payments p WHERE p.order_id=o.id) paid
                     FROM orders o LEFT JOIN clients c ON c.id=o.client_id WHERE o.status IN ('done','issued')) WHERE total-paid>0.5 ORDER BY id DESC LIMIT 20`);
  }
  return out;
});

// SQL-выражение итоговой суммы заказа с учётом скидки
function totalSql(a) {
  return `ROUND((SELECT COALESCE(SUM(qty*price),0) FROM order_items i WHERE i.order_id=${a}.id) * (1 - COALESCE(${a}.discount_percent,0)/100.0), 2)`;
}

// ---------- Клиенты ----------
r.get('/api/clients', (ctx) => {
  if (ctx.user.role === 'master') throw new HttpError(403, 'Недостаточно прав');
  const q = (ctx.query.q || '').trim();
  const lim = Math.min(num(ctx.query.limit, 100), 500);
  const off = num(ctx.query.offset, 0);
  let where = '1=1'; const p = [];
  if (q) {
    const digits = phoneDigits(q);
    where = `(ulower(c.name) LIKE ? OR ulower(c.email) LIKE ? OR c.id IN (SELECT client_id FROM cars WHERE ulower(plate) LIKE ? OR ulower(vin) LIKE ? OR ulower(COALESCE(brand,'')||' '||COALESCE(model,'')) LIKE ?)${digits ? ' OR c.phone_norm LIKE ?' : ''})`;
    const like = `%${lc(q)}%`;
    p.push(like, like, `%${lc(q.replace(/\s/g, ''))}%`, like, like);
    if (digits) p.push(`%${digits}%`);
  }
  const rows = all(`SELECT c.*, (SELECT GROUP_CONCAT(COALESCE(brand,'')||' '||COALESCE(model,'')||CASE WHEN plate IS NOT NULL THEN ' ('||plate||')' ELSE '' END, ', ') FROM cars WHERE client_id=c.id) cars,
                    (SELECT COUNT(*) FROM orders WHERE client_id=c.id AND status='issued') orders_n,
                    (SELECT COALESCE(SUM(amount),0) FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.client_id=c.id AND p.direction='in') spent
                    FROM clients c WHERE ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`, ...p, lim, off);
  const total = get(`SELECT COUNT(*) n FROM clients c WHERE ${where}`, ...p).n;
  return { rows, total };
});

function findClientByPhone(phone) {
  const n = normPhone(phone);
  return n.length >= 10 ? get('SELECT * FROM clients WHERE phone_norm=?', n) : null;
}

r.post('/api/clients', OFFICE, (ctx) => {
  const b = ctx.body;
  need(b.name, 'Укажите имя клиента');
  const dup = findClientByPhone(b.phone);
  if (dup && !b.force) throw new HttpError(409, `Клиент с таким телефоном уже есть: ${dup.name} (#${dup.id})`);
  const res = run('INSERT INTO clients(name,phone,phone_norm,email,source,birthday,discount,notes) VALUES(?,?,?,?,?,?,?,?)',
    str(b.name), str(b.phone), normPhone(b.phone), str(b.email), str(b.source), str(b.birthday), num(b.discount), str(b.notes));
  const id = Number(res.lastInsertRowid);
  if (b.car && (b.car.brand || b.car.model || b.car.plate)) insertCar(id, b.car);
  return { id };
});

r.get('/api/clients/:id', (ctx) => {
  const c = get('SELECT * FROM clients WHERE id=?', +ctx.params.id);
  if (!c) throw new HttpError(404, 'Клиент не найден');
  if (ctx.user.role === 'master') {
    if (!get('SELECT 1 FROM orders WHERE client_id=? AND master_id=?', c.id, ctx.user.id)) throw new HttpError(403, 'Недостаточно прав');
  }
  c.cars = all('SELECT * FROM cars WHERE client_id=? ORDER BY id', c.id);
  c.orders = all(`SELECT o.id,o.status,o.scheduled_at,o.created_at,o.issued_at,ca.brand,ca.model,ca.plate, ${totalSql('o')} total
                  FROM orders o LEFT JOIN cars ca ON ca.id=o.car_id WHERE o.client_id=? ORDER BY o.id DESC`, c.id);
  c.spent = get("SELECT COALESCE(SUM(amount),0) s FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.client_id=? AND direction='in'", c.id).s;
  return c;
});

r.put('/api/clients/:id', OFFICE, (ctx) => {
  const b = ctx.body;
  run('UPDATE clients SET name=?,phone=?,phone_norm=?,email=?,source=?,birthday=?,discount=?,notes=? WHERE id=?',
    need(b.name, 'Укажите имя'), str(b.phone), normPhone(b.phone), str(b.email), str(b.source), str(b.birthday), num(b.discount), str(b.notes), +ctx.params.id);
  return { ok: true };
});

r.delete('/api/clients/:id', ADMIN, (ctx) => {
  const id = +ctx.params.id;
  if (get('SELECT 1 FROM orders WHERE client_id=?', id)) throw new HttpError(400, 'У клиента есть заказы — удаление невозможно');
  run('DELETE FROM clients WHERE id=?', id);
  return { ok: true };
});

// ---------- Автомобили ----------
function insertCar(clientId, b) {
  const res = run('INSERT INTO cars(client_id,brand,model,year,vin,plate,color,audio_notes) VALUES(?,?,?,?,?,?,?,?)',
    clientId, str(b.brand), str(b.model), b.year ? num(b.year) : null, str(b.vin)?.toUpperCase(), str(b.plate)?.toUpperCase().replace(/\s/g, ''), str(b.color), str(b.audio_notes));
  return Number(res.lastInsertRowid);
}
r.post('/api/cars', OFFICE, (ctx) => ({ id: insertCar(+need(ctx.body.client_id, 'Нет клиента'), ctx.body) }));
r.put('/api/cars/:id', OFFICE, (ctx) => {
  const b = ctx.body;
  run('UPDATE cars SET brand=?,model=?,year=?,vin=?,plate=?,color=?,audio_notes=? WHERE id=?',
    str(b.brand), str(b.model), b.year ? num(b.year) : null, str(b.vin)?.toUpperCase(), str(b.plate)?.toUpperCase().replace(/\s/g, ''), str(b.color), str(b.audio_notes), +ctx.params.id);
  return { ok: true };
});
r.delete('/api/cars/:id', OFFICE, (ctx) => {
  if (get('SELECT 1 FROM orders WHERE car_id=?', +ctx.params.id)) throw new HttpError(400, 'По автомобилю есть заказы');
  run('DELETE FROM cars WHERE id=?', +ctx.params.id);
  return { ok: true };
});

// ---------- Услуги ----------
r.get('/api/services', () => all('SELECT * FROM services ORDER BY active DESC, category, name'));
r.post('/api/services', OFFICE, (ctx) => {
  const b = ctx.body;
  const res = run('INSERT INTO services(name,category,price,duration_min,warranty_months) VALUES(?,?,?,?,?)',
    need(b.name, 'Укажите название'), str(b.category), num(b.price), num(b.duration_min, 60), num(b.warranty_months, 6));
  return { id: Number(res.lastInsertRowid) };
});
r.put('/api/services/:id', OFFICE, (ctx) => {
  const b = ctx.body;
  run('UPDATE services SET name=?,category=?,price=?,duration_min=?,warranty_months=?,active=? WHERE id=?',
    need(b.name, 'Укажите название'), str(b.category), num(b.price), num(b.duration_min, 60), num(b.warranty_months), b.active ? 1 : 0, +ctx.params.id);
  return { ok: true };
});
r.delete('/api/services/:id', ADMIN, (ctx) => { run('UPDATE services SET active=0 WHERE id=?', +ctx.params.id); return { ok: true }; });

// ---------- Склад ----------
r.get('/api/products', (ctx) => {
  const q = (ctx.query.q || '').trim();
  let sql = `SELECT *, ${RESERVED_SQL} reserved FROM products WHERE 1=1`; const p = [];
  if (!ctx.query.all) sql += ' AND active=1';
  if (q) { sql += ' AND (ulower(name) LIKE ? OR ulower(sku) LIKE ? OR ulower(brand) LIKE ? OR ulower(category) LIKE ?)'; p.push(...Array(4).fill(`%${lc(q)}%`)); }
  if (ctx.query.low) sql += ' AND min_stock>0 AND stock<=min_stock';
  if (ctx.query.site) sql += ' AND site=1';
  sql += ' ORDER BY category, name';
  const rows = all(sql, ...p);
  if (ctx.user.role === 'master') rows.forEach((x) => delete x.cost);
  return rows;
});
r.post('/api/products', OFFICE, (ctx) => {
  const b = ctx.body;
  return tx(() => {
    const res = run('INSERT INTO products(sku,name,category,brand,unit,cost,price,stock,min_stock,warranty_months,site) VALUES(?,?,?,?,?,?,?,0,?,?,?)',
      str(b.sku), need(b.name, 'Укажите название'), str(b.category), str(b.brand), str(b.unit) || 'шт', num(b.cost), num(b.price), num(b.min_stock), num(b.warranty_months, 12), b.site ? 1 : 0);
    const id = Number(res.lastInsertRowid);
    if (num(b.stock) !== 0) moveStock(id, num(b.stock), 'in', null, 'Начальный остаток', ctx.user);
    return { id };
  });
});
r.put('/api/products/:id', OFFICE, (ctx) => {
  const b = ctx.body;
  run('UPDATE products SET sku=?,name=?,category=?,brand=?,unit=?,cost=?,price=?,min_stock=?,warranty_months=?,active=?,site=? WHERE id=?',
    str(b.sku), need(b.name, 'Укажите название'), str(b.category), str(b.brand), str(b.unit) || 'шт', num(b.cost), num(b.price), num(b.min_stock), num(b.warranty_months), b.active ? 1 : 0, b.site ? 1 : 0, +ctx.params.id);
  return { ok: true };
});

function moveStock(productId, qty, kind, orderId, note, user) {
  run('INSERT INTO stock_moves(product_id,qty,kind,order_id,note,user_id) VALUES(?,?,?,?,?,?)', productId, qty, kind, orderId, note, user ? user.id : null);
  run('UPDATE products SET stock=stock+? WHERE id=?', qty, productId);
}

// Загрузка прайса поставщика (.xlsx, формат «Спарта Маркет»): закупка = VIP дилер, продажа = розница
const PRICE_DEFAULT_GROUPS = ['Автозвук', 'Защита от угона', 'Вибро- шумоизоляция', 'Штатные решения для автомобилей', 'Автоэлектроника'];
r.post('/api/products/import-price', OFFICE, (ctx) => {
  const b = ctx.body;
  if (!b.file) throw new HttpError(400, 'Файл не получен');
  let items;
  try { items = require('./xlsx').parseDealerPrice(Buffer.from(String(b.file).replace(/^data:.*?base64,/, ''), 'base64')); }
  catch (e) { throw new HttpError(400, 'Не удалось прочитать прайс: ' + e.message); }
  const groups = {};
  for (const i of items) groups[i.group] = (groups[i.group] || 0) + 1;
  if (b.mode !== 'commit') {
    return { total: items.length, groups: Object.entries(groups).map(([name, n]) => ({ name, n, def: PRICE_DEFAULT_GROUPS.includes(name) })) };
  }
  const sel = new Set(Array.isArray(b.groups) ? b.groups : PRICE_DEFAULT_GROUPS);
  const supplier = str(b.supplier) || 'Спарта Маркет';
  let added = 0, updated = 0;
  tx(() => {
    for (const i of items) {
      if (!sel.has(i.group) || !i.name) continue;
      const isNoise = /шумоизол/i.test(i.group);
      const category = isNoise ? 'Шумоизоляция' + (i.brand ? ' · ' + i.brand : '') : (i.sub || i.group);
      const brand = isNoise ? i.sub : (i.brand || null);
      const ex = get('SELECT id FROM products WHERE sku=?', i.sku) || get('SELECT id FROM products WHERE ulower(name)=ulower(?)', i.name);
      if (ex) {
        run('UPDATE products SET sku=?, name=?, category=?, brand=COALESCE(?,brand), unit=?, cost=?, price=?, active=1 WHERE id=?',
          i.sku, i.name, category, brand, i.unit, i.cost, i.price || i.dealer, ex.id);
        updated++;
      } else {
        run('INSERT INTO products(sku,name,category,brand,unit,cost,price,stock,min_stock,warranty_months) VALUES(?,?,?,?,?,?,?,0,0,12)',
          i.sku, i.name, category, brand, i.unit, i.cost, i.price || i.dealer);
        added++;
      }
    }
    setSetting('price_import_last', `${today()} · ${supplier} · ${added + updated} поз.`);
  });
  return { added, updated };
});

// Массовая загрузка товаров (вставка из Excel): совпадение по названию обновляет цены
r.post('/api/products/import', OFFICE, (ctx) => {
  const rows = Array.isArray(ctx.body.rows) ? ctx.body.rows.slice(0, 5000) : [];
  let added = 0, updated = 0;
  tx(() => {
    for (const x of rows) {
      const name = str(x.name); if (!name) continue;
      const ex = get('SELECT * FROM products WHERE ulower(name)=ulower(?)', name);
      if (ex) {
        run('UPDATE products SET price=COALESCE(?,price), cost=COALESCE(?,cost), category=COALESCE(?,category), brand=COALESCE(?,brand), sku=COALESCE(?,sku), active=1 WHERE id=?',
          x.price !== '' && x.price != null ? num(x.price) : null, x.cost !== '' && x.cost != null ? num(x.cost) : null, str(x.category), str(x.brand), str(x.sku), ex.id);
        updated++;
      } else {
        const id = Number(run('INSERT INTO products(sku,name,category,brand,unit,cost,price,stock,min_stock,warranty_months) VALUES(?,?,?,?,?,?,?,0,0,12)',
          str(x.sku), name, str(x.category), str(x.brand), str(x.unit) || 'шт', num(x.cost), num(x.price)).lastInsertRowid);
        if (num(x.stock) > 0) moveStock(id, num(x.stock), 'in', null, 'Начальный остаток (импорт)', ctx.user);
        added++;
      }
    }
  });
  return { added, updated };
});

// Приход товара (накладная)
r.post('/api/stock/receipt', OFFICE, (ctx) => {
  const b = ctx.body;
  const items = Array.isArray(b.items) ? b.items.filter((i) => i.product_id && num(i.qty) > 0) : [];
  if (!items.length) throw new HttpError(400, 'Добавьте товары в приход');
  return tx(() => {
    let sum = 0;
    for (const i of items) {
      const p = get('SELECT * FROM products WHERE id=?', +i.product_id);
      if (!p) throw new HttpError(400, 'Товар не найден');
      const qty = num(i.qty); const cost = num(i.cost, p.cost);
      // средневзвешенная себестоимость
      const newStock = p.stock + qty;
      const avg = newStock > 0 ? (Math.max(p.stock, 0) * p.cost + qty * cost) / (Math.max(p.stock, 0) + qty) : cost;
      run('UPDATE products SET cost=? WHERE id=?', Math.round(avg * 100) / 100, p.id);
      moveStock(p.id, qty, 'in', null, str(b.note) || 'Приход', ctx.user);
      if (b.contractor_id) run('UPDATE stock_moves SET contractor_id=? WHERE id=(SELECT MAX(id) FROM stock_moves)', +b.contractor_id);
      sum += qty * cost;
    }
    const cid = b.contractor_id ? +b.contractor_id : null;
    const total = Math.round(sum * 100) / 100;
    const cname = cid ? (get('SELECT name FROM contractors WHERE id=?', cid) || {}).name : '';
    const note = [cname, str(b.note)].filter(Boolean).join(', ') || 'Приход товара';
    if (b.pay === 'debt' || b.pay === 'now') {
      if (!cid && b.pay === 'debt') throw new HttpError(400, 'Для покупки в долг выберите поставщика');
      if (cid) run("INSERT INTO contractor_ops(contractor_id,kind,amount,note,date,user_id) VALUES(?,'we_owe',?,?,?,?)", cid, total, 'Приход товара: ' + (str(b.note) || ''), today(), ctx.user.id);
      if (b.pay === 'now') run("INSERT INTO payments(direction,method,amount,category,note,contractor_id,user_id) VALUES('out',?,?,?,?,?,?)",
        b.method || 'transfer', total, 'Закупка товара', note, cid, ctx.user.id);
    } else if (b.pay) {
      run("INSERT INTO payments(direction,method,amount,category,note,contractor_id,user_id) VALUES('out',?,?,?,?,?,?)",
        b.method || 'transfer', total, 'Закупка товара', note, cid, ctx.user.id);
    }
    return { ok: true, sum };
  });
});

// Ручная корректировка / списание
r.post('/api/products/:id/move', OFFICE, (ctx) => {
  const qty = num(ctx.body.qty);
  if (!qty) throw new HttpError(400, 'Укажите количество');
  const kind = ctx.body.kind === 'adjust' ? 'adjust' : qty > 0 ? 'in' : 'out';
  tx(() => moveStock(+ctx.params.id, qty, kind, null, str(ctx.body.note) || (qty > 0 ? 'Приход' : 'Списание'), ctx.user));
  return { ok: true };
});

r.get('/api/stock/moves', OFFICE, (ctx) => {
  const p = []; let w = '1=1';
  if (ctx.query.product_id) { w += ' AND m.product_id=?'; p.push(+ctx.query.product_id); }
  return all(`SELECT m.*, pr.name product, pr.unit, u.name user FROM stock_moves m JOIN products pr ON pr.id=m.product_id
              LEFT JOIN users u ON u.id=m.user_id WHERE ${w} ORDER BY m.id DESC LIMIT 300`, ...p);
});

// ---------- Заказ-наряды ----------
function canSeeOrder(user, o) {
  if (user.role !== 'master') return true;
  return o.master_id === user.id || !!get('SELECT 1 FROM order_items WHERE order_id=? AND master_id=?', o.id, user.id);
}

r.get('/api/orders', (ctx) => {
  const q = ctx.query; const p = []; let w = '1=1';
  if (q.status === 'active') w += " AND o.status NOT IN ('issued','cancelled','estimate')";
  else if (q.status) { w += ' AND o.status=?'; p.push(q.status); }
  if (q.master_id) { w += ' AND o.master_id=?'; p.push(+q.master_id); }
  if (q.client_id) { w += ' AND o.client_id=?'; p.push(+q.client_id); }
  if (q.from) { w += ' AND o.created_at>=?'; p.push(q.from); }
  if (q.to) { w += ' AND o.created_at<=?'; p.push(q.to + ' 23:59:59'); }
  if (ctx.user.role === 'master') { w += ' AND (o.master_id=? OR o.id IN (SELECT order_id FROM order_items WHERE master_id=?))'; p.push(ctx.user.id, ctx.user.id); }
  if (q.q) {
    const s = q.q.trim(); const like = `%${lc(s)}%`; const id = parseInt(s.replace(/\D/g, ''), 10);
    w += " AND (ulower(c.name) LIKE ? OR c.phone_norm LIKE ? OR ulower(ca.plate) LIKE ? OR ulower(COALESCE(ca.brand,'')||' '||COALESCE(ca.model,'')) LIKE ? OR ulower(o.complaint) LIKE ? OR o.id=?)";
    p.push(like, `%${phoneDigits(s) || '#'}%`, `%${lc(s.replace(/\s/g, ''))}%`, like, like, isNaN(id) ? -1 : id);
  }
  const lim = Math.min(num(q.limit, 200), 1000);
  return all(`SELECT o.id,o.status,o.scheduled_at,o.bay,o.created_at,o.issued_at,o.complaint,c.id client_id,c.name client,c.phone,
              ca.brand,ca.model,ca.plate,u.name master, ${totalSql('o')} total,
              (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM payments p WHERE p.order_id=o.id) paid
              FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id LEFT JOIN users u ON u.id=o.master_id
              WHERE ${w} ORDER BY o.id DESC LIMIT ?`, ...p, lim);
});

function loadOrder(id) {
  const o = get(`SELECT o.*, c.name client_name, c.phone client_phone, c.email client_email, c.discount client_discount, c.tg_chat_id client_tg,
                 ca.brand, ca.model, ca.year, ca.vin, ca.plate, ca.color,
                 u.name master_name, m.name manager_name, ab.name accept_by_name, k.name contractor_name
                 FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id
                 LEFT JOIN users u ON u.id=o.master_id LEFT JOIN users m ON m.id=o.manager_id LEFT JOIN users ab ON ab.id=o.accept_by LEFT JOIN contractors k ON k.id=o.contractor_id WHERE o.id=?`, id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  o.number = orderNo(o.id);
  try { o.accept = JSON.parse(o.accept_kit || '{}'); } catch { o.accept = {}; }
  o.accept.kit = o.accept.kit || []; o.accept.works = o.accept.works || [];
  o.cashless_markup = +getSetting('cashless_markup', '0') || 0;
  o.accruals = all('SELECT a.*, u.name user FROM salary_accruals a LEFT JOIN users u ON u.id=a.user_id WHERE a.order_id=? ORDER BY a.id', id);
  o.items = all('SELECT i.*, u.name master_name, k.name contractor_name FROM order_items i LEFT JOIN users u ON u.id=i.master_id LEFT JOIN contractors k ON k.id=i.contractor_id WHERE order_id=? ORDER BY kind DESC, id', id);
  o.payments = all('SELECT p.*, u.name user, (SELECT SUM(a.amount) FROM payments a WHERE a.parent_id=p.id) acquiring FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE order_id=? ORDER BY id', id);
  o.log = all('SELECT l.*, u.name user FROM order_log l LEFT JOIN users u ON u.id=l.user_id WHERE order_id=? ORDER BY id DESC', id);
  const services = o.items.filter((i) => i.kind === 'service').reduce((s, i) => s + i.qty * i.price, 0);
  const goods = o.items.filter((i) => i.kind === 'product').reduce((s, i) => s + i.qty * i.price, 0);
  const sub = services + goods;
  const discount = Math.round(sub * (o.discount_percent || 0)) / 100;
  const total = Math.round((sub - discount) * 100) / 100;
  const paid = o.payments.reduce((s, p) => s + (p.direction === 'in' ? p.amount : -p.amount), 0);
  o.totals = { services, goods, sub, discount, total, paid, due: Math.round((total - paid) * 100) / 100 };
  o.saby = require('./saby').forOrder(o.id);
  o.photos = all('SELECT p.id, p.kind, p.note, p.size, p.created_at, u.name user FROM order_photos p LEFT JOIN users u ON u.id=p.user_id WHERE p.order_id=? ORDER BY p.id', o.id);
  return o;
}

r.get('/api/orders/:id', (ctx) => {
  const o = loadOrder(+ctx.params.id);
  if (!canSeeOrder(ctx.user, o)) throw new HttpError(403, 'Это не ваш заказ');
  if (ctx.user.role === 'master') o.items.forEach((i) => delete i.cost);
  return o;
});

r.post('/api/orders', OFFICE, (ctx) => {
  const b = ctx.body;
  return tx(() => {
    let clientId = b.client_id ? +b.client_id : null;
    if (!clientId && b.new_client) {
      need(b.new_client.name, 'Укажите имя клиента');
      const dup = findClientByPhone(b.new_client.phone);
      if (dup) clientId = dup.id;
      else clientId = Number(run('INSERT INTO clients(name,phone,phone_norm,source) VALUES(?,?,?,?)',
        str(b.new_client.name), str(b.new_client.phone), normPhone(b.new_client.phone), str(b.new_client.source)).lastInsertRowid);
    }
    need(clientId, 'Выберите клиента');
    let carId = b.car_id ? +b.car_id : null;
    if (!carId && b.new_car && (b.new_car.brand || b.new_car.model || b.new_car.plate)) carId = insertCar(clientId, b.new_car);
    const client = get('SELECT discount FROM clients WHERE id=?', clientId);
    const isEst = !!b.estimate; // предварительный расчёт
    const status = isEst ? 'estimate' : b.scheduled_at ? 'scheduled' : 'new';
    const res = run(`INSERT INTO orders(contractor_id,client_id,car_id,master_id,manager_id,status,scheduled_at,end_date,duration_min,bay,complaint,notes,mileage,discount_percent,created_by)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      b.contractor_id ? +b.contractor_id : null, clientId, carId, b.master_id ? +b.master_id : null, b.manager_id ? +b.manager_id : ctx.user.id, status, str(b.scheduled_at), endDate(b.scheduled_at, b.end_date),
      num(b.duration_min, 120), str(b.bay), str(b.complaint), str(b.notes), b.mileage ? num(b.mileage) : null,
      b.discount_percent !== undefined && b.discount_percent !== '' ? num(b.discount_percent) : client?.discount || 0, ctx.user.id);
    const id = Number(res.lastInsertRowid);
    if (isEst) run("UPDATE orders SET estimate_at=datetime('now','localtime') WHERE id=?", id);
    logOrder(id, ctx.user, isEst ? 'Создан предварительный расчёт' : 'Заказ создан');
    for (const it of b.items || []) addItem(id, it, ctx.user, false);
    if (b.lead_id) run("UPDATE leads SET status='converted', client_id=?, order_id=? WHERE id=?", clientId, id, +b.lead_id);
    if (b.scheduled_at && isDayOff(b.scheduled_at)) logOrder(id, ctx.user, 'Запись на выходной день (исключение)');
    if (b.scheduled_at && !isEst) notifyNewAppointment(id);
    return { id };
  });
});

r.put('/api/orders/:id', OFFICE, (ctx) => {
  const b = ctx.body; const id = +ctx.params.id;
  const o = get('SELECT * FROM orders WHERE id=?', id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  const changes = [];
  const fields = { contractor_id: 'контрагент', client_id: 'клиент', car_id: 'автомобиль', master_id: 'мастер', scheduled_at: 'дата записи', end_date: 'дата окончания', duration_min: 'длительность', bay: 'бокс', complaint: 'пожелания', notes: 'заметки', mileage: 'пробег', discount_percent: 'скидка' };
  const vals = {};
  for (const k of Object.keys(fields)) {
    let v = b[k] === undefined ? o[k] : b[k];
    if (['contractor_id', 'client_id', 'car_id', 'master_id', 'duration_min', 'mileage'].includes(k)) v = v === '' || v === null ? null : +v;
    else if (k === 'discount_percent') v = num(v);
    else v = str(v);
    vals[k] = v;
    if (String(v ?? '') !== String(o[k] ?? '')) changes.push(fields[k]);
  }
  vals.end_date = endDate(vals.scheduled_at, vals.end_date);
  run('UPDATE orders SET contractor_id=?,client_id=?,car_id=?,master_id=?,scheduled_at=?,end_date=?,duration_min=?,bay=?,complaint=?,notes=?,mileage=?,discount_percent=? WHERE id=?',
    vals.contractor_id, vals.client_id, vals.car_id, vals.master_id, vals.scheduled_at, vals.end_date, vals.duration_min, vals.bay, vals.complaint, vals.notes, vals.mileage, vals.discount_percent, id);
  if (vals.scheduled_at && o.status === 'new') run("UPDATE orders SET status='scheduled' WHERE id=?", id);
  if (changes.length) logOrder(id, ctx.user, 'Изменено: ' + changes.join(', '));
  syncAccruals(id);
  if (vals.scheduled_at && (vals.scheduled_at !== o.scheduled_at || vals.master_id !== o.master_id || vals.bay !== o.bay || vals.end_date !== o.end_date))
    notifyNewAppointment(id, { changed: !!o.scheduled_at, prevMaster: o.master_id });
  return { ok: true };
});

r.delete('/api/orders/:id', ADMIN, (ctx) => {
  const id = +ctx.params.id;
  tx(() => {
    const o = get('SELECT * FROM orders WHERE id=?', id);
    if (o && o.stock_written_off) returnStock(id, ctx.user);
    for (const i of all('SELECT * FROM order_items WHERE order_id=? AND debt_op_id IS NOT NULL', id)) cancelSupply(i, ctx.user);
    run('DELETE FROM orders WHERE id=?', id);
    run('DELETE FROM order_photos WHERE order_id=?', id);
  });
  try { require('node:fs').rmSync(require('node:path').join(require('./db').DATA_DIR, 'photos', String(id)), { recursive: true, force: true }); } catch {}
  return { ok: true };
});

function writeOffStock(orderId, user) {
  for (const i of all("SELECT * FROM order_items WHERE order_id=? AND kind='product' AND ref_id IS NOT NULL", orderId)) {
    moveStock(i.ref_id, -i.qty, 'order', orderId, 'Списание по заказу ' + orderNo(orderId), user);
  }
  run('UPDATE orders SET stock_written_off=1 WHERE id=?', orderId);
}
function returnStock(orderId, user) {
  for (const i of all("SELECT * FROM order_items WHERE order_id=? AND kind='product' AND ref_id IS NOT NULL", orderId)) {
    moveStock(i.ref_id, i.qty, 'order', orderId, 'Возврат по заказу ' + orderNo(orderId), user);
  }
  run('UPDATE orders SET stock_written_off=0 WHERE id=?', orderId);
}

// Смена статуса (из CRM и по кнопкам в MAX)
function changeStatus(id, st, user) {
  if (!STATUSES.includes(st)) throw new HttpError(400, 'Неизвестный статус');
  const o = get('SELECT * FROM orders WHERE id=?', id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (user.role === 'master') {
    if (!canSeeOrder(user, o)) throw new HttpError(403, 'Это не ваш заказ');
    if (!['in_work', 'waiting', 'done'].includes(st)) throw new HttpError(403, 'Мастер может ставить только «В работе», «Ждёт запчасти», «Готов»');
  }
  if (o.status === st) return { ok: true, same: true };
  if (st === 'estimate') throw new HttpError(400, 'Вернуть заказ в предварительный расчёт нельзя');
  const lowBefore = new Set(all('SELECT id FROM products WHERE min_stock>0 AND stock<=min_stock').map((x) => x.id));
  tx(() => {
    if (st === 'issued' && !o.stock_written_off) writeOffStock(id, user);
    if (st !== 'issued' && o.stock_written_off) returnStock(id, user);
    run('UPDATE orders SET status=?, done_at=CASE WHEN ?=\'done\' THEN datetime(\'now\',\'localtime\') ELSE done_at END, issued_at=CASE WHEN ?=\'issued\' THEN datetime(\'now\',\'localtime\') WHEN ?<>\'issued\' THEN NULL ELSE issued_at END WHERE id=?',
      st, st, st, st, id);
    logOrder(id, user, `Статус: ${STATUS_RU[o.status]} → ${STATUS_RU[st]}`);
    const acc = syncAccruals(id);
    if (st === 'issued' && acc.length) {
      const byUser = {}; for (const a of acc) byUser[a.user_id] = (byUser[a.user_id] || 0) + a.amount;
      logOrder(id, user, 'Начислена зарплата: ' + Object.entries(byUser).map(([u, v]) => `${(get('SELECT name FROM users WHERE id=?', +u) || {}).name} — ${Math.round(v * 100) / 100} ₽`).join(', '));
    }
    if (o.status === 'issued' && st !== 'issued') logOrder(id, user, 'Начисления зарплаты по заказу отменены');
  });
  // уведомления
  try {
    const full = loadOrder(id);
    const carS = [full.brand, full.model, full.plate].filter(Boolean).join(' ');
    if (st === 'done') {
      notify.boss('order_done', `✅ **Готов ${full.number}** — ${carS}\n${full.client_name || ''} ${full.client_phone || ''}\nК оплате: ${full.totals.due} ₽${user.role === 'master' ? '\nОтметил: ' + user.name : ''}`, { orderId: id });
      if (full.client_tg && getSetting('tg_notify_client_done') === '1') {
        tg.send(full.client_tg, `Здравствуйте! Ваш автомобиль ${[full.brand, full.model].filter(Boolean).join(' ')} готов. Можно забирать.\n${getSetting('company_name')}${getSetting('company_address') ? ', ' + getSetting('company_address') : ''}`);
      }
    }
    if (st === 'in_work' || st === 'waiting') {
      if (user.role === 'master') notify.boss('order_new', `${st === 'in_work' ? '🔧' : '⏳'} ${full.number} — ${carS}: **${STATUS_RU[st]}** (${user.name})`, { orderId: id });
    }
    if (st === 'issued') {
      notify.boss('order_issued', `🚗 **Выдан ${full.number}** — ${carS}\nСумма: ${full.totals.total} ₽ · оплачено: ${full.totals.paid} ₽${full.totals.due > 0.5 ? `\n⚠️ Долг клиента: ${full.totals.due} ₽` : ''}`, { orderId: id });
      const low = all('SELECT id,name,stock,unit FROM products WHERE min_stock>0 AND stock<=min_stock').filter((x) => !lowBefore.has(x.id));
      if (low.length) notify.boss('low_stock', '📦 **Заканчивается на складе:**\n' + low.map((x) => `• ${x.name} — ${x.stock} ${x.unit}`).join('\n'));
    }
    if (st === 'cancelled' && full.master_id) notify.toUser(full.master_id, 'my_changed', `❌ Запись **${full.number}** отменена — ${carS}`, { orderId: id });
  } catch (e) { console.error('notify status', e.message); }
  return { ok: true };
}
r.post('/api/orders/:id/status', (ctx) => changeStatus(+ctx.params.id, ctx.body.status, ctx.user));
// Клиент согласился: расчёт → заказ-наряд (номер и позиции сохраняются)
r.post('/api/orders/:id/convert', OFFICE, (ctx) => {
  const id = +ctx.params.id; const o = get('SELECT * FROM orders WHERE id=?', id);
  if (!o) throw new HttpError(404, 'Расчёт не найден');
  if (o.status !== 'estimate') throw new HttpError(400, 'Это уже заказ-наряд');
  const st = o.scheduled_at ? 'scheduled' : 'new';
  tx(() => {
    run("UPDATE orders SET status=?, created_at=datetime('now','localtime') WHERE id=?", st, id);
    logOrder(id, ctx.user, `Клиент согласился: предварительный расчёт от ${String(o.estimate_at || o.created_at).slice(0, 10).split('-').reverse().join('.')} переведён в заказ-наряд`);
    syncAccruals(id);
  });
  try {
    const full = loadOrder(id);
    notify.boss('order_new', `🆕 **Заказ-наряд ${full.number}** из расчёта — ${[full.brand, full.model, full.plate].filter(Boolean).join(' ')}\n${full.client_name || ''} ${full.client_phone || ''}\nСумма: ${full.totals.total} ₽`, { orderId: id, exclude: ctx.user.id });
    if (o.scheduled_at) notifyNewAppointment(id);
  } catch {}
  return { ok: true, status: st };
});

r.post('/api/orders/:id/comment', (ctx) => {
  const o = get('SELECT * FROM orders WHERE id=?', +ctx.params.id);
  if (!o || !canSeeOrder(ctx.user, o)) throw new HttpError(403, 'Нет доступа');
  logOrder(o.id, ctx.user, '💬 ' + need(ctx.body.text, 'Пустой комментарий'));
  return { ok: true };
});

// ---------- Начисление зарплаты по заказу ----------
// Пока заказ «Выдан» — по каждой работе начисляется % мастеру (мастер работы или мастер заказа).
// Процент фиксируется в момент выдачи; при правке выданного заказа суммы пересчитываются.
function syncAccruals(orderId) {
  const o = get('SELECT id,status,master_id,discount_percent,issued_at FROM orders WHERE id=?', orderId);
  if (!o) return [];
  const prevRows = all('SELECT item_id,user_id,percent,manual,amount,note FROM salary_accruals WHERE order_id=?', orderId);
  const prev = new Map(prevRows.map((a) => [a.item_id + ':' + a.user_id, a.percent]));
  const manual = new Map(prevRows.filter((a) => a.manual).map((a) => [a.item_id + ':' + a.user_id, a]));
  run('DELETE FROM salary_accruals WHERE order_id=?', orderId);
  if (o.status !== 'issued') return [];
  const out = [];
  for (const i of all("SELECT * FROM order_items WHERE order_id=? AND kind='service'", orderId)) {
    const uid = i.master_id || o.master_id; if (!uid) continue;
    const u = get('SELECT salary_percent FROM users WHERE id=?', uid); if (!u) continue;
    const pct = prev.has(i.id + ':' + uid) ? prev.get(i.id + ':' + uid) : (u.salary_percent || 0);
    const man = manual.get(i.id + ':' + uid);
    if (!pct && !man) continue;
    const base = Math.round(i.qty * i.price * (1 - (o.discount_percent || 0) / 100) * 100) / 100;
    const amount = man ? man.amount : Math.round(base * pct) / 100;
    run('INSERT INTO salary_accruals(order_id,item_id,user_id,name,base,percent,amount,created_at,manual,note) VALUES(?,?,?,?,?,?,?,?,?,?)',
      orderId, i.id, uid, i.name, base, pct, amount, o.issued_at, man ? 1 : 0, man ? man.note : null);
    out.push({ user_id: uid, amount });
  }
  return out;
}
// разовый перенос уже выданных заказов в начисления
if (getSetting('accruals_backfill') === '1') {
  tx(() => { for (const o of all("SELECT id FROM orders WHERE status='issued'")) syncAccruals(o.id); setSetting('accruals_backfill', '0'); });
}

// Резерв: товар уже лежит в открытых заказ-нарядах (со склада спишется при выдаче). Свободно = остаток − резерв.
const RESERVED_SQL = `(SELECT COALESCE(SUM(ri.qty),0) FROM order_items ri JOIN orders ro ON ro.id=ri.order_id
  WHERE ri.kind='product' AND ri.ref_id=products.id AND ro.stock_written_off=0 AND ro.status NOT IN ('issued','cancelled','estimate'))`;
function reservedQty(productId, exceptItemId) {
  return get(`SELECT COALESCE(SUM(i.qty),0) q FROM order_items i JOIN orders o ON o.id=i.order_id
    WHERE i.kind='product' AND i.ref_id=? AND i.id<>? AND o.stock_written_off=0 AND o.status NOT IN ('issued','cancelled','estimate')`, productId, exceptItemId || 0).q;
}
// Товар у поставщика: недостающее (с учётом резерва под другие заказы) приходуется от контрагента в долг; force — весь товар в долг
function supplyFromContractor(orderId, itemId, productId, qty, cost, cid, user, force = false) {
  const p = get('SELECT * FROM products WHERE id=?', productId);
  const c = get('SELECT name FROM contractors WHERE id=?', cid);
  if (!p || !c) throw new HttpError(400, 'Товар или поставщик не найден');
  const free = p.stock - reservedQty(productId, itemId);
  const missing = force ? qty : Math.max(0, qty - Math.max(free, 0));
  run('UPDATE order_items SET contractor_id=? WHERE id=?', cid, itemId);
  if (missing <= 0) return 0;
  const amount = Math.round(missing * cost * 100) / 100;
  const opId = Number(run("INSERT INTO contractor_ops(contractor_id,kind,amount,note,date,user_id) VALUES(?,'we_owe',?,?,?,?)",
    cid, amount, `${p.name} × ${missing} под заказ ${orderNo(orderId)}`, today(), user.id).lastInsertRowid);
  moveStock(productId, missing, 'in', orderId, `Поставка под заказ ${orderNo(orderId)} от ${c.name}`, user);
  run('UPDATE stock_moves SET contractor_id=? WHERE id=(SELECT MAX(id) FROM stock_moves)', cid);
  if (cost && cost !== p.cost) run('UPDATE products SET cost=? WHERE id=?', cost, productId);
  run('UPDATE order_items SET debt_op_id=?, supplied_qty=? WHERE id=?', opId, missing, itemId);
  logOrder(orderId, user, `Поставщик ${c.name}: ${p.name} × ${missing} взят в долг на ${amount} ₽`);
  return missing;
}
function cancelSupply(i, user) {
  if (!i.debt_op_id) return;
  run('DELETE FROM contractor_ops WHERE id=?', i.debt_op_id);
  if (i.ref_id && i.supplied_qty) moveStock(i.ref_id, -i.supplied_qty, 'adjust', i.order_id, `Отмена поставки под заказ ${orderNo(i.order_id)}`, user);
}

function addItem(orderId, b, user, log = true) {
  const kind = b.kind === 'product' ? 'product' : 'service';
  let name = str(b.name), price = num(b.price), cost = num(b.cost), warranty = num(b.warranty_months);
  if (b.ref_id) {
    const ref = get(`SELECT * FROM ${kind === 'product' ? 'products' : 'services'} WHERE id=?`, +b.ref_id);
    if (!ref) throw new HttpError(400, 'Позиция не найдена');
    name = name || ref.name;
    if (b.price === undefined || b.price === '') price = ref.price;
    if (kind === 'product') cost = b.cost !== undefined && b.cost !== '' ? num(b.cost) : ref.cost;
    if (b.warranty_months === undefined || b.warranty_months === '') warranty = ref.warranty_months;
  }
  need(name, 'Укажите название позиции');
  const o = get('SELECT master_id, stock_written_off, status FROM orders WHERE id=?', orderId);
  const res = run('INSERT INTO order_items(order_id,kind,ref_id,name,qty,price,cost,master_id,warranty_months) VALUES(?,?,?,?,?,?,?,?,?)',
    orderId, kind, b.ref_id ? +b.ref_id : null, name, num(b.qty, 1), price, cost,
    kind === 'service' ? (b.master_id ? +b.master_id : o.master_id) : null, warranty);
  const itemId = Number(res.lastInsertRowid);
  if (log) logOrder(orderId, user, `Добавлено: ${name} × ${num(b.qty, 1)}`);
  // сначала поставка от контрагента (если товара не хватает), потом списание при выданном заказе
  if (kind === 'product' && b.ref_id && b.contractor_id && o.status !== 'estimate') supplyFromContractor(orderId, itemId, +b.ref_id, num(b.qty, 1), cost, +b.contractor_id, user, !!b.debt);
  if (o.stock_written_off && kind === 'product' && b.ref_id) moveStock(+b.ref_id, -num(b.qty, 1), 'order', orderId, 'Списание по заказу ' + orderNo(orderId), user);
  syncAccruals(orderId);
  return itemId;
}

r.post('/api/orders/:id/items', OFFICE, (ctx) => ({ id: tx(() => addItem(+ctx.params.id, ctx.body, ctx.user)) }));

// «В долг» для уже добавленного товара: оприходовать от поставщика и записать долг (или отменить)
r.post('/api/order-items/:id/debt', OFFICE, (ctx) => {
  const i = get('SELECT * FROM order_items WHERE id=?', +ctx.params.id);
  if (!i || i.kind !== 'product' || !i.ref_id) throw new HttpError(400, 'В долг можно взять только товар из каталога');
  const o = get('SELECT status, stock_written_off FROM orders WHERE id=?', i.order_id);
  if (o.status === 'estimate') throw new HttpError(400, 'Сначала переведите расчёт в заказ-наряд');
  if (i.debt_op_id) throw new HttpError(409, 'Этот товар уже взят в долг');
  const b = ctx.body; const cid = +b.contractor_id; if (!cid) throw new HttpError(400, 'Выберите поставщика');
  const qty = Math.min(num(b.qty, i.qty), i.qty); if (qty <= 0) throw new HttpError(400, 'Укажите количество');
  const cost = num(b.cost, i.cost); if (cost <= 0) throw new HttpError(400, 'Укажите закупочную цену — по ней считается долг');
  tx(() => {
    if (cost !== i.cost) run('UPDATE order_items SET cost=? WHERE id=?', cost, i.id);
    supplyFromContractor(i.order_id, i.id, i.ref_id, qty, cost, cid, ctx.user, true);
    syncAccruals(i.order_id);
  });
  return { ok: true };
});
r.delete('/api/order-items/:id/debt', OFFICE, (ctx) => {
  const i = get('SELECT * FROM order_items WHERE id=?', +ctx.params.id);
  if (!i || !i.debt_op_id) throw new HttpError(400, 'Долга по этой позиции нет');
  tx(() => {
    cancelSupply(i, ctx.user);
    run('UPDATE order_items SET debt_op_id=NULL, supplied_qty=0 WHERE id=?', i.id);
    logOrder(i.order_id, ctx.user, `Долг поставщику по «${i.name}» отменён — товар со склада`);
  });
  return { ok: true };
});

r.put('/api/order-items/:id', OFFICE, (ctx) => {
  const b = ctx.body;
  const i = get('SELECT * FROM order_items WHERE id=?', +ctx.params.id);
  if (!i) throw new HttpError(404, 'Позиция не найдена');
  tx(() => {
    const o = get('SELECT stock_written_off FROM orders WHERE id=?', i.order_id);
    const qty = num(b.qty, i.qty);
    if (o.stock_written_off && i.kind === 'product' && i.ref_id && qty !== i.qty) moveStock(i.ref_id, i.qty - qty, 'order', i.order_id, 'Корректировка по заказу ' + orderNo(i.order_id), ctx.user);
    run('UPDATE order_items SET name=?,qty=?,price=?,master_id=?,warranty_months=? WHERE id=?',
      str(b.name) || i.name, qty, num(b.price, i.price), b.master_id === undefined ? i.master_id : b.master_id ? +b.master_id : null,
      num(b.warranty_months, i.warranty_months), i.id);
    logOrder(i.order_id, ctx.user, `Изменено: ${i.name}`);
    syncAccruals(i.order_id);
  });
  return { ok: true };
});

r.delete('/api/order-items/:id', OFFICE, (ctx) => {
  const i = get('SELECT * FROM order_items WHERE id=?', +ctx.params.id);
  if (!i) return { ok: true };
  tx(() => {
    const o = get('SELECT stock_written_off FROM orders WHERE id=?', i.order_id);
    if (o.stock_written_off && i.kind === 'product' && i.ref_id) moveStock(i.ref_id, i.qty, 'order', i.order_id, 'Возврат по заказу ' + orderNo(i.order_id), ctx.user);
    cancelSupply(i, ctx.user);
    run('DELETE FROM order_items WHERE id=?', i.id);
    logOrder(i.order_id, ctx.user, `Удалено: ${i.name}${i.debt_op_id ? ' (долг поставщику отменён)' : ''}`);
    syncAccruals(i.order_id);
  });
  return { ok: true };
});

r.post('/api/orders/:id/pay', OFFICE, (ctx) => {
  const id = +ctx.params.id; const b = ctx.body;
  const amount = num(b.amount);
  if (!amount) throw new HttpError(400, 'Укажите сумму');
  const refund = amount < 0 || b.refund;
  const pr = run('INSERT INTO payments(order_id,direction,method,amount,category,note,user_id) VALUES(?,?,?,?,?,?,?)',
    id, refund ? 'out' : 'in', b.method || 'cash', Math.abs(amount), refund ? 'Возврат клиенту' : 'Оплата заказа', str(b.note), ctx.user.id);
  const fee = refund ? 0 : addAcquiring(Number(pr.lastInsertRowid));
  logOrder(id, ctx.user, `${refund ? 'Возврат' : 'Оплата'}: ${Math.abs(amount)} ₽ (${{ cash: 'наличные', card: 'перевод на карту', terminal: 'терминал', transfer: 'расчётный счёт' }[b.method || 'cash']})${fee ? ` · эквайринг ${fee} ₽ (расход)` : ''}`);
  return { ok: true };
});

// ---------- Фото автомобиля ----------
const PHOTO_DIR = require('node:path').join(require('./db').DATA_DIR, 'photos');
const fsP = require('node:fs');
function photoPath(ph) { return require('node:path').join(PHOTO_DIR, String(ph.order_id), ph.file); }
r.post('/api/orders/:id/photos', (ctx) => {
  const o = get('SELECT * FROM orders WHERE id=?', +ctx.params.id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (!canSeeOrder(ctx.user, loadOrder(o.id))) throw new HttpError(403, 'Это не ваш заказ');
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/s.exec(String(ctx.body.data || ''));
  if (!m) throw new HttpError(400, 'Нужна фотография (JPEG/PNG)');
  const buf = Buffer.from(m[2], 'base64');
  const isJpg = buf[0] === 0xff && buf[1] === 0xd8, isPng = buf[0] === 0x89 && buf[1] === 0x50, isWebp = buf.slice(8, 12).toString() === 'WEBP';
  if (!(isJpg || isPng || isWebp) || buf.length < 500) throw new HttpError(400, 'Файл не похож на фотографию');
  if (buf.length > 8 * 1024 * 1024) throw new HttpError(413, 'Фото больше 8 МБ');
  const dir = require('node:path').join(PHOTO_DIR, String(o.id)); fsP.mkdirSync(dir, { recursive: true });
  const file = Date.now().toString(36) + require('node:crypto').randomBytes(3).toString('hex') + (isPng ? '.png' : isWebp ? '.webp' : '.jpg');
  fsP.writeFileSync(require('node:path').join(dir, file), buf);
  const res = run('INSERT INTO order_photos(order_id,kind,file,size,note,user_id) VALUES(?,?,?,?,?,?)', o.id, str(ctx.body.kind) || 'accept', file, buf.length, str(ctx.body.note), ctx.user.id);
  return { id: Number(res.lastInsertRowid) };
});
r.get('/api/photos/:id', (ctx) => {
  const ph = get('SELECT * FROM order_photos WHERE id=?', +ctx.params.id);
  if (!ph) throw new HttpError(404, 'Фото не найдено');
  if (ctx.user.role === 'master' && !canSeeOrder(ctx.user, loadOrder(ph.order_id))) throw new HttpError(403, 'Это не ваш заказ');
  let buf; try { buf = fsP.readFileSync(photoPath(ph)); } catch { throw new HttpError(404, 'Файл фото не найден'); }
  ctx.res.writeHead(200, { 'Content-Type': ph.file.endsWith('.png') ? 'image/png' : ph.file.endsWith('.webp') ? 'image/webp' : 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'private, max-age=31536000, immutable',
    ...(ctx.query.dl ? { 'Content-Disposition': `attachment; filename="${orderNo(ph.order_id)}-${ph.id}.jpg"` } : {}) });
  ctx.res.end(buf);
});
r.delete('/api/photos/:id', OFFICE, (ctx) => {
  const ph = get('SELECT * FROM order_photos WHERE id=?', +ctx.params.id);
  if (!ph) return { ok: true };
  try { fsP.unlinkSync(photoPath(ph)); } catch {}
  run('DELETE FROM order_photos WHERE id=?', ph.id);
  logOrder(ph.order_id, ctx.user, 'Удалено фото автомобиля');
  return { ok: true };
});
// Отправка фото в MAX: сотрудникам и/или в общий чат, с пометкой заказа
r.post('/api/orders/:id/photos/send', OFFICE, async (ctx) => {
  const o = loadOrder(+ctx.params.id); const b = ctx.body;
  if (!getSetting('max_token')) throw new HttpError(400, 'MAX не подключён: укажите токен бота в Настройках');
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number);
  const photos = o.photos.filter((p) => !ids.length || ids.includes(p.id)).map((p) => get('SELECT * FROM order_photos WHERE id=?', p.id));
  if (!photos.length) throw new HttpError(400, 'Нет фото для отправки');
  const targets = [];
  for (const uid of (Array.isArray(b.users) ? b.users : []).map(Number)) {
    const u = get('SELECT id,name,max_user_id,max_chat_id FROM users WHERE id=? AND active=1', uid);
    if (u && (u.max_user_id || u.max_chat_id)) targets.push({ name: u.name, to: u.max_chat_id ? { chat_id: u.max_chat_id } : { user_id: u.max_user_id } });
  }
  if (b.group && getSetting('max_group_chat_id')) targets.push({ name: 'общий чат', to: { chat_id: +getSetting('max_group_chat_id') } });
  if (!targets.length) throw new HttpError(400, 'Выберите получателей, подключённых к MAX');
  // загружаем каждое фото в MAX один раз (вложение кешируется)
  const atts = [];
  for (const ph of photos) {
    if (ph.max_att) { atts.push(JSON.parse(ph.max_att)); continue; }
    let buf; try { buf = fsP.readFileSync(photoPath(ph)); } catch { continue; }
    const up = await max.uploadImage(buf, `${o.number}-${ph.id}.jpg`);
    if (!up.ok) throw new HttpError(502, 'MAX: ' + up.error);
    run('UPDATE order_photos SET max_att=? WHERE id=?', JSON.stringify(up.attachment), ph.id);
    atts.push(up.attachment);
  }
  const car = [o.brand, o.model, o.plate].filter(Boolean).join(' ');
  const head = `📷 **Заказ ${o.number}**${car ? ' — ' + car : ''}\n${o.client_name || ''}${o.accept_at ? ' · принят ' + o.accept_at.slice(8, 10) + '.' + o.accept_at.slice(5, 7) + ' ' + o.accept_at.slice(11, 16) : ''}${o.accept_damage ? '\n⚠️ Повреждения: ' + o.accept_damage : ''}${b.note ? '\n💬 ' + String(b.note).slice(0, 500) : ''}\nФото: ${atts.length} шт · отправил ${ctx.user.name}`;
  let sent = 0; const errors = [];
  for (const t of targets) {
    for (let i = 0; i < atts.length; i += 10) {
      const r = await max.sendMedia(t.to, i === 0 ? head : `📷 ${o.number} (продолжение)`, atts.slice(i, i + 10));
      if (!r.ok) { errors.push(`${t.name}: ${r.error}`); break; }
      if (i + 10 >= atts.length) sent++;
    }
  }
  logOrder(o.id, ctx.user, `Фото (${atts.length}) отправлены в MAX: ${targets.map((t) => t.name).join(', ')}${errors.length ? ' — ошибки: ' + errors.join('; ') : ''}`);
  if (!sent) throw new HttpError(502, 'Не отправлено: ' + errors.join('; '));
  return { ok: true, sent, errors };
});

// ---------- Календарь ----------
r.get('/api/calendar', (ctx) => {
  const from = ctx.query.from || today(); const to = ctx.query.to || from;
  const p = [to, from]; let w = '';
  if (ctx.user.role === 'master') { w = ' AND (o.master_id=? OR o.id IN (SELECT order_id FROM order_items WHERE master_id=?))'; p.push(ctx.user.id, ctx.user.id); }
  const orders = all(`SELECT o.id,o.status,o.scheduled_at,o.end_date,o.duration_min,o.bay,o.master_id,o.complaint,c.name client,c.phone,ca.brand,ca.model,ca.plate,u.name master
              FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id LEFT JOIN users u ON u.id=o.master_id
              WHERE o.scheduled_at IS NOT NULL AND substr(o.scheduled_at,1,10)<=? AND COALESCE(o.end_date,substr(o.scheduled_at,1,10))>=?
              AND o.status NOT IN ('cancelled','estimate')${w} ORDER BY o.scheduled_at`, ...p);
  if (ctx.query.format !== 'journal') return orders; // старый формат (по часам)
  const notes = all('SELECT id,date,bay,text,color FROM cal_notes WHERE date>=? AND date<=? ORDER BY id', from, to);
  return { orders, notes };
});

// Заметки в ячейках журнала (как в Excel: «Сергей отсутствует», «АМТ», предварительные записи)
const NOTE_COLORS = ['#93c47d', '#ea9999', '#ffe599', '#b7b7b7', '#ff9900', '#9fc5e8', '#ffffff'];
function noteColor(c) { c = String(c || '').toLowerCase(); return /^#[0-9a-f]{6}$/.test(c) ? c : '#ffe599'; }
r.post('/api/cal-notes', OFFICE, (ctx) => {
  const b = ctx.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw new HttpError(400, 'Неверная дата');
  const days = Math.min(Math.max(num(b.days, 1), 1), 60);
  const ids = tx(() => {
    const out = []; const d0 = new Date(b.date + 'T12:00:00');
    for (let i = 0; i < days; i++) {
      const d = new Date(d0); d.setDate(d0.getDate() + i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push(Number(run('INSERT INTO cal_notes(date,bay,text,color,created_by) VALUES(?,?,?,?,?)', ds, str(b.bay), need(b.text, 'Пустая заметка'), noteColor(b.color), ctx.user.id).lastInsertRowid));
    }
    return out;
  });
  return { ids };
});
r.put('/api/cal-notes/:id', OFFICE, (ctx) => {
  const b = ctx.body;
  run('UPDATE cal_notes SET text=?, color=?, bay=?, date=COALESCE(?,date) WHERE id=?', need(b.text, 'Пустая заметка'), noteColor(b.color), str(b.bay), str(b.date), +ctx.params.id);
  return { ok: true };
});
r.delete('/api/cal-notes/:id', OFFICE, (ctx) => { run('DELETE FROM cal_notes WHERE id=?', +ctx.params.id); return { ok: true }; });
// Импорт журнала из Excel (файл готовится отдельно, JSON: [{date,bay,text,color}])
r.post('/api/cal-notes/import', ADMIN, (ctx) => {
  const list = Array.isArray(ctx.body.notes) ? ctx.body.notes : [];
  let added = 0;
  tx(() => {
    for (const n of list) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date || '') || !n.text) continue;
      if (get('SELECT 1 FROM cal_notes WHERE date=? AND bay IS ? AND text=?', n.date, str(n.bay), String(n.text))) continue;
      run('INSERT INTO cal_notes(date,bay,text,color,created_by) VALUES(?,?,?,?,?)', n.date, str(n.bay), String(n.text).slice(0, 2000), noteColor(n.color), ctx.user.id);
      added++;
    }
  });
  return { added, total: list.length };
});

// Приёмка автомобиля в работу
r.put('/api/orders/:id/accept', OFFICE, (ctx) => {
  const b = ctx.body; const id = +ctx.params.id;
  const o = get('SELECT accept_at FROM orders WHERE id=?', id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  run('UPDATE orders SET accept_at=?, accept_damage=?, accept_items=?, accept_by=COALESCE(accept_by,?), mileage=COALESCE(?,mileage) WHERE id=?',
    str(b.accept_at) || o.accept_at || nowLocal(), str(b.accept_damage), str(b.accept_items), ctx.user.id, b.mileage ? num(b.mileage) : null, id);
  if (!o.accept_at) {
    logOrder(id, ctx.user, 'Автомобиль принят в работу (акт приёма)');
    const full = loadOrder(id);
    if (full.master_id) notify.toUser(full.master_id, 'my_assigned', `🚗 **Авто принято: ${full.number}** — ${[full.brand, full.model, full.plate].filter(Boolean).join(' ')}${full.bay ? ' · ' + full.bay : ''}${full.accept_damage ? '\n⚠️ Повреждения: ' + full.accept_damage : ''}`, { orderId: id, buttons: notify.statusButtons(id) });
  }
  return { ok: true };
});
function nowLocal() { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); }

// Эквайринг: с каждой оплаты через терминал (зачисляется на расчётный счёт) — расход банку, клиенту сумма не меняется
function addAcquiring(paymentId) {
  const p = get('SELECT * FROM payments WHERE id=?', paymentId);
  const pct = +getSetting('acquiring_percent', '2') || 0;
  if (!p || p.direction !== 'in' || p.method !== 'terminal' || pct <= 0) return 0;
  const fee = Math.round(p.amount * pct) / 100; if (fee <= 0) return 0;
  run(`INSERT INTO payments(direction,method,amount,category,note,user_id,parent_id,created_at) VALUES('out','transfer',?,'Эквайринг',?,?,?,?)`,
    fee, `${pct}% с оплаты через терминал ${p.amount} ₽${p.order_id ? ' · заказ ' + orderNo(p.order_id) : ''}`, p.user_id, p.id, p.created_at);
  return fee;
}
// ---------- Касса ----------
r.get('/api/payments', OFFICE, (ctx) => {
  const [from, to] = period(ctx.query); const p = [from, to]; let w = '';
  if (ctx.query.direction) { w += ' AND p.direction=?'; p.push(ctx.query.direction); }
  if (ctx.query.method) { w += ' AND p.method=?'; p.push(ctx.query.method); }
  return all(`SELECT p.*, u.name user, e.name employee, c.name client, k.name contractor FROM payments p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN users e ON e.id=p.employee_id
              LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN contractors k ON k.id=p.contractor_id
              WHERE p.created_at>=? AND p.created_at<=?${w} ORDER BY p.id DESC LIMIT 2000`, ...p);
});
r.post('/api/payments', OFFICE, (ctx) => {
  const b = ctx.body;
  const amount = num(b.amount);
  if (amount <= 0) throw new HttpError(400, 'Сумма должна быть больше нуля');
  if (b.category === 'Зарплата' && !auth.isAdminUser(ctx.user)) throw new HttpError(403, 'Выплату зарплаты проводит администратор');
  const res = run('INSERT INTO payments(direction,method,amount,category,note,employee_id,contractor_id,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,COALESCE(?,datetime(\'now\',\'localtime\')))',
    b.direction === 'in' ? 'in' : 'out', b.method || 'cash', amount, str(b.category), str(b.note), b.employee_id ? +b.employee_id : null, b.contractor_id ? +b.contractor_id : null, ctx.user.id,
    b.date ? b.date + ' 12:00:00' : null);
  if (b.category !== 'Эквайринг') addAcquiring(Number(res.lastInsertRowid));
  return { id: Number(res.lastInsertRowid) };
});
r.delete('/api/payments/:id', ADMIN, (ctx) => {
  const p = get('SELECT * FROM payments WHERE id=?', +ctx.params.id);
  if (p && p.order_id) logOrder(p.order_id, ctx.user, `Удалён платёж ${p.amount} ₽`);
  run('DELETE FROM payments WHERE id=? OR parent_id=?', +ctx.params.id, +ctx.params.id);
  return { ok: true };
});

// ---------- График работы ----------
const SCHED_ST = { work: 'Работает', off: 'Выходной', vac: 'Отпуск', sick: 'Больничный', abs: 'Отсутствует' };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function addDays(ds, n) { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
// отсутствующие мастера на даты [from..to]: { user_id: [даты] }
function absentMasters(from, to) {
  const res = {}; if (!from || !DATE_RE.test(from)) return res; if (!to || !DATE_RE.test(to) || to < from) to = from;
  const ms = all("SELECT id FROM users WHERE active=1 AND (role='master' OR is_master=1)");
  const ex = {}; for (const e of all('SELECT user_id, date, status FROM work_schedule WHERE date>=? AND date<=?', from, to)) ex[e.user_id + '|' + e.date] = e.status;
  for (let d = from, i = 0; d <= to && i < 62; d = addDays(d, 1), i++) for (const m of ms) {
    const st = ex[m.id + '|' + d]; if (st ? st !== 'work' : isDayOff(d)) (res[m.id] = res[m.id] || []).push(d);
  }
  return res;
}
r.get('/api/schedule', OFFICE, (ctx) => {
  const month = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : today().slice(0, 7);
  const from = month + '-01'; const last = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate(); const to = month + '-' + String(last).padStart(2, '0');
  const users = all("SELECT id,name,role,is_master,default_hours FROM users WHERE active=1 AND COALESCE(deleted,0)=0 AND (role<>'admin' OR is_master=1) ORDER BY role='master', is_master DESC, name")
    .map((u) => ({ ...u, role: uiRole(u) }));
  return { month, from, to, statuses: SCHED_ST, users,
    entries: all('SELECT w.user_id, w.date, w.status, w.hours, w.note, u.name updated_by_name FROM work_schedule w LEFT JOIN users u ON u.id=w.updated_by WHERE w.date>=? AND w.date<=?', from, to) };
});
// записи за интервал (для выбора мастера в заказах и журнале)
r.get('/api/schedule/absent', (ctx) => absentMasters(ctx.query.from, ctx.query.to));
// поставить статус / часы на день или на период
r.put('/api/schedule', OFFICE, (ctx) => {
  const b = ctx.body; const uid = +b.user_id;
  const u = get('SELECT id, name, default_hours FROM users WHERE id=?', uid);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  if (!DATE_RE.test(b.date || '')) throw new HttpError(400, 'Укажите дату');
  const to = DATE_RE.test(b.to || '') && b.to >= b.date ? b.to : b.date;
  if (b.status && !SCHED_ST[b.status]) throw new HttpError(400, 'Неверный статус');
  const hours = b.hours === '' || b.hours === undefined || b.hours === null ? null : Math.max(0, Math.min(24, num(b.hours)));
  let n = 0;
  tx(() => {
    for (let d = b.date; d <= to && n < 62; d = addDays(d, 1), n++) {
      // сброс к графику по умолчанию
      if (b.reset) { run('DELETE FROM work_schedule WHERE user_id=? AND date=?', uid, d); continue; }
      run(`INSERT INTO work_schedule(user_id,date,status,hours,note,updated_by,updated_at) VALUES(?,?,?,?,?,?,datetime('now','localtime'))
           ON CONFLICT(user_id,date) DO UPDATE SET status=excluded.status, hours=excluded.hours, note=excluded.note, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
        uid, d, b.status || 'work', hours, str(b.note), ctx.user.id);
    }
  });
  return { ok: true, days: n };
});

// ---------- Остатки по кассам: наличные / карта / счёт ----------
const WALLETS = ['cash', 'card', 'transfer'];
const WALLET_NAMES = { cash: 'Наличные', card: 'Карта', transfer: 'Расчётный счёт' };
const r2 = (x) => Math.round((x || 0) * 100) / 100;
// движение по каждой кассе за интервал [from, to] (to включительно, полная дата-время)
function walletFlow(from, to) {
  const res = {};
  for (const w of WALLETS) res[w] = { inc: 0, exp: 0, t_in: 0, t_out: 0, fee: 0, adj: 0 };
  for (const x of all('SELECT direction, COALESCE(method,\'cash\') m, SUM(amount) s FROM payments WHERE created_at>=? AND created_at<=? GROUP BY direction, m', from, to)) {
    const w = res[x.m === 'terminal' ? 'transfer' : x.m] || res.cash; if (x.direction === 'in') w.inc += x.s; else w.exp += x.s; // терминал → расчётный счёт
  }
  for (const x of all('SELECT kind, from_method, to_method, SUM(amount) s, SUM(fee) f FROM money_moves WHERE created_at>=? AND created_at<=? GROUP BY kind, from_method, to_method', from, to)) {
    if (x.kind === 'adjust') { if (res[x.to_method]) res[x.to_method].adj += x.s; continue; }
    if (res[x.from_method]) { res[x.from_method].t_out += x.s + (x.f || 0); res[x.from_method].fee += x.f || 0; }
    if (res[x.to_method]) res[x.to_method].t_in += x.s;
  }
  return res;
}
const net = (f) => f.inc - f.exp + f.t_in - f.t_out + f.adj;
function walletBalances(from, to) {
  const before = walletFlow('0000-01-01', from), during = walletFlow(from, to);
  return WALLETS.map((w) => {
    const open = r2(net(before[w])); const d = during[w];
    return { method: w, name: WALLET_NAMES[w], open, inc: r2(d.inc), exp: r2(d.exp), t_in: r2(d.t_in), t_out: r2(d.t_out), fee: r2(d.fee), adj: r2(d.adj), close: r2(open + net(d)) };
  });
}
function walletNow() { const b = walletFlow('0000-01-01', '9999-12-31'); return Object.fromEntries(WALLETS.map((w) => [w, r2(net(b[w]))])); }

r.get('/api/money/balances', OFFICE, (ctx) => {
  const [from, to] = period(ctx.query);
  let bankNew = 0; try { bankNew = get("SELECT COUNT(*) n FROM bank_tx WHERE status='new'").n; } catch {}
  return { bank_new: bankNew, now: walletNow(), period: walletBalances(from, to),
    moves: all(`SELECT m.*, u.name user FROM money_moves m LEFT JOIN users u ON u.id=m.user_id WHERE m.created_at>=? AND m.created_at<=? ORDER BY m.id DESC LIMIT 500`, from, to) };
});
// Обналичивание / перемещение: несколько источников в одну кассу за одну операцию
r.post('/api/money/transfer', OFFICE, (ctx) => {
  const b = ctx.body; const to = b.to_method;
  if (!WALLETS.includes(to)) throw new HttpError(400, 'Укажите, куда поступили деньги');
  const parts = (Array.isArray(b.parts) ? b.parts : []).map((p) => ({ from: p.from_method, amount: r2(num(p.amount)), fee: r2(num(p.fee)) }))
    .filter((p) => p.amount > 0 || p.fee > 0);
  if (!parts.length) throw new HttpError(400, 'Укажите сумму хотя бы по одному источнику');
  for (const p of parts) {
    if (!WALLETS.includes(p.from) || p.from === to) throw new HttpError(400, 'Источник должен отличаться от кассы назначения');
    if (p.amount < 0 || p.fee < 0) throw new HttpError(400, 'Суммы не могут быть отрицательными');
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date + ' ' + nowLocal().slice(11, 16) + ':00' : null;
  const grp = require('node:crypto').randomBytes(4).toString('hex');
  tx(() => { for (const p of parts) run(`INSERT INTO money_moves(kind,from_method,to_method,amount,fee,grp,note,user_id,created_at) VALUES('transfer',?,?,?,?,?,?,?,COALESCE(?,datetime('now','localtime')))`,
    p.from, to, p.amount, p.fee, grp, str(b.note), ctx.user.id, date); });
  return { ok: true, now: walletNow() };
});
// Сверка: фактический остаток → корректировка на разницу
r.post('/api/money/reconcile', ADMIN, (ctx) => {
  const now = walletNow(); const made = [];
  tx(() => {
    for (const w of WALLETS) {
      const v = ctx.body[w]; if (v === '' || v === null || v === undefined) continue;
      const diff = r2(num(v) - now[w]); if (!diff) continue;
      run(`INSERT INTO money_moves(kind,to_method,amount,note,user_id) VALUES('adjust',?,?,?,?)`, w, diff, str(ctx.body.note) || (Object.values(now).every((x) => !x) ? 'Ввод начальных остатков' : 'Корректировка по сверке'), ctx.user.id);
      made.push({ method: w, diff });
    }
  });
  return { ok: true, made, now: walletNow() };
});
r.delete('/api/money/moves/:id', ADMIN, (ctx) => {
  const m = get('SELECT * FROM money_moves WHERE id=?', +ctx.params.id);
  if (!m) throw new HttpError(404, 'Операция не найдена');
  if (m.grp) run('DELETE FROM money_moves WHERE grp=?', m.grp); else run('DELETE FROM money_moves WHERE id=?', m.id);
  return { ok: true };
});

// ---------- Руководители: нормочас и распределение остатка ----------
const MONTH_RE = /^\d{4}-\d{2}$/;
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
function monthDays(month) { const last = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate(); const out = []; for (let d = 1; d <= last; d++) out.push(`${month}-${String(d).padStart(2, '0')}`); return out; }
// часы руководителя за месяц: правки из графика или норма в рабочие дни студии
function seniorsHours(month) {
  const days = monthDays(month);
  const users = all("SELECT id,name,default_hours FROM users WHERE role='manager' AND is_master=1 AND active=1 AND COALESCE(deleted,0)=0 ORDER BY name");
  const ex = {}; for (const e of all('SELECT * FROM work_schedule WHERE date>=? AND date<=?', days[0], days[days.length - 1])) ex[e.user_id + '|' + e.date] = e;
  return users.map((u) => {
    let h = 0, dn = 0;
    for (const d of days) {
      const e = ex[u.id + '|' + d];
      const hh = e ? (e.status === 'work' ? (e.hours ?? u.default_hours ?? 0) : 0) : (isDayOff(d) ? 0 : (u.default_hours || 0));
      if (hh > 0) { h += hh; dn++; }
    }
    return { id: u.id, name: u.name, default_hours: u.default_hours, hours: r2(h), days: dn };
  });
}
function mgmtExpenses(month) {
  let rows = all('SELECT id,name,amount FROM mgmt_expenses WHERE month=? ORDER BY sort, id', month);
  if (!rows.length) {
    // новый месяц: берём строки прошлого месяца, иначе стандартный набор
    const prev = get('SELECT month FROM mgmt_expenses WHERE month<? ORDER BY month DESC LIMIT 1', month);
    const tpl = prev ? all('SELECT name,amount FROM mgmt_expenses WHERE month=? ORDER BY sort, id', prev.month) : [{ name: 'Аренда', amount: 0 }, { name: 'Кредит', amount: 0 }, { name: 'Налог', amount: 0 }];
    tx(() => tpl.forEach((t, i) => run('INSERT INTO mgmt_expenses(month,name,amount,sort) VALUES(?,?,?,?)', month, t.name, t.amount, i)));
    rows = all('SELECT id,name,amount FROM mgmt_expenses WHERE month=? ORDER BY sort, id', month);
  }
  return rows;
}
function mgmtPlan(month) {
  const balances = walletNow();
  const balance = r2(Object.values(balances).reduce((a, b) => a + b, 0));
  const people = seniorsHours(month);
  const hours = r2(people.reduce((a, p) => a + p.hours, 0));
  const expenses = mgmtExpenses(month);
  const expTotal = r2(expenses.reduce((a, e) => a + (+e.amount || 0), 0));
  const rate = hours > 0 ? balance / hours : 0;
  const share = people.length ? expTotal / people.length : 0;
  // округляем до рубля так, чтобы суммы сходились точно (метод наибольшего остатка)
  const split = (total, weights) => { const W = weights.reduce((a, b) => a + b, 0); if (!W) return weights.map(() => 0);
    const raw = weights.map((w) => (total * w) / W); const fl = raw.map(Math.floor); let rest = Math.round(total) - fl.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { fl[i]++; rest--; } }); return fl; };
  const grossL = split(Math.max(0, Math.round(balance)), people.map((p) => p.hours));
  const shareL = split(Math.round(expTotal), people.map(() => 1));
  const rows = people.map((p, i) => { const gross = hours > 0 ? grossL[i] : 0; const netv = gross - shareL[i]; return { ...p, gross, share: shareL[i], net: netv, pay: Math.max(0, netv) }; });
  const payouts = all(`SELECT m.*, u.name user, p.id pid FROM mgmt_payouts m LEFT JOIN users u ON u.id=m.user_id LEFT JOIN payments p ON p.id=m.payment_id WHERE m.month=? ORDER BY m.id DESC`, month)
    .map((x) => ({ id: x.id, total: x.total, created_at: x.created_at, user: x.user, cancelled: !x.pid, details: JSON.parse(x.details || '[]') }));
  // справочно: что ещё висит на студии
  const mastersDue = r2(salaryReport(month + '-01', monthDays(month).pop() + ' 23:59:59').filter((u) => u.role === 'master').reduce((a, u) => a + Math.max(0, u.due), 0));
  let cWe = 0; for (const c of all('SELECT id FROM contractors')) { const b = contractorBalance(c.id); if (b.balance < 0) cWe -= b.balance; }
  return { month, balances, balance, hours, rate: r2(rate), expenses, exp_total: expTotal, share: r2(share), rows,
    pay_total: r2(rows.reduce((a, x) => a + x.pay, 0)), payouts, info: { masters_due: mastersDue, contractors_debt: r2(cWe) } };
}
r.get('/api/mgmt', ADMIN, (ctx) => mgmtPlan(MONTH_RE.test(ctx.query.month || '') ? ctx.query.month : today().slice(0, 7)));
// сохранить список обязательных расходов месяца целиком
r.put('/api/mgmt/expenses', ADMIN, (ctx) => {
  const month = ctx.body.month; if (!MONTH_RE.test(month || '')) throw new HttpError(400, 'Укажите месяц');
  const list = (Array.isArray(ctx.body.items) ? ctx.body.items : []).map((x) => ({ name: String(x.name || '').trim().slice(0, 80), amount: Math.max(0, num(x.amount)) })).filter((x) => x.name || x.amount);
  tx(() => { run('DELETE FROM mgmt_expenses WHERE month=?', month); list.forEach((x, i) => run('INSERT INTO mgmt_expenses(month,name,amount,sort) VALUES(?,?,?,?)', month, x.name || 'Расход', x.amount, i)); });
  if (!list.length) run("INSERT INTO mgmt_expenses(month,name,amount,sort) VALUES(?,'—',0,0)", month); // чтобы не подтянулся шаблон
  return mgmtPlan(month);
});
// выплата всем руководителям — одной операцией в кассе
r.post('/api/mgmt/payout', ADMIN, (ctx) => {
  const month = ctx.body.month; if (!MONTH_RE.test(month || '')) throw new HttpError(400, 'Укажите месяц');
  const method = WALLETS.includes(ctx.body.method) ? ctx.body.method : 'cash';
  const plan = mgmtPlan(month);
  if (!plan.hours) throw new HttpError(400, 'Нет отработанных часов за месяц');
  if (plan.pay_total <= 0) throw new HttpError(400, 'Нечего выплачивать: после обязательных расходов доход не положительный');
  if (Math.abs(plan.pay_total - num(ctx.body.expect_total)) > 1) throw new HttpError(409, 'Остаток изменился — обновите страницу и проверьте суммы');
  const details = plan.rows.map((x) => ({ id: x.id, name: x.name, hours: x.hours, gross: x.gross, share: x.share, net: x.net, pay: x.pay }));
  const [y, m] = month.split('-');
  const note = `${MONTHS_RU[+m - 1]} ${y}: ` + details.map((d) => `${d.name} ${d.pay.toLocaleString('ru-RU')} ₽ (${d.hours} ч)`).join(', ') + ` · нормочас ${plan.rate.toLocaleString('ru-RU')} ₽, обяз. расходы ${plan.exp_total.toLocaleString('ru-RU')} ₽`;
  let pid;
  tx(() => {
    pid = Number(run("INSERT INTO payments(direction,method,amount,category,note,user_id) VALUES('out',?,?,'Зарплата руководителей',?,?)", method, plan.pay_total, note, ctx.user.id).lastInsertRowid);
    run('INSERT INTO mgmt_payouts(month,payment_id,total,details,user_id) VALUES(?,?,?,?,?)', month, pid, plan.pay_total, JSON.stringify(details), ctx.user.id);
  });
  return { ok: true, payment_id: pid, total: plan.pay_total };
});

// ---------- Отчёты ----------
r.get('/api/reports/finance', OFFICE, (ctx) => {
  const [from, to] = period(ctx.query);
  const byMethod = all('SELECT direction, method, SUM(amount) s FROM payments WHERE created_at>=? AND created_at<=? GROUP BY direction, method', from, to);
  const byCategory = all("SELECT direction, COALESCE(category,'Прочее') category, SUM(amount) s, COUNT(*) n FROM payments WHERE created_at>=? AND created_at<=? GROUP BY direction, category ORDER BY s DESC", from, to);
  const daily = all(`SELECT substr(created_at,1,10) d, SUM(CASE WHEN direction='in' THEN amount ELSE 0 END) inc, SUM(CASE WHEN direction='out' THEN amount ELSE 0 END) exp
                     FROM payments WHERE created_at>=? AND created_at<=? GROUP BY d ORDER BY d`, from, to);
  // Выручка по выданным заказам (начисление)
  const sales = get(`SELECT COUNT(DISTINCT o.id) orders,
      COALESCE(SUM(CASE WHEN i.kind='service' THEN i.qty*i.price*(1-o.discount_percent/100.0) END),0) services,
      COALESCE(SUM(CASE WHEN i.kind='product' THEN i.qty*i.price*(1-o.discount_percent/100.0) END),0) goods,
      COALESCE(SUM(CASE WHEN i.kind='product' THEN i.qty*i.cost END),0) goods_cost
      FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.status='issued' AND o.issued_at>=? AND o.issued_at<=?`, from, to);
  const topServices = all(`SELECT i.name, SUM(i.qty) n, SUM(i.qty*i.price) s FROM order_items i JOIN orders o ON o.id=i.order_id
                           WHERE o.status='issued' AND o.issued_at>=? AND o.issued_at<=? AND i.kind='service' GROUP BY i.name ORDER BY s DESC LIMIT 10`, from, to);
  const topGoods = all(`SELECT i.name, SUM(i.qty) n, SUM(i.qty*i.price) s, SUM(i.qty*(i.price-i.cost)) margin FROM order_items i JOIN orders o ON o.id=i.order_id
                        WHERE o.status='issued' AND o.issued_at>=? AND o.issued_at<=? AND i.kind='product' GROUP BY i.name ORDER BY s DESC LIMIT 10`, from, to);
  const sources = all(`SELECT COALESCE(c.source,'не указан') source, COUNT(DISTINCT o.id) n FROM orders o JOIN clients c ON c.id=o.client_id
                       WHERE o.status='issued' AND o.issued_at>=? AND o.issued_at<=? GROUP BY source ORDER BY n DESC`, from, to);
  let cWe = 0, cThey = 0;
  for (const c of all('SELECT id FROM contractors')) { const b = contractorBalance(c.id); if (b.balance < 0) cWe -= b.balance; else cThey += b.balance; }
  const contractors = { we_owe: Math.round(cWe * 100) / 100, they_owe: Math.round(cThey * 100) / 100 };
  const stockValue = get('SELECT COALESCE(SUM(stock*cost),0) cost, COALESCE(SUM(stock*price),0) retail FROM products WHERE active=1 AND stock>0');
  return { contractors, from, to: to.slice(0, 10), byMethod, byCategory, daily, sales, topServices, topGoods, sources, stockValue };
});

function salaryReport(from, to, userId) {
  const users = all(`SELECT id,name,role,is_master,salary_percent,goods_percent FROM users WHERE (active=1 OR id IN (SELECT employee_id FROM payments WHERE employee_id IS NOT NULL))${userId ? ' AND id=' + +userId : ''} ORDER BY name`);
  return users.map((u) => {
    const works = all(`SELECT a.id, a.order_id, a.created_at issued_at, a.name, a.base sum, a.percent, a.amount, a.manual, a.note
                       FROM salary_accruals a WHERE a.user_id=? AND a.created_at>=? AND a.created_at<=? ORDER BY a.created_at`, u.id, from, to);
    const goods = get(`SELECT COALESCE(SUM(i.qty*i.price*(1-o.discount_percent/100.0)),0) s FROM order_items i JOIN orders o ON o.id=i.order_id
                       WHERE i.kind='product' AND o.status='issued' AND o.issued_at>=? AND o.issued_at<=? AND o.manager_id=?`, from, to, u.id).s;
    const worksSum = works.reduce((s, w) => s + w.sum, 0);
    const adjustments = all('SELECT a.*, c.name author FROM salary_adjustments a LEFT JOIN users c ON c.id=a.created_by WHERE a.user_id=? AND a.date>=? AND a.date<=? ORDER BY a.date', u.id, from.slice(0, 10), to.slice(0, 10));
    const adjSum = adjustments.reduce((s, a) => s + a.amount, 0);
    const accrued = Math.round((works.reduce((s, w) => s + w.amount, 0) + goods * (u.goods_percent || 0) / 100 + adjSum) * 100) / 100;
    const paid = get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE category='Зарплата' AND employee_id=? AND created_at>=? AND created_at<=?", u.id, from, to).s;
    return { ...u, role: uiRole(u), adjustments, adj_sum: Math.round(adjSum * 100) / 100, works, works_sum: Math.round(worksSum * 100) / 100, goods_sum: Math.round(goods * 100) / 100, accrued, paid, due: Math.round((accrued - paid) * 100) / 100 };
  }).filter((u) => userId || u.accrued || u.paid || u.adjustments.length || u.salary_percent || u.goods_percent || u.works.length);
}
// Ручная правка начисления по работе (сохраняется при пересчётах заказа)
r.put('/api/salary/accruals/:id', ADMIN, (ctx) => {
  const a = get('SELECT * FROM salary_accruals WHERE id=?', +ctx.params.id);
  if (!a) throw new HttpError(404, 'Начисление не найдено');
  if (ctx.body.reset) {
    run('UPDATE salary_accruals SET manual=0, note=NULL WHERE id=?', a.id);
    syncAccruals(a.order_id);
    logOrder(a.order_id, ctx.user, `Начисление «${a.name}» возвращено к расчётному`);
    return { ok: true };
  }
  const amount = num(ctx.body.amount, NaN);
  if (!isFinite(amount) || amount < 0) throw new HttpError(400, 'Укажите сумму');
  run('UPDATE salary_accruals SET amount=?, manual=1, note=? WHERE id=?', Math.round(amount * 100) / 100, str(ctx.body.note), a.id);
  logOrder(a.order_id, ctx.user, `Начисление «${a.name}» изменено: ${a.amount} → ${amount} ₽${ctx.body.note ? ' (' + ctx.body.note + ')' : ''}`);
  return { ok: true };
});
// Премии и удержания (+ / −)
r.post('/api/salary/adjustments', ADMIN, (ctx) => {
  const b = ctx.body; const amount = num(b.amount);
  if (!amount) throw new HttpError(400, 'Укажите сумму');
  if (!get('SELECT 1 FROM users WHERE id=?', +b.user_id)) throw new HttpError(400, 'Сотрудник не найден');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today();
  return { id: Number(run('INSERT INTO salary_adjustments(user_id,date,amount,note,created_by) VALUES(?,?,?,?,?)', +b.user_id, date, amount, need(b.note, 'Укажите причину'), ctx.user.id).lastInsertRowid) };
});
r.delete('/api/salary/adjustments/:id', ADMIN, (ctx) => { run('DELETE FROM salary_adjustments WHERE id=?', +ctx.params.id); return { ok: true }; });

r.get('/api/reports/salary', (ctx) => {
  const [from, to] = period(ctx.query);
  if (!auth.isAdminUser(ctx.user)) return salaryReport(from, to, ctx.user.id); // каждый видит только себя
  return salaryReport(from, to);
});

// ---------- Заявки (лиды) ----------
r.get('/api/leads', OFFICE, (ctx) => {
  const st = ctx.query.status; const p = []; let w = '1=1';
  if (st) { w += ' AND status=?'; p.push(st); }
  return all(`SELECT * FROM leads WHERE ${w} ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'work' THEN 1 ELSE 2 END, id DESC LIMIT 500`, ...p);
});
function createLead(b) {
  const res = run('INSERT INTO leads(name,phone,car,message,source) VALUES(?,?,?,?,?)',
    str(b.name)?.slice(0, 200), str(b.phone)?.slice(0, 50), str(b.car)?.slice(0, 200), str(b.message)?.slice(0, 3000), str(b.source)?.slice(0, 100) || 'сайт');
  const id = Number(res.lastInsertRowid);
  const known = findClientByPhone(b.phone);
  notify.boss('lead_new', `🔥 **Новая заявка #${id}** (${str(b.source) || 'сайт'})\n${b.name || '—'} ${b.phone || ''}${b.car ? '\nАвто: ' + b.car : ''}${b.message ? '\n' + String(b.message).slice(0, 500) : ''}${known ? '\nУже клиент: ' + known.name : ''}`);
  return id;
}
r.post('/api/leads', OFFICE, (ctx) => ({ id: createLead(ctx.body) }));
r.put('/api/leads/:id', OFFICE, (ctx) => {
  const b = ctx.body;
  run('UPDATE leads SET name=?,phone=?,car=?,message=?,source=?,status=?,comment=? WHERE id=?',
    str(b.name), str(b.phone), str(b.car), str(b.message), str(b.source), b.status || 'new', str(b.comment), +ctx.params.id);
  return { ok: true };
});
r.delete('/api/leads/:id', ADMIN, (ctx) => { run('DELETE FROM leads WHERE id=?', +ctx.params.id); return { ok: true }; });

// Публичный приём заявок с сайта
r.post('/api/public/lead', (ctx) => {
  const key = ctx.req.headers['x-api-key'] || ctx.query.key || ctx.body.key;
  if (!key || key !== getSetting('api_key')) throw new HttpError(401, 'Неверный ключ API');
  if (ctx.body.website) return { ok: true }; // honeypot от ботов
  if (!ctx.body.phone && !ctx.body.name) throw new HttpError(400, 'Нужно имя или телефон');
  auth.checkRate('lead:' + (ctx.req.headers['x-real-ip'] || ctx.req.socket.remoteAddress));
  return { ok: true, id: createLead(ctx.body) };
}, { public: true });

// Заявка с собственного сайта (лендинг на этом же сервере) — без API-ключа, с защитой от спама
r.post('/api/public/site-lead', (ctx) => {
  const b = ctx.body;
  if (b.website) return { ok: true }; // honeypot
  const origin = ctx.req.headers.origin; if (origin && new URL(origin).host !== ctx.req.headers.host) throw new HttpError(403, 'Запрос с чужого сайта');
  auth.checkRate('lead:' + (ctx.req.headers['x-real-ip'] || ctx.req.socket.remoteAddress));
  const phone = String(b.phone || '').replace(/[^\d+]/g, '');
  if (phone.replace(/\D/g, '').length < 10) throw new HttpError(400, 'Проверьте номер телефона');
  if (!b.agree) throw new HttpError(400, 'Нужно согласие на обработку данных');
  const svc = (Array.isArray(b.services) ? b.services : []).map((x) => String(x).slice(0, 60)).slice(0, 8);
  const message = [svc.length ? 'Услуги: ' + svc.join(', ') : '', str(b.message)].filter(Boolean).join('\n');
  // метки рекламы (utm) из ссылки, по которой пришёл клиент — для аналитики каналов в «Маркетинге»
  const utm = (k) => String(b[k] || '').replace(/[^\wа-яё .\-]/gi, '').slice(0, 40);
  const us = utm('utm_source'), uc = utm('utm_campaign');
  const msg2 = [message, uc ? 'Кампания: ' + uc : ''].filter(Boolean).join('\n');
  return { ok: true, id: createLead({ name: b.name, phone: b.phone, car: b.car, message: msg2, source: us ? 'Сайт · ' + us : 'Сайт' }) };
}, { public: true });

// ---------- Отзывы для сайта ----------
r.get('/api/site/reviews', ADMIN, () => ({ reviews: all('SELECT * FROM site_reviews ORDER BY sort, date DESC, id DESC'),
  twogis_url: getSetting('twogis_url') || '', twogis_rating: getSetting('twogis_rating') || '', twogis_count: getSetting('twogis_count') || '' }));
r.put('/api/site/reviews-meta', ADMIN, (ctx) => {
  const b = ctx.body;
  if (b.twogis_url !== undefined) { const u = String(b.twogis_url).trim(); if (u && !/^https:\/\/(www\.)?2gis\.(ru|com|kz)\//.test(u)) throw new HttpError(400, 'Ссылка должна вести на 2gis.ru'); setSetting('twogis_url', u); }
  if (b.twogis_rating !== undefined) setSetting('twogis_rating', b.twogis_rating === '' ? '' : String(Math.max(1, Math.min(5, num(b.twogis_rating)))));
  if (b.twogis_count !== undefined) setSetting('twogis_count', b.twogis_count === '' ? '' : String(Math.max(0, Math.round(num(b.twogis_count)))));
  return { ok: true };
});
const reviewVals = (b) => [need(str(b.author), 'Укажите имя автора').slice(0, 80), /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null,
  Math.max(0, Math.min(5, Math.round(num(b.rating, 0)))), need(str(b.text), 'Вставьте текст отзыва').slice(0, 3000), str(b.source) || '2ГИС', b.visible === false || b.visible === 0 || b.visible === '0' ? 0 : 1];
r.post('/api/site/reviews', ADMIN, (ctx) => ({ id: Number(run('INSERT INTO site_reviews(author,date,rating,text,source,visible) VALUES(?,?,?,?,?,?)', ...reviewVals(ctx.body)).lastInsertRowid) }));
r.put('/api/site/reviews/:id', ADMIN, (ctx) => { run('UPDATE site_reviews SET author=?,date=?,rating=?,text=?,source=?,visible=? WHERE id=?', ...reviewVals(ctx.body), +ctx.params.id); return { ok: true }; });
r.delete('/api/site/reviews/:id', ADMIN, (ctx) => { run('DELETE FROM site_reviews WHERE id=?', +ctx.params.id); return { ok: true }; });

// ---------- Настройки ----------
const SETTING_KEYS = ['landing_on', 'acquiring_percent', 'days_off', 'max_token', 'max_group_on', 'digest_time', 'cashless_markup', 'company_name', 'company_subtitle', 'company_address', 'company_phone', 'company_inn', 'company_requisites', 'bays', 'work_start', 'work_end', 'tg_token', 'tg_staff_chat', 'tg_notify_client_done', 'order_terms', 'warranty_terms', 'api_key', 'social_tg', 'social_vk', 'social_max', 'social_avito'];
r.get('/api/settings', ADMIN, () => Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(k)])));
r.put('/api/settings', ADMIN, (ctx) => {
  const prevMax = getSetting('max_token');
  for (const k of SETTING_KEYS) if (ctx.body[k] !== undefined) setSetting(k, ctx.body[k]);
  tg.restart();
  if (ctx.body.max_token !== undefined && ctx.body.max_token !== prevMax) max.restart();
  return { ok: true };
});
r.post('/api/settings/regen-key', ADMIN, () => {
  const k = require('node:crypto').randomBytes(16).toString('hex');
  setSetting('api_key', k);
  return { api_key: k };
});
r.post('/api/telegram/test', ADMIN, async () => {
  const res = await tg.staff('🔊 Тестовое сообщение из CRM ' + getSetting('company_name'));
  if (!res || !res.ok) throw new HttpError(400, 'Не удалось отправить: ' + (res?.description || 'проверьте токен и ID чата'));
  return { ok: true };
});

// ---------- Контрагенты и взаиморасчёты ----------
// Сальдо > 0 — контрагент должен нам; < 0 — мы должны контрагенту.
const CKINDS = { supplier: 'Поставщик', partner: 'Партнёр', contractor: 'Подрядчик', client: 'Клиент-юрлицо', other: 'Прочее' };
function contractorBalance(id) {
  const ops = get(`SELECT COALESCE(SUM(CASE WHEN kind='they_owe' THEN amount ELSE 0 END),0) they,
                          COALESCE(SUM(CASE WHEN kind='we_owe' THEN amount ELSE 0 END),0) we FROM contractor_ops WHERE contractor_id=?`, id);
  const pay = get(`SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) pin,
                          COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) pout
                   FROM payments WHERE contractor_id=? AND order_id IS NULL`, id);
  const ord = get(`SELECT COALESCE(SUM(total-paid),0) due, COUNT(*) n FROM (SELECT ${totalSql('o')} total,
                     (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM payments p WHERE p.order_id=o.id) paid
                   FROM orders o WHERE o.contractor_id=? AND o.status IN ('done','issued'))`, id);
  const they = ops.they - pay.pin + ord.due;   // нам должны
  const we = ops.we - pay.pout;                 // мы должны
  return { they_owe: Math.round(they * 100) / 100, we_owe: Math.round(we * 100) / 100, balance: Math.round((they - we) * 100) / 100, orders_due: ord.due };
}
r.get('/api/contractors', OFFICE, (ctx) => {
  const q = (ctx.query.q || '').trim();
  const rows = all(`SELECT * FROM contractors WHERE ${ctx.query.all ? '1=1' : 'active=1'} ${q ? 'AND (ulower(name) LIKE ? OR inn LIKE ? OR phone LIKE ?)' : ''} ORDER BY name`,
    ...(q ? [`%${lc(q)}%`, `%${q}%`, `%${q}%`] : []));
  return rows.map((c) => ({ ...c, ...contractorBalance(c.id) }));
});
r.get('/api/contractors/:id', OFFICE, (ctx) => {
  const c = get('SELECT * FROM contractors WHERE id=?', +ctx.params.id);
  if (!c) throw new HttpError(404, 'Контрагент не найден');
  Object.assign(c, contractorBalance(c.id));
  c.ledger = contractorLedger(c.id);
  c.orders = all(`SELECT o.id,o.status,o.issued_at,o.created_at,cl.name client,ca.brand,ca.model,ca.plate, ${totalSql('o')} total,
                  (SELECT COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE -amount END),0) FROM payments p WHERE p.order_id=o.id) paid
                  FROM orders o LEFT JOIN clients cl ON cl.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id WHERE o.contractor_id=? ORDER BY o.id DESC LIMIT 200`, c.id);
  return c;
});
function contractorLedger(id, from, to) {
  const f = from || '0000', t = (to || '9999') + ' 23:59:59';
  const rows = [
    ...all(`SELECT 'op' src, id, COALESCE(date, substr(created_at,1,10)) d, kind, amount, note FROM contractor_ops WHERE contractor_id=? AND COALESCE(date, substr(created_at,1,10)) BETWEEN ? AND ?`, id, f, t)
      .map((x) => ({ ...x, they: x.kind === 'they_owe' ? x.amount : 0, we: x.kind === 'we_owe' ? x.amount : 0, text: x.kind === 'they_owe' ? 'Начислено контрагенту' : 'Получено от контрагента (товар/услуги)' })),
    ...all(`SELECT 'pay' src, id, substr(created_at,1,10) d, direction, amount, method, note, category FROM payments WHERE contractor_id=? AND order_id IS NULL AND created_at BETWEEN ? AND ?`, id, f, t)
      .map((x) => ({ ...x, they: x.direction === 'in' ? -x.amount : 0, we: x.direction === 'out' ? -x.amount : 0, text: x.direction === 'in' ? 'Оплата от контрагента' : 'Оплата контрагенту' })),
    ...all(`SELECT 'order' src, o.id, substr(o.issued_at,1,10) d, ${totalSql('o')} amount FROM orders o WHERE o.contractor_id=? AND o.status='issued' AND o.issued_at BETWEEN ? AND ?`, id, f, t)
      .map((x) => ({ ...x, they: x.amount, we: 0, text: 'Заказ-наряд ' + orderNo(x.id) })),
    ...all(`SELECT 'opay' src, p.id, substr(p.created_at,1,10) d, p.direction, p.amount, p.order_id FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.contractor_id=? AND o.status='issued' AND p.created_at BETWEEN ? AND ?`, id, f, t)
      .map((x) => ({ ...x, they: x.direction === 'in' ? -x.amount : x.amount, we: 0, text: (x.direction === 'in' ? 'Оплата по заказу ' : 'Возврат по заказу ') + orderNo(x.order_id) })),
  ];
  return rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
function saveContractor(b, id) {
  const kind = CKINDS[b.kind] ? b.kind : 'supplier';
  if (id) {
    run('UPDATE contractors SET name=?,kind=?,phone=?,contact=?,inn=?,requisites=?,notes=?,active=? WHERE id=?',
      need(b.name, 'Укажите название'), kind, str(b.phone), str(b.contact), str(b.inn), str(b.requisites), str(b.notes), b.active === false || b.active === 0 ? 0 : 1, id);
    return id;
  }
  return Number(run('INSERT INTO contractors(name,kind,phone,contact,inn,requisites,notes) VALUES(?,?,?,?,?,?,?)',
    need(b.name, 'Укажите название'), kind, str(b.phone), str(b.contact), str(b.inn), str(b.requisites), str(b.notes)).lastInsertRowid);
}
r.post('/api/contractors', OFFICE, (ctx) => ({ id: saveContractor(ctx.body) }));
r.put('/api/contractors/:id', OFFICE, (ctx) => ({ id: saveContractor(ctx.body, +ctx.params.id) }));
r.delete('/api/contractors/:id', ADMIN, (ctx) => {
  const id = +ctx.params.id;
  if (get('SELECT 1 FROM contractor_ops WHERE contractor_id=? UNION SELECT 1 FROM payments WHERE contractor_id=? UNION SELECT 1 FROM orders WHERE contractor_id=?', id, id, id))
    throw new HttpError(400, 'По контрагенту есть операции — отключите его вместо удаления');
  run('DELETE FROM contractors WHERE id=?', id);
  return { ok: true };
});
// Операция взаиморасчётов: начисление долга или оплата (оплата проходит через кассу)
r.post('/api/contractors/:id/op', OFFICE, (ctx) => {
  const id = +ctx.params.id; const b = ctx.body; const amount = num(b.amount);
  if (amount <= 0) throw new HttpError(400, 'Сумма должна быть больше нуля');
  if (!get('SELECT 1 FROM contractors WHERE id=?', id)) throw new HttpError(404, 'Контрагент не найден');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today();
  if (b.type === 'we_owe' || b.type === 'they_owe') {
    run('INSERT INTO contractor_ops(contractor_id,kind,amount,note,date,user_id) VALUES(?,?,?,?,?,?)', id, b.type, amount, str(b.note), date, ctx.user.id);
  } else if (b.type === 'pay_in' || b.type === 'pay_out') {
    const pr = run(`INSERT INTO payments(direction,method,amount,category,note,contractor_id,user_id,created_at) VALUES(?,?,?,?,?,?,?,?)`,
      b.type === 'pay_in' ? 'in' : 'out', b.method || 'transfer', amount, b.type === 'pay_in' ? 'Оплата от контрагента' : 'Оплата контрагенту', str(b.note), id, ctx.user.id, date + ' 12:00:00');
    addAcquiring(Number(pr.lastInsertRowid));
  } else throw new HttpError(400, 'Неизвестная операция');
  return { ok: true, ...contractorBalance(id) };
});
r.delete('/api/contractor-ops/:id', ADMIN, (ctx) => { run('DELETE FROM contractor_ops WHERE id=?', +ctx.params.id); return { ok: true }; });
r.get('/api/contractors/:id/sverka', OFFICE, (ctx) => contractorLedger(+ctx.params.id, ctx.query.from, ctx.query.to));

// ---------- Обновление CRM и домен (без консоли) ----------
// CRM пишет файл-заявку, systemd (boomcrm-update.path) от root запускает установщик.
const fsx = require('node:fs'); const pathx = require('node:path');
const { DATA_DIR: DDIR } = require('./db');
const REQ_FILE = pathx.join(DDIR, 'update.request');
const LOG_FILE = pathx.join(DDIR, 'update.log');
const CONF_FILE = pathx.join(DDIR, 'domain.conf');
const VERSION = require('../package.json').version;

function readConf() {
  try { const [domain = '', email = ''] = fsx.readFileSync(CONF_FILE, 'utf8').split('\n'); return { domain: domain.trim(), email: email.trim() }; }
  catch { return { domain: '', email: '' }; }
}
r.get('/api/admin/update', ADMIN, () => {
  let log = '';
  try { log = fsx.readFileSync(LOG_FILE, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').slice(-6000); } catch {}
  return { version: VERSION, pending: fsx.existsSync(REQ_FILE), log, updater: fsx.existsSync('/etc/systemd/system/boomcrm-update.path'), ...readConf() };
});
r.post('/api/admin/update', ADMIN, async (ctx) => {
  let { domain, email } = { ...readConf(), ...ctx.body };
  domain = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  email = String(email || '').trim();
  if (domain && !/^[a-z0-9а-яё-]+(\.[a-z0-9а-яё-]+)+$/i.test(domain)) throw new HttpError(400, 'Неверное имя домена');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Неверный email');
  if (/[а-яё]/i.test(domain)) domain = require('node:url').domainToASCII(domain);
  if (domain && ctx.body.domain !== undefined) {
    // проверим, что домен уже смотрит на этот сервер — иначе сертификат не выдадут
    const dns = require('node:dns').promises;
    let ips = [];
    try { ips = (await dns.resolve4(domain)); } catch { throw new HttpError(400, `Домен ${domain} пока не найден в DNS. Создайте A-запись на IP сервера и подождите 10–30 минут.`); }
    const local = Object.values(require('node:os').networkInterfaces()).flat().map((i) => i.address);
    const myIp = ctx.body.server_ip || (ctx.req.headers.host || '').split(':')[0];
    if (!ips.some((ip) => local.includes(ip) || ip === myIp)) {
      throw new HttpError(400, `Домен ${domain} указывает на ${ips.join(', ')}, а не на этот сервер. Исправьте A-запись и подождите 10–30 минут.`);
    }
  }
  if (!fsx.existsSync('/etc/systemd/system/boomcrm-update.path')) throw new HttpError(400, 'Автообновление ещё не установлено: один раз запустите команду установки из консоли сервера.');
  fsx.writeFileSync(REQ_FILE, `${domain}\n${email}\n`);
  return { ok: true };
});

// Резервная копия БД
r.get('/api/backup', ADMIN, (ctx) => {
  const path = require('node:path'); const fs = require('node:fs'); const { DATA_DIR } = require('./db');
  const f = path.join(DATA_DIR, 'download-backup.sqlite');
  try { fs.unlinkSync(f); } catch {}
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  const buf = fs.readFileSync(f); fs.unlinkSync(f);
  ctx.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="boomcrm-${today()}.sqlite"` });
  ctx.res.end(buf);
  return undefined;
});

// Экспорт клиентов в CSV (открывается в Excel)
r.get('/api/export/clients.csv', OFFICE, (ctx) => {
  const rows = all(`SELECT c.id,c.name,c.phone,c.email,c.source,c.discount,c.created_at,
                    (SELECT GROUP_CONCAT(COALESCE(brand,'')||' '||COALESCE(model,'')||' '||COALESCE(plate,''), '; ') FROM cars WHERE client_id=c.id) cars
                    FROM clients c ORDER BY c.id`);
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = '﻿' + ['ID;Имя;Телефон;Email;Источник;Скидка;Создан;Автомобили', ...rows.map((x) => [x.id, x.name, x.phone, x.email, x.source, x.discount, x.created_at, x.cars].map(esc).join(';'))].join('\r\n');
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="clients.csv"' });
  ctx.res.end(csv);
  return undefined;
});

function notifyNewAppointment(id, { changed, prevMaster } = {}) {
  try {
    const o = loadOrder(id);
    if (!o.scheduled_at) return;
    const when = o.scheduled_at.slice(0, 10).split('-').reverse().join('.') + ' ' + o.scheduled_at.slice(11, 16) + (o.end_date ? ' — до ' + o.end_date.split('-').reverse().slice(0, 2).join('.') : '');
    const carS = [o.brand, o.model, o.plate].filter(Boolean).join(' ');
    notify.boss('order_new', `📅 **${changed ? 'Перенос записи' : 'Новая запись'} ${o.number}**: ${when}${o.bay ? ', ' + o.bay : ''}\n${carS}\n${o.client_name || ''} ${o.client_phone || ''}${o.master_name ? '\nМастер: ' + o.master_name : ''}`, { orderId: id });
    if (o.master_id) {
      const works = o.items.filter((i) => i.kind === 'service').map((i) => '• ' + i.name).join('\n');
      const isNew = !changed || prevMaster !== o.master_id;
      notify.toUser(o.master_id, isNew ? 'my_assigned' : 'my_changed',
        `${isNew ? '🔔 **Вам назначен заказ' : '🔁 **Перенос записи'} ${o.number}**\n🕒 ${when}${o.bay ? ' · ' + o.bay : ''}\n🚗 ${carS}${o.complaint ? '\n📝 ' + o.complaint : ''}${works ? '\n' + works : ''}`,
        { orderId: id, buttons: notify.statusButtons(id) });
    }
    if (changed && prevMaster && prevMaster !== o.master_id) notify.toUser(prevMaster, 'my_changed', `↪️ Заказ **${o.number}** (${carS}) передан другому мастеру`, { orderId: id });
  } catch (e) { console.error('notify', e.message); }
}

// ---------- Переписка с сотрудниками (MAX / Telegram) ----------
// входящее сообщение от сотрудника боту
function onStaffMessage(user, text, orderId, channel = 'max') {
  run('INSERT INTO staff_messages(user_id,direction,text,order_id,channel) VALUES(?,?,?,?,?)', user.id, 'in', text.slice(0, 4000), orderId || null, channel);
  if (orderId) logOrder(orderId, user, `💬 ${text.slice(0, 1000)}`);
  const ord = orderId ? get('SELECT id FROM orders WHERE id=?', orderId) : null;
  notify.boss('staff_msg', `💬 **${user.name}**${ord ? ` по заказу ${orderNo(orderId)}` : ''}:\n${text.slice(0, 3000)}`, { exclude: user.id, orderId });
}
// кнопки в уведомлениях мастеру
async function onCallback(user, payload) {
  if (String(payload).startsWith('wr:')) return (await warranty.onCallback(user, payload)) || 'Неизвестная команда';
  const m = /^st:(\d+):(in_work|waiting|done)$/.exec(payload);
  if (!m) return 'Неизвестная команда';
  const r = changeStatus(+m[1], m[2], user);
  return r.same ? `Статус уже «${STATUS_RU[m[2]]}»` : `${orderNo(+m[1])}: ${STATUS_RU[m[2]]}`;
}
async function sendToStaff(author, userId, text, orderId) {
  const u = get('SELECT * FROM users WHERE id=? AND COALESCE(deleted,0)=0', userId);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  if (!u.max_user_id && !u.max_chat_id && !u.tg_chat_id) throw new HttpError(400, `${u.name} ещё не подключил MAX или Telegram`);
  const o = orderId ? loadOrder(orderId) : null;
  const head = `✉️ **${author.name}**${o ? ` · ${o.number} (${[o.brand, o.model].filter(Boolean).join(' ')})` : ''}:\n`;
  const used = await notify.deliver(u, head + text + (o ? '\n\n_Ответьте на это сообщение — ответ попадёт в заказ._' : ''), { orderId: orderId || null, buttons: o ? notify.statusButtons(o.id) : undefined });
  if (!used.length) throw new HttpError(400, 'Не удалось отправить: проверьте подключение бота в Настройках');
  run('INSERT INTO staff_messages(user_id,direction,text,order_id,author_id,channel,is_read) VALUES(?,?,?,?,?,?,1)', u.id, 'out', text, orderId || null, author.id, used.join(','));
  if (orderId) logOrder(orderId, author, `✉️ → ${u.name}: ${text.slice(0, 500)}`);
  return { ok: true, channels: used };
}
r.post('/api/orders/:id/message', OFFICE, async (ctx) => {
  const o = get('SELECT master_id FROM orders WHERE id=?', +ctx.params.id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  return sendToStaff(ctx.user, +(ctx.body.user_id || o.master_id), need(ctx.body.text, 'Пустое сообщение'), +ctx.params.id);
});
r.get('/api/messages', OFFICE, () => all(`SELECT u.id, u.name, u.role, u.is_master, (u.max_user_id IS NOT NULL OR u.max_chat_id IS NOT NULL) max, (u.tg_chat_id IS NOT NULL) tg,
    (SELECT COUNT(*) FROM staff_messages m WHERE m.user_id=u.id AND m.direction='in' AND m.is_read=0) unread,
    (SELECT text FROM staff_messages m WHERE m.user_id=u.id ORDER BY id DESC LIMIT 1) last_text,
    (SELECT created_at FROM staff_messages m WHERE m.user_id=u.id ORDER BY id DESC LIMIT 1) last_at
  FROM users u WHERE u.active=1 AND COALESCE(u.deleted,0)=0 ORDER BY last_at IS NULL, last_at DESC, u.name`));
r.get('/api/messages/unread', OFFICE, () => get("SELECT COUNT(*) n FROM staff_messages WHERE direction='in' AND is_read=0"));
r.get('/api/messages/:userId', OFFICE, (ctx) => {
  const uid = +ctx.params.userId;
  run("UPDATE staff_messages SET is_read=1 WHERE user_id=? AND direction='in'", uid);
  return all(`SELECT m.*, a.name author FROM staff_messages m LEFT JOIN users a ON a.id=m.author_id WHERE m.user_id=? ORDER BY m.id DESC LIMIT 300`, uid).reverse();
});
r.post('/api/messages/:userId', OFFICE, (ctx) => sendToStaff(ctx.user, +ctx.params.userId, need(ctx.body.text, 'Пустое сообщение'), ctx.body.order_id ? +ctx.body.order_id : null));
r.post('/api/messages-broadcast', OFFICE, async (ctx) => {
  const ids = Array.isArray(ctx.body.user_ids) ? ctx.body.user_ids.map(Number) : [];
  const text = need(ctx.body.text, 'Пустое сообщение');
  const res = [];
  for (const id of ids) { try { await sendToStaff(ctx.user, id, text, null); res.push({ id, ok: true }); } catch (e) { res.push({ id, ok: false, error: e.message }); } }
  return res;
});

// ---------- Настройки MAX и привязка ----------
r.get('/api/max/status', ADMIN, async () => {
  const st = max.state();
  if (getSetting('max_token') && !st.bot) { await max.me(); }
  const s2 = max.state();
  return { ok: s2.ok, error: s2.error, bot: s2.bot ? { name: s2.bot.first_name || s2.bot.name, username: s2.bot.username } : null, base: s2.base,
    group: getSetting('max_group_chat_id'), group_on: getSetting('max_group_on') !== '0', digest_time: getSetting('digest_time', '19:00') };
});
r.post('/api/max/test', ADMIN, async (ctx) => {
  const u = get('SELECT * FROM users WHERE id=?', ctx.user.id);
  if (!u.max_user_id && !u.max_chat_id) throw new HttpError(400, 'Сначала подключите свой MAX: Сотрудники → ваша карточка → «Подключить MAX»');
  const used = await notify.deliver(u, `🔊 Проверка связи: CRM «${getSetting('company_name')}» отправляет уведомления в MAX.`);
  if (!used.includes('max')) throw new HttpError(400, 'MAX не принял сообщение: ' + (max.state().error || 'проверьте токен'));
  return { ok: true };
});
r.post('/api/max/digest-now', ADMIN, () => { notify.dailyTick(true); return { ok: true }; });
// код и ссылка для привязки сотрудника к боту
r.post('/api/users/:id/max-link', ADMIN, (ctx) => {
  const id = +ctx.params.id;
  const u = get('SELECT id FROM users WHERE id=? AND COALESCE(deleted,0)=0', id);
  if (!u) throw new HttpError(404, 'Сотрудник не найден');
  let code; do { code = String(require('node:crypto').randomInt(100000, 999999)); } while (get('SELECT 1 FROM users WHERE link_code=?', code));
  run('UPDATE users SET link_code=? WHERE id=?', code, id);
  return { code, link: max.botLink(code), bot: max.state().bot?.username || null };
});
r.post('/api/me/max-link', (ctx) => {
  let code; do { code = String(require('node:crypto').randomInt(100000, 999999)); } while (get('SELECT 1 FROM users WHERE link_code=?', code));
  run('UPDATE users SET link_code=? WHERE id=?', code, ctx.user.id);
  return { code, link: max.botLink(code), bot: max.state().bot?.username || null };
});
r.delete('/api/users/:id/max-link', ADMIN, (ctx) => { run('UPDATE users SET max_user_id=NULL, max_chat_id=NULL, link_code=NULL WHERE id=?', +ctx.params.id); return { ok: true }; });
r.get('/api/notify/events', () => notify.EVENTS);
r.get('/api/users/:id/notify', ADMIN, (ctx) => { const u = get('SELECT * FROM users WHERE id=?', +ctx.params.id); return { subs: notify.subs(u), defaults: notify.defaultsFor(u) }; });
r.put('/api/users/:id/notify', ADMIN, (ctx) => {
  const list = Array.isArray(ctx.body.subs) ? ctx.body.subs.filter((k) => notify.EVENTS[k]) : null;
  run('UPDATE users SET notify=? WHERE id=?', list ? JSON.stringify(list) : null, +ctx.params.id);
  return { ok: true };
});

warranty.register(r, OFFICE, ADMIN);
const bank = require('./bank'); bank.migrate(); bank.register(r, OFFICE, ADMIN);
// Онлайн-касса Saby: оплата, проведённая на кассе, записывается в заказ автоматически
const marketing = require('./marketing'); marketing.migrate(); marketing.register(r, OFFICE, ADMIN);
const saby = require('./saby'); saby.migrate();
saby.register(r, OFFICE, ADMIN, {
  loadOrder,
  recordPayment(orderId, amount, method, userId, note) {
    const pr = run('INSERT INTO payments(order_id,direction,method,amount,category,note,user_id) VALUES(?,?,?,?,?,?,?)', orderId, 'in', method, amount, 'Оплата заказа', note, userId);
    const pid = Number(pr.lastInsertRowid); const fee = addAcquiring(pid);
    logOrder(orderId, userId ? { id: userId } : null, `Оплата на кассе Saby: ${amount} ₽ (${method === 'cash' ? 'наличные' : 'терминал'})${fee ? ` · эквайринг ${fee} ₽ (расход)` : ''}`);
    return [pid];
  },
});

module.exports = { router: r, loadOrder, orderNo, STATUS_RU, contractorLedger, contractorBalance, botHandlers: { message: onStaffMessage, callback: onCallback } };
