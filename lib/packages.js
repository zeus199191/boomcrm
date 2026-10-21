'use strict';
// Готовые комплексы: набор работ из прайса и товаров со склада, добавляется в заказ одной кнопкой.
// Цена позиции в комплексе — своя (если задана) или текущая цена из прайса/склада.
const { db, all, get, run, tx } = require('./db');
const { HttpError } = require('./http');

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS packages (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')))`);
  db.exec(`CREATE TABLE IF NOT EXISTS package_items (id INTEGER PRIMARY KEY, package_id INTEGER NOT NULL, kind TEXT NOT NULL, ref_id INTEGER, name TEXT,
    qty REAL DEFAULT 1, price REAL, sort INTEGER DEFAULT 0)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_pkg_items ON package_items(package_id, sort)');
}

const num = (v, d = 0) => { const n = Number(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : d; };

function items(pid) {
  return all('SELECT * FROM package_items WHERE package_id=? ORDER BY sort, id', pid).map((i) => {
    const ref = i.ref_id ? get(`SELECT id,name,price,active${i.kind === 'product' ? ',stock' : ''} FROM ${i.kind === 'product' ? 'products' : 'services'} WHERE id=?`, i.ref_id) : null;
    const base = ref ? ref.price : null;
    return { id: i.id, kind: i.kind, ref_id: i.ref_id, name: ref ? ref.name : i.name, qty: i.qty, price: i.price, base_price: base,
      eff_price: i.price !== null && i.price !== undefined ? i.price : base || 0, missing: !!i.ref_id && (!ref || !ref.active), stock: ref && i.kind === 'product' ? ref.stock : null };
  });
}
function full(p) {
  const it = items(p.id);
  return { ...p, items: it, total: Math.round(it.reduce((s, i) => s + i.eff_price * i.qty, 0) * 100) / 100 };
}

function save(id, b) {
  const name = String(b.name || '').trim(); if (!name) throw new HttpError(400, 'Укажите название комплекса');
  const list = Array.isArray(b.items) ? b.items.filter((i) => i && (i.ref_id || String(i.name || '').trim())) : [];
  if (!list.length) throw new HttpError(400, 'Добавьте в комплекс хотя бы одну работу или товар');
  return tx(() => {
    if (id) {
      if (!get('SELECT 1 FROM packages WHERE id=?', id)) throw new HttpError(404, 'Комплекс не найден');
      run('UPDATE packages SET name=?, description=?, active=?, sort=? WHERE id=?', name, String(b.description || '').trim(), b.active === false || b.active === 0 ? 0 : 1, num(b.sort), id);
      run('DELETE FROM package_items WHERE package_id=?', id);
    } else id = Number(run('INSERT INTO packages(name,description,active,sort) VALUES(?,?,?,?)', name, String(b.description || '').trim(), b.active === false || b.active === 0 ? 0 : 1, num(b.sort)).lastInsertRowid);
    list.forEach((i, n) => {
      const kind = i.kind === 'product' ? 'product' : 'service';
      run('INSERT INTO package_items(package_id,kind,ref_id,name,qty,price,sort) VALUES(?,?,?,?,?,?,?)', id, kind, i.ref_id ? +i.ref_id : null,
        String(i.name || '').trim() || null, Math.max(num(i.qty, 1), 0.001), i.price === '' || i.price === null || i.price === undefined ? null : num(i.price), n);
    });
    return { id };
  });
}

// deps: { addItem, logOrder } из api.js
function register(r, OFFICE, ADMIN, deps) {
  r.get('/api/packages', OFFICE, () => all('SELECT * FROM packages ORDER BY active DESC, sort, name').map(full));
  r.post('/api/packages', ADMIN, (ctx) => save(null, ctx.body));
  r.put('/api/packages/:id', ADMIN, (ctx) => save(+ctx.params.id, ctx.body));
  r.delete('/api/packages/:id', ADMIN, (ctx) => { const id = +ctx.params.id; tx(() => { run('DELETE FROM package_items WHERE package_id=?', id); run('DELETE FROM packages WHERE id=?', id); }); return { ok: true }; });
  // добавить комплекс в заказ (или расчёт)
  r.post('/api/orders/:id/package', OFFICE, (ctx) => {
    const oid = +ctx.params.id;
    const o = get('SELECT id,status FROM orders WHERE id=?', oid); if (!o) throw new HttpError(404, 'Заказ не найден');
    if (['issued', 'cancelled'].includes(o.status)) throw new HttpError(400, 'Заказ уже закрыт');
    const p = get('SELECT * FROM packages WHERE id=?', +ctx.body.package_id); if (!p) throw new HttpError(404, 'Комплекс не найден');
    const list = items(p.id).filter((i) => !i.missing);
    if (!list.length) throw new HttpError(400, 'В комплексе нет доступных позиций');
    return tx(() => {
      for (const i of list) deps.addItem(oid, { kind: i.kind, ref_id: i.ref_id || undefined, name: i.ref_id ? undefined : i.name, qty: i.qty, price: i.eff_price, warranty_months: i.ref_id ? undefined : 0 }, ctx.user, false);
      deps.logOrder(oid, ctx.user, `Добавлен комплекс «${p.name}»: ${list.map((i) => i.name + (i.qty !== 1 ? ' × ' + i.qty : '')).join(', ')}`);
      const skipped = items(p.id).filter((i) => i.missing).length;
      return { ok: true, added: list.length, skipped };
    });
  });
}

module.exports = { migrate, register };
