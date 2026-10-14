'use strict';
// База данных: встроенный SQLite в Node.js (без внешних зависимостей)
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.CRM_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'crm.sqlite');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
// Регистронезависимый поиск по кириллице (встроенный LIKE понимает только латиницу)
db.function('ulower', { deterministic: true }, (s) => (s == null ? null : String(s).toLowerCase().replace(/ё/g, 'е')));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','master')),
  pass_hash TEXT NOT NULL,
  phone TEXT,
  salary_percent REAL DEFAULT 0,      -- % мастеру от стоимости работ
  goods_percent REAL DEFAULT 0,       -- % от проданных товаров (для менеджеров)
  tg_chat_id TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  phone_norm TEXT,
  email TEXT,
  source TEXT,
  birthday TEXT,
  discount REAL DEFAULT 0,
  notes TEXT,
  tg_chat_id TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone_norm);
CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  brand TEXT, model TEXT, year INTEGER, vin TEXT, plate TEXT, color TEXT,
  audio_notes TEXT,                    -- что стоит: штатка, усилители, шумка
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  price REAL DEFAULT 0,
  duration_min INTEGER DEFAULT 60,
  warranty_months INTEGER DEFAULT 6,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  sku TEXT, name TEXT NOT NULL, category TEXT, brand TEXT,
  unit TEXT DEFAULT 'шт',
  cost REAL DEFAULT 0, price REAL DEFAULT 0,
  stock REAL DEFAULT 0, min_stock REAL DEFAULT 0,
  warranty_months INTEGER DEFAULT 12,
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  client_id INTEGER REFERENCES clients(id),
  car_id INTEGER REFERENCES cars(id),
  master_id INTEGER REFERENCES users(id),
  manager_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'new',
  scheduled_at TEXT,                   -- 'YYYY-MM-DDTHH:MM'
  duration_min INTEGER DEFAULT 120,
  bay TEXT,                            -- пост / бокс
  complaint TEXT,                      -- пожелания клиента
  notes TEXT,                          -- внутренние заметки
  mileage INTEGER,
  discount_percent REAL DEFAULT 0,
  stock_written_off INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now','localtime')),
  done_at TEXT,
  issued_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_sched ON orders(scheduled_at);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service','product')),
  ref_id INTEGER,
  name TEXT NOT NULL,
  qty REAL DEFAULT 1,
  price REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  master_id INTEGER REFERENCES users(id),
  warranty_months INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS order_log (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  user_id INTEGER, text TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  method TEXT DEFAULT 'cash',          -- cash / card / transfer
  amount REAL NOT NULL,
  category TEXT,                       -- оплата заказа, аренда, закупка, зарплата...
  note TEXT,
  employee_id INTEGER,                 -- для выплат зарплаты
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pay_date ON payments(created_at);
CREATE TABLE IF NOT EXISTS stock_moves (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty REAL NOT NULL,                   -- + приход, - расход
  kind TEXT,                           -- in / out / adjust / order
  order_id INTEGER, note TEXT, user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  name TEXT, phone TEXT, car TEXT, message TEXT,
  source TEXT DEFAULT 'сайт',
  status TEXT DEFAULT 'new',           -- new / work / converted / lost
  client_id INTEGER, order_id INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`;
db.exec(SCHEMA);

// ---- helpers ----
const clean = (p) => p.map((v) => (v === undefined || v === '' ? null : v === true ? 1 : v === false ? 0 : v));
const stmtCache = new Map();
const prep = (sql) => { let s = stmtCache.get(sql); if (!s) { s = db.prepare(sql); stmtCache.set(sql, s); } return s; };
const all = (sql, ...p) => prep(sql).all(...clean(p)).map((r) => ({ ...r }));
const get = (sql, ...p) => { const r = prep(sql).get(...clean(p)); return r ? { ...r } : undefined; };
const run = (sql, ...p) => prep(sql).run(...clean(p));

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function getSetting(key, def = '') {
  const r = get('SELECT value FROM settings WHERE key=?', key);
  return r && r.value != null ? r.value : def;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value ?? ''));
}

function normPhone(p) {
  if (!p) return '';
  let d = String(p).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
}

// Начальные данные
function seed() {
  const defaults = {
    company_name: 'Бумсистем',
    company_subtitle: 'Студия автозвука и тюнинга',
    company_address: '', company_phone: '', company_inn: '', company_requisites: '',
    bays: 'Бокс 1,Бокс 2',
    work_start: '09:00', work_end: '21:00',
    tg_token: '', tg_staff_chat: '',
    tg_notify_client_done: '1',
    api_key: require('node:crypto').randomBytes(16).toString('hex'),
    order_terms: 'Исполнитель гарантирует качество выполненных работ в течение указанного гарантийного срока. Гарантия не распространяется на повреждения, вызванные неправильной эксплуатацией, вмешательством третьих лиц, ДТП и перепадами напряжения бортовой сети.',
    warranty_terms: 'Гарантийный ремонт производится при предъявлении настоящего талона. Гарантия не действует при наличии механических повреждений, следов влаги, самостоятельного вскрытия или перемонтажа оборудования, а также при эксплуатации с нарушением инструкций производителя.',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (get('SELECT 1 FROM settings WHERE key=?', k) === undefined) setSetting(k, v);
  }
  if (get('SELECT COUNT(*) c FROM services').c === 0) {
    const s = [
      ['Установка магнитолы 1DIN/2DIN', 'Установка', 2500, 90, 6],
      ['Установка Android-магнитолы с рамкой', 'Установка', 3500, 120, 6],
      ['Установка компонентной акустики (пара)', 'Установка', 3000, 120, 6],
      ['Установка коаксиальной акустики (пара)', 'Установка', 1500, 60, 6],
      ['Установка усилителя с прокладкой проводки', 'Установка', 4500, 180, 6],
      ['Установка сабвуфера (корпус)', 'Установка', 2000, 60, 6],
      ['Изготовление короба под сабвуфер', 'Изготовление', 8000, 480, 12],
      ['Изготовление подиумов под акустику', 'Изготовление', 6000, 360, 12],
      ['Шумоизоляция двери (1 шт.)', 'Шумоизоляция', 3000, 90, 12],
      ['Шумоизоляция пола', 'Шумоизоляция', 12000, 480, 12],
      ['Шумоизоляция крыши', 'Шумоизоляция', 7000, 300, 12],
      ['Шумоизоляция багажника', 'Шумоизоляция', 6000, 240, 12],
      ['Комплексная шумоизоляция салона', 'Шумоизоляция', 45000, 1440, 12],
      ['Настройка процессора / DSP', 'Настройка', 5000, 120, 1],
      ['Установка процессора DSP', 'Установка', 5000, 180, 6],
      ['Установка камеры заднего вида', 'Установка', 2500, 90, 6],
      ['Установка сигнализации с автозапуском', 'Охранные системы', 6000, 240, 12],
      ['Установка видеорегистратора скрытая', 'Установка', 1500, 60, 6],
      ['Установка контурной подсветки салона', 'Тюнинг', 8000, 300, 6],
      ['Диагностика аудиосистемы', 'Диагностика', 1000, 60, 0],
    ];
    const st = db.prepare('INSERT INTO services(name,category,price,duration_min,warranty_months) VALUES(?,?,?,?,?)');
    for (const r of s) st.run(...r);
  }
}
seed();

module.exports = { db, all, get, run, tx, getSetting, setSetting, normPhone, DB_FILE, DATA_DIR };
