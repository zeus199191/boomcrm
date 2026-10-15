'use strict';
const { db, all, get, run, tx, getSetting, setSetting, normPhone } = require('./db');
const { createRouter, HttpError } = require('./http');
const auth = require('./auth');
const tg = require('./telegram');

const r = createRouter();
const STATUSES = ['new', 'scheduled', 'in_work', 'waiting', 'done', 'issued', 'cancelled'];
const STATUS_RU = { new: 'Новый', scheduled: 'Записан', in_work: 'В работе', waiting: 'Ждёт запчасти', done: 'Готов', issued: 'Выдан', cancelled: 'Отменён' };

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
  ctx.res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`);
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
  statuses: STATUS_RU,
  accept_lists: (({ KIT, WORKS, FUEL }) => ({ kit: KIT, works: WORKS, fuel: FUEL }))(require('./print')),
  cashless_markup: +getSetting('cashless_markup', '0') || 0,
  contractor_kinds: { supplier: 'Поставщик', partner: 'Партнёр', contractor: 'Подрядчик', client: 'Клиент-юрлицо', other: 'Прочее' },
  version: require('../package.json').version,
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
r.get('/api/staff', () => all("SELECT id,name,role,is_master FROM users WHERE active=1 ORDER BY role='master' DESC, is_master DESC, name")
  .map((u) => ({ ...u, role: uiRole(u), can_work: u.role === 'master' || u.is_master ? 1 : 0 })));

r.get('/api/users', ADMIN, () => all('SELECT id,login,name,role,is_master,phone,salary_percent,goods_percent,tg_chat_id,active,created_at FROM users ORDER BY active DESC, name').map((u) => ({ ...u, role: uiRole(u) })));
r.post('/api/users', ADMIN, (ctx) => {
  const b = ctx.body;
  const login = String(need(b.login, 'Укажите логин')).trim().toLowerCase();
  if (get('SELECT 1 FROM users WHERE login=?', login)) throw new HttpError(400, 'Такой логин уже есть');
  if (String(b.password || '').length < 6) throw new HttpError(400, 'Пароль не короче 6 символов');
  const [role, isMaster] = dbRole(b.role);
  const res = run('INSERT INTO users(login,name,role,is_master,pass_hash,phone,salary_percent,goods_percent,tg_chat_id) VALUES(?,?,?,?,?,?,?,?,?)',
    login, need(b.name, 'Укажите имя'), role, isMaster, auth.hashPassword(b.password), str(b.phone), num(b.salary_percent), num(b.goods_percent), str(b.tg_chat_id));
  return { id: Number(res.lastInsertRowid) };
});
r.put('/api/users/:id', ADMIN, (ctx) => {
  const b = ctx.body; const id = +ctx.params.id;
  if (id === ctx.user.id && (b.active === 0 || b.active === false || b.role !== 'admin')) throw new HttpError(400, 'Нельзя отключить или понизить самого себя');
  const [role, isMaster] = dbRole(b.role);
  run('UPDATE users SET name=?,role=?,is_master=?,phone=?,salary_percent=?,goods_percent=?,tg_chat_id=?,active=? WHERE id=?',
    need(b.name, 'Укажите имя'), role, isMaster, str(b.phone), num(b.salary_percent), num(b.goods_percent), str(b.tg_chat_id), b.active ? 1 : 0, id);
  if (b.password) {
    if (String(b.password).length < 6) throw new HttpError(400, 'Пароль не короче 6 символов');
    run('UPDATE users SET pass_hash=? WHERE id=?', auth.hashPassword(b.password), id);
    run('DELETE FROM sessions WHERE user_id=?', id);
  }
  if (!b.active) run('DELETE FROM sessions WHERE user_id=?', id);
  return { ok: true };
});

// ---------- Дашборд ----------
r.get('/api/dashboard', (ctx) => {
  const t = today();
  const isMaster = ctx.user.role === 'master';
  const mf = isMaster ? ' AND o.master_id=' + ctx.user.id : '';
  const out = {
    today: all(`SELECT o.id,o.status,o.scheduled_at,o.end_date,o.complaint,o.bay,o.duration_min,c.name client,c.phone,ca.brand,ca.model,ca.plate,u.name master
                FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id LEFT JOIN users u ON u.id=o.master_id
                WHERE substr(o.scheduled_at,1,10)<=? AND COALESCE(o.end_date,substr(o.scheduled_at,1,10))>=? AND o.status NOT IN ('cancelled','issued')${mf}
                ORDER BY substr(o.scheduled_at,1,10)<? , o.scheduled_at`, t, t, t),
    by_status: all(`SELECT status, COUNT(*) n FROM orders o WHERE status NOT IN ('issued','cancelled')${mf} GROUP BY status`),
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
  let sql = 'SELECT * FROM products WHERE 1=1'; const p = [];
  if (!ctx.query.all) sql += ' AND active=1';
  if (q) { sql += ' AND (ulower(name) LIKE ? OR ulower(sku) LIKE ? OR ulower(brand) LIKE ? OR ulower(category) LIKE ?)'; p.push(...Array(4).fill(`%${lc(q)}%`)); }
  if (ctx.query.low) sql += ' AND min_stock>0 AND stock<=min_stock';
  sql += ' ORDER BY category, name';
  const rows = all(sql, ...p);
  if (ctx.user.role === 'master') rows.forEach((x) => delete x.cost);
  return rows;
});
r.post('/api/products', OFFICE, (ctx) => {
  const b = ctx.body;
  return tx(() => {
    const res = run('INSERT INTO products(sku,name,category,brand,unit,cost,price,stock,min_stock,warranty_months) VALUES(?,?,?,?,?,?,?,0,?,?)',
      str(b.sku), need(b.name, 'Укажите название'), str(b.category), str(b.brand), str(b.unit) || 'шт', num(b.cost), num(b.price), num(b.min_stock), num(b.warranty_months, 12));
    const id = Number(res.lastInsertRowid);
    if (num(b.stock) !== 0) moveStock(id, num(b.stock), 'in', null, 'Начальный остаток', ctx.user);
    return { id };
  });
});
r.put('/api/products/:id', OFFICE, (ctx) => {
  const b = ctx.body;
  run('UPDATE products SET sku=?,name=?,category=?,brand=?,unit=?,cost=?,price=?,min_stock=?,warranty_months=?,active=? WHERE id=?',
    str(b.sku), need(b.name, 'Укажите название'), str(b.category), str(b.brand), str(b.unit) || 'шт', num(b.cost), num(b.price), num(b.min_stock), num(b.warranty_months), b.active ? 1 : 0, +ctx.params.id);
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
  if (q.status === 'active') w += " AND o.status NOT IN ('issued','cancelled')";
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
  o.items = all('SELECT i.*, u.name master_name FROM order_items i LEFT JOIN users u ON u.id=i.master_id WHERE order_id=? ORDER BY kind DESC, id', id);
  o.payments = all('SELECT p.*, u.name user FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE order_id=? ORDER BY id', id);
  o.log = all('SELECT l.*, u.name user FROM order_log l LEFT JOIN users u ON u.id=l.user_id WHERE order_id=? ORDER BY id DESC', id);
  const services = o.items.filter((i) => i.kind === 'service').reduce((s, i) => s + i.qty * i.price, 0);
  const goods = o.items.filter((i) => i.kind === 'product').reduce((s, i) => s + i.qty * i.price, 0);
  const sub = services + goods;
  const discount = Math.round(sub * (o.discount_percent || 0)) / 100;
  const total = Math.round((sub - discount) * 100) / 100;
  const paid = o.payments.reduce((s, p) => s + (p.direction === 'in' ? p.amount : -p.amount), 0);
  o.totals = { services, goods, sub, discount, total, paid, due: Math.round((total - paid) * 100) / 100 };
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
    const status = b.scheduled_at ? 'scheduled' : 'new';
    const res = run(`INSERT INTO orders(contractor_id,client_id,car_id,master_id,manager_id,status,scheduled_at,end_date,duration_min,bay,complaint,notes,mileage,discount_percent,created_by)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      b.contractor_id ? +b.contractor_id : null, clientId, carId, b.master_id ? +b.master_id : null, b.manager_id ? +b.manager_id : ctx.user.id, status, str(b.scheduled_at), endDate(b.scheduled_at, b.end_date),
      num(b.duration_min, 120), str(b.bay), str(b.complaint), str(b.notes), b.mileage ? num(b.mileage) : null,
      b.discount_percent !== undefined && b.discount_percent !== '' ? num(b.discount_percent) : client?.discount || 0, ctx.user.id);
    const id = Number(res.lastInsertRowid);
    logOrder(id, ctx.user, 'Заказ создан');
    for (const it of b.items || []) addItem(id, it, ctx.user, false);
    if (b.lead_id) run("UPDATE leads SET status='converted', client_id=?, order_id=? WHERE id=?", clientId, id, +b.lead_id);
    if (b.scheduled_at) notifyNewAppointment(id);
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
  if (vals.scheduled_at && vals.scheduled_at !== o.scheduled_at) notifyNewAppointment(id);
  return { ok: true };
});

r.delete('/api/orders/:id', ADMIN, (ctx) => {
  const id = +ctx.params.id;
  tx(() => {
    const o = get('SELECT * FROM orders WHERE id=?', id);
    if (o && o.stock_written_off) returnStock(id, ctx.user);
    run('DELETE FROM orders WHERE id=?', id);
  });
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

r.post('/api/orders/:id/status', (ctx) => {
  const id = +ctx.params.id; const st = ctx.body.status;
  if (!STATUSES.includes(st)) throw new HttpError(400, 'Неизвестный статус');
  const o = get('SELECT * FROM orders WHERE id=?', id);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  if (ctx.user.role === 'master') {
    if (!canSeeOrder(ctx.user, o)) throw new HttpError(403, 'Это не ваш заказ');
    if (!['in_work', 'waiting', 'done'].includes(st)) throw new HttpError(403, 'Мастер может ставить только «В работе», «Ждёт запчасти», «Готов»');
  }
  if (o.status === st) return { ok: true };
  tx(() => {
    if (st === 'issued' && !o.stock_written_off) writeOffStock(id, ctx.user);
    if (st !== 'issued' && o.stock_written_off) returnStock(id, ctx.user);
    run('UPDATE orders SET status=?, done_at=CASE WHEN ?=\'done\' THEN datetime(\'now\',\'localtime\') ELSE done_at END, issued_at=CASE WHEN ?=\'issued\' THEN datetime(\'now\',\'localtime\') WHEN ?<>\'issued\' THEN NULL ELSE issued_at END WHERE id=?',
      st, st, st, st, id);
    logOrder(id, ctx.user, `Статус: ${STATUS_RU[o.status]} → ${STATUS_RU[st]}`);
  });
  if (st === 'done') {
    const full = loadOrder(id);
    tg.staff(`✅ Заказ ${full.number} готов\n${full.client_name}, ${[full.brand, full.model, full.plate].filter(Boolean).join(' ')}\nК оплате: ${full.totals.due} ₽`);
    if (full.client_tg && getSetting('tg_notify_client_done') === '1') {
      tg.send(full.client_tg, `Здравствуйте! Ваш автомобиль ${[full.brand, full.model].filter(Boolean).join(' ')} готов. Можно забирать.\n${getSetting('company_name')}${getSetting('company_address') ? ', ' + getSetting('company_address') : ''}`);
    }
  }
  return { ok: true };
});

r.post('/api/orders/:id/comment', (ctx) => {
  const o = get('SELECT * FROM orders WHERE id=?', +ctx.params.id);
  if (!o || !canSeeOrder(ctx.user, o)) throw new HttpError(403, 'Нет доступа');
  logOrder(o.id, ctx.user, '💬 ' + need(ctx.body.text, 'Пустой комментарий'));
  return { ok: true };
});

function addItem(orderId, b, user, log = true) {
  const kind = b.kind === 'product' ? 'product' : 'service';
  let name = str(b.name), price = num(b.price), cost = num(b.cost), warranty = num(b.warranty_months);
  if (b.ref_id) {
    const ref = get(`SELECT * FROM ${kind === 'product' ? 'products' : 'services'} WHERE id=?`, +b.ref_id);
    if (!ref) throw new HttpError(400, 'Позиция не найдена');
    name = name || ref.name;
    if (b.price === undefined || b.price === '') price = ref.price;
    if (kind === 'product') cost = ref.cost;
    if (b.warranty_months === undefined || b.warranty_months === '') warranty = ref.warranty_months;
  }
  need(name, 'Укажите название позиции');
  const o = get('SELECT master_id, stock_written_off FROM orders WHERE id=?', orderId);
  const res = run('INSERT INTO order_items(order_id,kind,ref_id,name,qty,price,cost,master_id,warranty_months) VALUES(?,?,?,?,?,?,?,?,?)',
    orderId, kind, b.ref_id ? +b.ref_id : null, name, num(b.qty, 1), price, cost,
    kind === 'service' ? (b.master_id ? +b.master_id : o.master_id) : null, warranty);
  if (o.stock_written_off && kind === 'product' && b.ref_id) moveStock(+b.ref_id, -num(b.qty, 1), 'order', orderId, 'Списание по заказу ' + orderNo(orderId), user);
  if (log) logOrder(orderId, user, `Добавлено: ${name} × ${num(b.qty, 1)}`);
  return Number(res.lastInsertRowid);
}

r.post('/api/orders/:id/items', OFFICE, (ctx) => ({ id: tx(() => addItem(+ctx.params.id, ctx.body, ctx.user)) }));

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
  });
  return { ok: true };
});

r.delete('/api/order-items/:id', OFFICE, (ctx) => {
  const i = get('SELECT * FROM order_items WHERE id=?', +ctx.params.id);
  if (!i) return { ok: true };
  tx(() => {
    const o = get('SELECT stock_written_off FROM orders WHERE id=?', i.order_id);
    if (o.stock_written_off && i.kind === 'product' && i.ref_id) moveStock(i.ref_id, i.qty, 'order', i.order_id, 'Возврат по заказу ' + orderNo(i.order_id), ctx.user);
    run('DELETE FROM order_items WHERE id=?', i.id);
    logOrder(i.order_id, ctx.user, `Удалено: ${i.name}`);
  });
  return { ok: true };
});

r.post('/api/orders/:id/pay', OFFICE, (ctx) => {
  const id = +ctx.params.id; const b = ctx.body;
  const amount = num(b.amount);
  if (!amount) throw new HttpError(400, 'Укажите сумму');
  const refund = amount < 0 || b.refund;
  run('INSERT INTO payments(order_id,direction,method,amount,category,note,user_id) VALUES(?,?,?,?,?,?,?)',
    id, refund ? 'out' : 'in', b.method || 'cash', Math.abs(amount), refund ? 'Возврат клиенту' : 'Оплата заказа', str(b.note), ctx.user.id);
  logOrder(id, ctx.user, `${refund ? 'Возврат' : 'Оплата'}: ${Math.abs(amount)} ₽ (${{ cash: 'наличные', card: 'карта', transfer: 'перевод' }[b.method || 'cash']})`);
  return { ok: true };
});

// ---------- Календарь ----------
r.get('/api/calendar', (ctx) => {
  const from = ctx.query.from || today(); const to = ctx.query.to || from;
  const p = [to, from]; let w = '';
  if (ctx.user.role === 'master') { w = ' AND (o.master_id=? OR o.id IN (SELECT order_id FROM order_items WHERE master_id=?))'; p.push(ctx.user.id, ctx.user.id); }
  const orders = all(`SELECT o.id,o.status,o.scheduled_at,o.end_date,o.duration_min,o.bay,o.master_id,o.complaint,c.name client,c.phone,ca.brand,ca.model,ca.plate,u.name master
              FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id LEFT JOIN users u ON u.id=o.master_id
              WHERE o.scheduled_at IS NOT NULL AND substr(o.scheduled_at,1,10)<=? AND COALESCE(o.end_date,substr(o.scheduled_at,1,10))>=?
              AND o.status<>'cancelled'${w} ORDER BY o.scheduled_at`, ...p);
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
  const kit = JSON.stringify({ kit: Array.isArray(b.kit) ? b.kit.map(String) : [], works: Array.isArray(b.works) ? b.works.map(String) : [] });
  run('UPDATE orders SET accept_at=?, accept_fuel=?, accept_kit=?, accept_damage=?, accept_items=?, accept_by=COALESCE(accept_by,?), mileage=COALESCE(?,mileage) WHERE id=?',
    str(b.accept_at) || o.accept_at || nowLocal(), str(b.accept_fuel), kit, str(b.accept_damage), str(b.accept_items), ctx.user.id, b.mileage ? num(b.mileage) : null, id);
  if (!o.accept_at) logOrder(id, ctx.user, 'Автомобиль принят в работу (акт приёма)');
  return { ok: true };
});
function nowLocal() { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4); return d.toISOString().slice(0, 16); }

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
  if (b.category === 'Зарплата' && ctx.user.role !== 'admin') throw new HttpError(403, 'Выплату зарплаты проводит администратор');
  const res = run('INSERT INTO payments(direction,method,amount,category,note,employee_id,contractor_id,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,COALESCE(?,datetime(\'now\',\'localtime\')))',
    b.direction === 'in' ? 'in' : 'out', b.method || 'cash', amount, str(b.category), str(b.note), b.employee_id ? +b.employee_id : null, b.contractor_id ? +b.contractor_id : null, ctx.user.id,
    b.date ? b.date + ' 12:00:00' : null);
  return { id: Number(res.lastInsertRowid) };
});
r.delete('/api/payments/:id', ADMIN, (ctx) => {
  const p = get('SELECT * FROM payments WHERE id=?', +ctx.params.id);
  if (p && p.order_id) logOrder(p.order_id, ctx.user, `Удалён платёж ${p.amount} ₽`);
  run('DELETE FROM payments WHERE id=?', +ctx.params.id);
  return { ok: true };
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
  const stockValue = get('SELECT COALESCE(SUM(stock*cost),0) cost, COALESCE(SUM(stock*price),0) retail FROM products WHERE active=1 AND stock>0');
  return { from, to: to.slice(0, 10), byMethod, byCategory, daily, sales, topServices, topGoods, sources, stockValue };
});

function salaryReport(from, to, userId) {
  const users = all(`SELECT id,name,role,is_master,salary_percent,goods_percent FROM users WHERE (active=1 OR id IN (SELECT employee_id FROM payments WHERE employee_id IS NOT NULL))${userId ? ' AND id=' + +userId : ''} ORDER BY name`);
  return users.map((u) => {
    const works = all(`SELECT o.id order_id, o.issued_at, i.name, i.qty*i.price*(1-o.discount_percent/100.0) sum
                       FROM order_items i JOIN orders o ON o.id=i.order_id
                       WHERE i.kind='service' AND o.status='issued' AND o.issued_at>=? AND o.issued_at<=? AND COALESCE(i.master_id,o.master_id)=? ORDER BY o.issued_at`, from, to, u.id);
    const goods = get(`SELECT COALESCE(SUM(i.qty*i.price*(1-o.discount_percent/100.0)),0) s FROM order_items i JOIN orders o ON o.id=i.order_id
                       WHERE i.kind='product' AND o.status='issued' AND o.issued_at>=? AND o.issued_at<=? AND o.manager_id=?`, from, to, u.id).s;
    const worksSum = works.reduce((s, w) => s + w.sum, 0);
    const accrued = Math.round((worksSum * (u.salary_percent || 0) / 100 + goods * (u.goods_percent || 0) / 100) * 100) / 100;
    const paid = get("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE category='Зарплата' AND employee_id=? AND created_at>=? AND created_at<=?", u.id, from, to).s;
    return { ...u, role: uiRole(u), works, works_sum: Math.round(worksSum * 100) / 100, goods_sum: Math.round(goods * 100) / 100, accrued, paid, due: Math.round((accrued - paid) * 100) / 100 };
  }).filter((u) => userId || u.accrued || u.paid || u.salary_percent || u.goods_percent || u.works.length);
}
r.get('/api/reports/salary', (ctx) => {
  const [from, to] = period(ctx.query);
  if (ctx.user.role !== 'admin') return salaryReport(from, to, ctx.user.id); // каждый видит только себя
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
  tg.staff(`🔥 Новая заявка #${id} (${str(b.source) || 'сайт'})\n${b.name || '—'} ${b.phone || ''}${b.car ? '\nАвто: ' + b.car : ''}${b.message ? '\n' + String(b.message).slice(0, 500) : ''}${known ? '\nУже клиент: ' + known.name : ''}`);
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

// ---------- Настройки ----------
const SETTING_KEYS = ['cashless_markup', 'company_name', 'company_subtitle', 'company_address', 'company_phone', 'company_inn', 'company_requisites', 'bays', 'work_start', 'work_end', 'tg_token', 'tg_staff_chat', 'tg_notify_client_done', 'order_terms', 'warranty_terms', 'api_key'];
r.get('/api/settings', ADMIN, () => Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(k)])));
r.put('/api/settings', ADMIN, (ctx) => {
  for (const k of SETTING_KEYS) if (ctx.body[k] !== undefined) setSetting(k, ctx.body[k]);
  tg.restart();
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
    run(`INSERT INTO payments(direction,method,amount,category,note,contractor_id,user_id,created_at) VALUES(?,?,?,?,?,?,?,?)`,
      b.type === 'pay_in' ? 'in' : 'out', b.method || 'transfer', amount, b.type === 'pay_in' ? 'Оплата от контрагента' : 'Оплата контрагенту', str(b.note), id, ctx.user.id, date + ' 12:00:00');
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

function notifyNewAppointment(id) {
  try {
    const o = loadOrder(id);
    if (!o.scheduled_at) return;
    const when = o.scheduled_at.replace('T', ' ');
    tg.staff(`📅 Запись ${o.number}: ${when}${o.bay ? ', ' + o.bay : ''}\n${o.client_name} ${o.client_phone || ''}\n${[o.brand, o.model, o.plate].filter(Boolean).join(' ')}${o.master_name ? '\nМастер: ' + o.master_name : ''}`);
    if (o.master_id) {
      const m = get('SELECT tg_chat_id FROM users WHERE id=?', o.master_id);
      if (m && m.tg_chat_id) tg.send(m.tg_chat_id, `Вам назначен заказ ${o.number} на ${when}\n${[o.brand, o.model].filter(Boolean).join(' ')}\n${o.complaint || ''}`);
    }
  } catch (e) { console.error('notify', e.message); }
}

module.exports = { router: r, loadOrder, orderNo, STATUS_RU, contractorLedger, contractorBalance };
