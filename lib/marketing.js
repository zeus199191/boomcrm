'use strict';
// Маркетинг: аналитика по каналам, контент-план, рекламный бюджет, сегменты клиентской базы, запросы отзывов
const { db, all, get, run, tx, getSetting } = require('./db');
const { HttpError } = require('./http');

const str = (v) => (v === undefined || v === null ? null : String(v).trim() || null);
const num = (v, d = 0) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);
const r2 = (x) => Math.round((+x || 0) * 100) / 100;
const totalSql = (a) => `ROUND((SELECT COALESCE(SUM(qty*price),0) FROM order_items i WHERE i.order_id=${a}.id) * (1 - COALESCE(${a}.discount_percent,0)/100.0), 2)`;
const NOSRC = 'Не указан';
const POST_STATUSES = ['idea', 'plan', 'ready', 'published'];

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS mk_posts (id INTEGER PRIMARY KEY, date TEXT, channel TEXT, format TEXT, title TEXT NOT NULL, text TEXT,
    status TEXT DEFAULT 'idea', url TEXT, order_id INTEGER, responsible_id INTEGER, reach INTEGER, leads INTEGER, user_id INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS mk_spend (id INTEGER PRIMARY KEY, date TEXT NOT NULL, channel TEXT NOT NULL, amount REAL NOT NULL, note TEXT,
    payment_id INTEGER, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')))`);
  const cols = all('PRAGMA table_info(orders)').map((c) => c.name);
  if (!cols.includes('review_asked_at')) db.exec('ALTER TABLE orders ADD COLUMN review_asked_at TEXT');
}

function period(q) {
  const t = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : t.slice(0, 8) + '01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : t;
  return [from, to, from + ' 00:00:00', to + ' 23:59:59'];
}

function analytics(q) {
  const [from, to, a, b] = period(q);
  const ch = new Map();
  const C = (k) => { k = String(k || NOSRC).trim(); k = k.charAt(0).toUpperCase() + k.slice(1); if (!ch.has(k)) ch.set(k, { channel: k, leads: 0, converted: 0, clients: 0, orders: 0, revenue: 0, spend: 0 }); return ch.get(k); };
  for (const x of all(`SELECT COALESCE(NULLIF(TRIM(source),''),?) s, COUNT(*) n, SUM(CASE WHEN status='converted' OR order_id IS NOT NULL THEN 1 ELSE 0 END) c FROM leads WHERE created_at BETWEEN ? AND ? GROUP BY s`, NOSRC, a, b)) { C(x.s).leads += x.n; C(x.s).converted += x.c; }
  for (const x of all(`SELECT COALESCE(NULLIF(TRIM(source),''),?) s, COUNT(*) n FROM clients WHERE created_at BETWEEN ? AND ? GROUP BY s`, NOSRC, a, b)) C(x.s).clients += x.n;
  const issued = all(`SELECT o.id, o.client_id, COALESCE(NULLIF(TRIM(c.source),''),?) s, ${totalSql('o')} total,
      EXISTS(SELECT 1 FROM orders p WHERE p.client_id=o.client_id AND p.status='issued' AND p.id<>o.id AND COALESCE(p.issued_at,p.created_at) < COALESCE(o.issued_at,o.created_at)) repeat
    FROM orders o LEFT JOIN clients c ON c.id=o.client_id WHERE o.status='issued' AND COALESCE(o.issued_at,o.created_at) BETWEEN ? AND ?`, NOSRC, a, b);
  for (const o of issued) { const c = C(o.s); c.orders++; c.revenue += o.total; }
  for (const x of all('SELECT channel, SUM(amount) s FROM mk_spend WHERE date BETWEEN ? AND ? GROUP BY channel', from, to)) C(x.channel).spend += x.s;
  const other = get(`SELECT COALESCE(SUM(amount),0) s FROM payments WHERE direction='out' AND category='Реклама' AND created_at BETWEEN ? AND ? AND id NOT IN (SELECT payment_id FROM mk_spend WHERE payment_id IS NOT NULL)`, a, b).s;
  if (other > 0) C('Реклама без канала (из Финансов)').spend += other;
  const channels = [...ch.values()].map((c) => ({ ...c, revenue: r2(c.revenue), spend: r2(c.spend),
    cpl: c.spend && c.leads ? r2(c.spend / c.leads) : null, cac: c.spend && c.clients ? r2(c.spend / c.clients) : null,
    romi: c.spend ? Math.round((c.revenue - c.spend) / c.spend * 100) : null }))
    .sort((x, y) => y.revenue - x.revenue || y.leads - x.leads);
  const revenue = r2(issued.reduce((s, o) => s + o.total, 0));
  const repeatN = issued.filter((o) => o.repeat).length;
  const spend = r2(channels.reduce((s, c) => s + c.spend, 0));
  const leads = channels.reduce((s, c) => s + c.leads, 0), conv = channels.reduce((s, c) => s + c.converted, 0);
  const totals = { revenue, orders: issued.length, avg: issued.length ? r2(revenue / issued.length) : 0,
    new_clients: channels.reduce((s, c) => s + c.clients, 0), repeat_orders: repeatN, repeat_share: issued.length ? Math.round(repeatN / issued.length * 100) : 0,
    leads, converted: conv, conversion: leads ? Math.round(conv / leads * 100) : 0, spend, romi: (() => { const paid = channels.filter((c) => c.spend > 0); const rv = paid.reduce((x, c) => x + c.revenue, 0); return spend ? Math.round((rv - spend) / spend * 100) : null; })() };
  // направления: работы по категориям прайса, товары по категориям каталога
  const cats = all(`SELECT CASE WHEN i.kind='service' THEN 'Работы · ' || COALESCE(s.category,'Без категории') ELSE 'Товары · ' || COALESCE(p.category,'Без категории') END cat,
      ROUND(SUM(i.qty*i.price*(1-COALESCE(o.discount_percent,0)/100.0)),2) sum, COUNT(DISTINCT o.id) orders
    FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN services s ON i.kind='service' AND s.id=i.ref_id LEFT JOIN products p ON i.kind='product' AND p.id=i.ref_id
    WHERE o.status='issued' AND COALESCE(o.issued_at,o.created_at) BETWEEN ? AND ? GROUP BY cat ORDER BY sum DESC LIMIT 15`, a, b);
  const top = all(`SELECT i.name, SUM(i.qty) qty, ROUND(SUM(i.qty*i.price*(1-COALESCE(o.discount_percent,0)/100.0)),2) sum
    FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.kind='service' AND o.status='issued' AND COALESCE(o.issued_at,o.created_at) BETWEEN ? AND ?
    GROUP BY i.name ORDER BY sum DESC LIMIT 10`, a, b);
  // динамика за 12 месяцев
  const months = []; const d0 = new Date(to + 'T12:00'); d0.setDate(1);
  for (let k = 11; k >= 0; k--) { const d = new Date(d0); d.setMonth(d.getMonth() - k); months.push(d.toISOString().slice(0, 7)); }
  const by = (sql, ...p) => Object.fromEntries(all(sql, ...p).map((x) => [x.m, x.v]));
  const m0 = months[0] + '-01 00:00:00';
  const rev = by(`SELECT substr(COALESCE(o.issued_at,o.created_at),1,7) m, ROUND(SUM(${totalSql('o')}),2) v FROM orders o WHERE o.status='issued' AND COALESCE(o.issued_at,o.created_at)>=? GROUP BY m`, m0);
  const ld = by("SELECT substr(created_at,1,7) m, COUNT(*) v FROM leads WHERE created_at>=? GROUP BY m", m0);
  const nc = by("SELECT substr(created_at,1,7) m, COUNT(*) v FROM clients WHERE created_at>=? GROUP BY m", m0);
  const sp = by("SELECT substr(date,1,7) m, SUM(amount) v FROM mk_spend WHERE date>=? GROUP BY m", months[0] + '-01');
  const trend = months.map((m) => ({ month: m, revenue: rev[m] || 0, leads: ld[m] || 0, clients: nc[m] || 0, spend: sp[m] || 0 }));
  return { from, to, totals, channels, cats, top, trend };
}

// Сегменты клиентской базы для рассылок
function segment(q) {
  const base = `SELECT c.id, c.name, c.phone, c.source, c.birthday, c.notes, COALESCE(c.no_sms,0) no_sms,
      (SELECT GROUP_CONCAT(TRIM(COALESCE(brand,'')||' '||COALESCE(model,'')), ', ') FROM cars WHERE client_id=c.id) cars,
      MAX(COALESCE((SELECT MAX(COALESCE(issued_at,created_at)) FROM orders WHERE client_id=c.id AND status='issued'),''), COALESCE(c.legacy_visit,'')) last_visit_raw,
      (SELECT COUNT(*) FROM orders WHERE client_id=c.id AND status='issued') + (CASE WHEN c.legacy_visit IS NOT NULL OR c.notes LIKE 'Из старой базы%' THEN 1 ELSE 0 END) visits,
      COALESCE((SELECT ROUND(SUM(${totalSql('o')}),0) FROM orders o WHERE o.client_id=c.id AND o.status='issued'),0) + COALESCE(c.legacy_spent,0) spent,
      (c.notes LIKE 'Из старой базы%') legacy
    FROM clients c WHERE COALESCE(c.phone,'')<>''`;
  const baseQ = base;
  const base2 = `SELECT *, NULLIF(last_visit_raw,'') last_visit FROM (${baseQ})`;
  const t = q.type || 'all'; let rows;
  if (t === 'sleeping') {
    const m = Math.max(1, Math.min(60, num(q.months, 6)));
    rows = all(`SELECT * FROM (${base2}) WHERE visits>0 AND (last_visit < datetime('now','localtime','-${m} months') OR (last_visit IS NULL AND legacy)) ORDER BY last_visit DESC NULLS LAST`);
  } else if (t === 'alarm') {
    rows = all(`SELECT * FROM (${base2}) x WHERE ((ulower(COALESCE(x.notes,'')) LIKE '%сигнал%' OR ulower(COALESCE(x.notes,'')) LIKE '%автозапуск%' OR ulower(COALESCE(x.notes,'')) LIKE '%starline%' OR ulower(COALESCE(x.notes,'')) LIKE '%pandora%' OR ulower(COALESCE(x.notes,'')) LIKE '%пандора%' OR ulower(COALESCE(x.notes,'')) LIKE '%старлайн%' OR ulower(COALESCE(x.notes,'')) LIKE '% e96%' OR ulower(COALESCE(x.notes,'')) LIKE '% s96%' OR ulower(COALESCE(x.notes,'')) LIKE '%dx9%') OR EXISTS(SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN products p ON i.kind='product' AND p.id=i.ref_id
      WHERE o.client_id=x.id AND o.status='issued' AND (ulower(i.name) LIKE '%сигнал%' OR ulower(i.name) LIKE '%автозапуск%' OR ulower(i.name) LIKE '%starline%' OR ulower(i.name) LIKE '%pandora%' OR ulower(COALESCE(p.category,'')) LIKE '%сигнал%'))
      ) ORDER BY last_visit DESC`);
  } else if (t === 'noalarm') {
    rows = all(`SELECT * FROM (${base2}) x WHERE visits>0 AND NOT (ulower(COALESCE(x.notes,'')) LIKE '%сигнал%' OR ulower(COALESCE(x.notes,'')) LIKE '%автозапуск%' OR ulower(COALESCE(x.notes,'')) LIKE '%starline%' OR ulower(COALESCE(x.notes,'')) LIKE '%pandora%' OR ulower(COALESCE(x.notes,'')) LIKE '%пандора%' OR ulower(COALESCE(x.notes,'')) LIKE '%старлайн%' OR ulower(COALESCE(x.notes,'')) LIKE '% e96%' OR ulower(COALESCE(x.notes,'')) LIKE '% s96%' OR ulower(COALESCE(x.notes,'')) LIKE '%dx9%') AND NOT EXISTS(SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN products p ON i.kind='product' AND p.id=i.ref_id
      WHERE o.client_id=x.id AND (ulower(i.name) LIKE '%сигнал%' OR ulower(i.name) LIKE '%автозапуск%' OR ulower(i.name) LIKE '%starline%' OR ulower(i.name) LIKE '%pandora%' OR ulower(COALESCE(p.category,'')) LIKE '%сигнал%'))
      ORDER BY last_visit DESC`);
  } else if (t === 'birthday') {
    rows = all(`SELECT * FROM (${base2}) WHERE birthday IS NOT NULL AND birthday<>''`).filter((x) => {
      const m = /(\d{4})-(\d{2})-(\d{2})/.exec(x.birthday) || /(\d{2})\.(\d{2})\.(\d{4})/.exec(x.birthday); if (!m) return false;
      const [mm, dd] = m[1].length === 4 ? [+m[2], +m[3]] : [+m[2], +m[1]];
      const now = new Date(); const bd = new Date(now.getFullYear(), mm - 1, dd); if (bd < new Date(now.getFullYear(), now.getMonth(), now.getDate())) bd.setFullYear(bd.getFullYear() + 1);
      x.days_to = Math.round((bd - now) / 864e5); return x.days_to <= 30;
    }).sort((p, n) => p.days_to - n.days_to);
  } else if (t === 'vip') {
    rows = all(`SELECT * FROM (${base2}) WHERE spent>0 ORDER BY spent DESC LIMIT 50`);
  } else if (t === 'source') {
    rows = all(`SELECT * FROM (${base2}) WHERE COALESCE(source,'')=? ORDER BY last_visit DESC`, String(q.source || ''));
  } else rows = all(`SELECT * FROM (${base2}) ORDER BY last_visit DESC NULLS LAST, id DESC`);
  return rows.slice(0, 2000);
}

function register(r, OFFICE, ADMIN) {
  r.get('/api/mk/analytics', ADMIN, (ctx) => analytics(ctx.query));

  // контент-план
  r.get('/api/mk/posts', ADMIN, (ctx) => {
    const m = /^\d{4}-\d{2}$/.test(ctx.query.month || '') ? ctx.query.month : new Date().toISOString().slice(0, 7);
    return {
      month: m,
      posts: all(`SELECT p.*, u.name responsible, o.id oid FROM mk_posts p LEFT JOIN users u ON u.id=p.responsible_id LEFT JOIN orders o ON o.id=p.order_id
        WHERE substr(COALESCE(p.date,''),1,7)=? ORDER BY p.date, p.id`, m),
      ideas: all(`SELECT p.*, u.name responsible FROM mk_posts p LEFT JOIN users u ON u.id=p.responsible_id WHERE (p.date IS NULL OR p.date='') ORDER BY p.id DESC LIMIT 100`),
      stats: get(`SELECT COUNT(*) total, SUM(status='published') published, COALESCE(SUM(reach),0) reach, COALESCE(SUM(leads),0) leads FROM mk_posts WHERE substr(COALESCE(date,''),1,7)=?`, m),
    };
  });
  const savePost = (b, id, user) => {
    const title = str(b.title); if (!title) throw new HttpError(400, 'Напишите тему публикации');
    const st = POST_STATUSES.includes(b.status) ? b.status : 'idea';
    const vals = [/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null, str(b.channel), str(b.format), title, str(b.text), st, str(b.url),
      b.order_id ? +b.order_id : null, b.responsible_id ? +b.responsible_id : null, b.reach === '' || b.reach == null ? null : Math.round(num(b.reach)), b.leads === '' || b.leads == null ? null : Math.round(num(b.leads))];
    if (id) { run('UPDATE mk_posts SET date=?,channel=?,format=?,title=?,text=?,status=?,url=?,order_id=?,responsible_id=?,reach=?,leads=? WHERE id=?', ...vals, id); return id; }
    return Number(run('INSERT INTO mk_posts(date,channel,format,title,text,status,url,order_id,responsible_id,reach,leads,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ...vals, user.id).lastInsertRowid);
  };
  r.post('/api/mk/posts', ADMIN, (ctx) => ({ id: savePost(ctx.body, 0, ctx.user) }));
  r.put('/api/mk/posts/:id', ADMIN, (ctx) => {
    const p = get('SELECT * FROM mk_posts WHERE id=?', +ctx.params.id); if (!p) throw new HttpError(404, 'Публикация не найдена');
    const b = { ...p, ...ctx.body }; savePost(b, p.id, ctx.user); return { ok: true };
  });
  r.delete('/api/mk/posts/:id', ADMIN, (ctx) => { run('DELETE FROM mk_posts WHERE id=?', +ctx.params.id); return { ok: true }; });
  // идеи из выполненных работ: выданные заказы с фото
  r.get('/api/mk/work-ideas', ADMIN, () => all(`SELECT o.id, COALESCE(o.issued_at,o.created_at) date, ca.brand, ca.model,
      (SELECT GROUP_CONCAT(name, ', ') FROM (SELECT name FROM order_items WHERE order_id=o.id ORDER BY kind DESC, price*qty DESC LIMIT 4)) items,
      (SELECT COUNT(*) FROM order_photos WHERE order_id=o.id) photos,
      (SELECT MIN(id) FROM order_photos WHERE order_id=o.id) photo_id,
      EXISTS(SELECT 1 FROM mk_posts WHERE order_id=o.id) used
    FROM orders o LEFT JOIN cars ca ON ca.id=o.car_id WHERE o.status='issued' ORDER BY COALESCE(o.issued_at,o.created_at) DESC LIMIT 24`));

  // рекламный бюджет
  r.get('/api/mk/spend', ADMIN, (ctx) => {
    const [from, to] = period(ctx.query);
    return all('SELECT s.*, u.name user FROM mk_spend s LEFT JOIN users u ON u.id=s.user_id WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC', from, to);
  });
  r.post('/api/mk/spend', ADMIN, (ctx) => {
    const b = ctx.body; const amount = r2(num(b.amount)); if (amount <= 0) throw new HttpError(400, 'Укажите сумму');
    const channel = str(b.channel); if (!channel) throw new HttpError(400, 'Укажите канал');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : new Date().toISOString().slice(0, 10);
    return tx(() => {
      let pid = null;
      if (b.to_finance) pid = Number(run(`INSERT INTO payments(direction,method,amount,category,note,user_id,created_at) VALUES('out',?,?,'Реклама',?,?,?)`,
        ['cash', 'card', 'transfer'].includes(b.method) ? b.method : 'transfer', amount, `${channel}${str(b.note) ? ' — ' + str(b.note) : ''}`, ctx.user.id, date + ' 12:00:00').lastInsertRowid);
      return { id: Number(run('INSERT INTO mk_spend(date,channel,amount,note,payment_id,user_id) VALUES(?,?,?,?,?,?)', date, channel, amount, str(b.note), pid, ctx.user.id).lastInsertRowid) };
    });
  });
  r.delete('/api/mk/spend/:id', ADMIN, (ctx) => {
    const s = get('SELECT * FROM mk_spend WHERE id=?', +ctx.params.id); if (!s) throw new HttpError(404, 'Не найдено');
    tx(() => { if (s.payment_id) run('DELETE FROM payments WHERE id=?', s.payment_id); run('DELETE FROM mk_spend WHERE id=?', s.id); });
    return { ok: true };
  });

  // база для рассылок
  r.get('/api/mk/segment', ADMIN, (ctx) => segment(ctx.query));

  // запросы отзывов после выдачи
  r.get('/api/mk/reviews', ADMIN, () => ({
    twogis_url: getSetting('twogis_url') || '',
    orders: all(`SELECT o.id, COALESCE(o.issued_at,o.created_at) issued, o.review_asked_at, c.name, c.phone, ca.brand, ca.model,
        (SELECT GROUP_CONCAT(name, ', ') FROM (SELECT name FROM order_items WHERE order_id=o.id AND kind='service' LIMIT 3)) works
      FROM orders o LEFT JOIN clients c ON c.id=o.client_id LEFT JOIN cars ca ON ca.id=o.car_id
      WHERE o.status='issued' AND COALESCE(o.issued_at,o.created_at)>=datetime('now','localtime','-45 days') ORDER BY (o.review_asked_at IS NOT NULL), COALESCE(o.issued_at,o.created_at) DESC LIMIT 100`),
  }));
  r.post('/api/mk/reviews/:id', ADMIN, (ctx) => {
    run("UPDATE orders SET review_asked_at=CASE WHEN ? THEN NULL ELSE datetime('now','localtime') END WHERE id=?", ctx.body.undo ? 1 : 0, +ctx.params.id);
    return { ok: true };
  });
}

module.exports = { migrate, register, analytics, segment };
