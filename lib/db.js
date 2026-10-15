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

// Прайс студии «Бумсистем»: [название, категория, цена (наличные), минут, гарантия мес.]
const PRICE_V2 = [
  ['Установка передней пары динамиков (кольца+метизы включены) МБ+ВЧ', 'Акустика', 6000, 180, 6],
  ['Установка задней пары динамиков (кольца+метизы включены)', 'Акустика', 4500, 120, 6],
  ['Подключение моноблока (простой монтаж, протяжка силы)', 'Усилители и сабвуферы', 5000, 180, 6],
  ['Подключение моноблока (сложный монтаж, протяжка силы)', 'Усилители и сабвуферы', 8000, 300, 6],
  ['Подключение 2х-4х канального усилителя (протяжка силы, протяжка акустики)', 'Усилители и сабвуферы', 8000, 300, 6],
  ['Установка магнитолы (готовый комплект)', 'Магнитолы', 3200, 90, 6],
  ['Установка магнитолы с доработкой проводки и креплений', 'Магнитолы', 5000, 180, 6],
  ['Установка магнитолы при наличии аналогового подключения к штатному усилителю', 'Магнитолы', 10000, 300, 6],
  ['Установка сигнализации Стандарт (Япония и подобные)', 'Сигнализации', 8000, 300, 12],
  ['Установка сигнализации Стандарт+ (Япония и подобные с i-stop, Vezel)', 'Сигнализации', 10000, 360, 12],
  ['Установка сигнализации Европа лайт (ФФ2, Поло и подобные)', 'Сигнализации', 12000, 360, 12],
  ['Установка сигнализации (Пассат, Ауди и прочее)', 'Сигнализации', 15000, 420, 12],
  ['Установка сигнализации Китай (китайские бренды)', 'Сигнализации', 10000, 360, 12],
  ['Установка сигнализации MB и подобные', 'Сигнализации', 40000, 600, 12],
  ['Установка доп. модуля к сигнализации (если ставили мы)', 'Сигнализации', 1500, 60, 12],
  ['Установка доп. модуля к сигнализации (чужая установка)', 'Сигнализации', 3000, 120, 12],
  ['Установка механического актуатора', 'Сигнализации', 3000, 90, 12],
  ['Установка концевика двери', 'Сигнализации', 1000, 30, 6],
  ['Установка камеры заднего/переднего вида', 'Камеры и регистраторы', 3000, 120, 6],
  ['Коммутация штатной камеры Тойота', 'Камеры и регистраторы', 2500, 90, 6],
  ['Установка видеорегистратора', 'Камеры и регистраторы', 2000, 60, 6],
  ['Шумоизоляция 1 двери', 'Шумоизоляция', 5500, 120, 12],
  ['Шумоизоляция в круг', 'Шумоизоляция', 70000, 2880, 12],
  ['Шумоизоляция заднего крыла', 'Шумоизоляция', 5000, 120, 12],
  ['Шумоизоляция крышки багажника', 'Шумоизоляция', 3000, 90, 12],
  ['Шумоизоляция пола', 'Шумоизоляция', 30000, 960, 12],
  ['Шумоизоляция ванны багажника', 'Шумоизоляция', 15000, 480, 12],
  ['Шумоизоляция крыши', 'Шумоизоляция', 15000, 480, 12],
  ['Настройка аудиосистемы / процессора', 'Настройка и диагностика', 1500, 60, 0],
  ['Диагностика', 'Настройка и диагностика', 1500, 60, 0],
  ['Консультация', 'Настройка и диагностика', 0, 30, 0],
];

// Миграции: добавляем недостающие колонки в существующую базу
function addColumn(table, col, def) {
  const cols = all(`PRAGMA table_info(${table})`).map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
function migrate() {
  addColumn('users', 'is_master', 'INTEGER DEFAULT 0');
  addColumn('users', 'deleted', 'INTEGER DEFAULT 0');        // руководитель-мастер: менеджер, который тоже работает мастером
  addColumn('orders', 'accept_at', 'TEXT');                     // дата/время приёмки авто
  addColumn('orders', 'accept_fuel', 'TEXT');                   // уровень топлива
  addColumn('orders', 'accept_kit', 'TEXT');                    // комплектность (JSON-массив отмеченных пунктов)
  addColumn('orders', 'accept_damage', 'TEXT');                 // повреждения/состояние
  addColumn('orders', 'accept_items', 'TEXT');                  // личные вещи в салоне
  addColumn('orders', 'accept_by', 'INTEGER');                  // кто принял
  addColumn('orders', 'end_date', 'TEXT');                      // до какого дня авто стоит на посту (журнал записи)
  db.exec(`CREATE TABLE IF NOT EXISTS cal_notes (
    id INTEGER PRIMARY KEY, date TEXT NOT NULL, bay TEXT, text TEXT NOT NULL, color TEXT,
    created_by INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')));
    CREATE INDEX IF NOT EXISTS idx_notes_date ON cal_notes(date);`);
  // Контрагенты: поставщики, партнёры (дилеры, автодома, детейлинги), подрядчики, юрлица-клиенты
  db.exec(`CREATE TABLE IF NOT EXISTS contractors (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT DEFAULT 'supplier', phone TEXT, contact TEXT, inn TEXT,
    requisites TEXT, notes TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE TABLE IF NOT EXISTS contractor_ops (
    id INTEGER PRIMARY KEY, contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('we_owe','they_owe')), amount REAL NOT NULL, note TEXT, date TEXT,
    user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')));
  CREATE INDEX IF NOT EXISTS idx_cops ON contractor_ops(contractor_id);`);
  addColumn('payments', 'contractor_id', 'INTEGER');
  addColumn('orders', 'contractor_id', 'INTEGER');
  addColumn('stock_moves', 'contractor_id', 'INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)');
  // Начисления зарплаты фиксируются в момент выдачи авто (процент на дату выдачи)
  const hadAccruals = !!get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='salary_accruals'");
  db.exec(`CREATE TABLE IF NOT EXISTS salary_accruals (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, item_id INTEGER,
    user_id INTEGER NOT NULL, name TEXT, base REAL, percent REAL, amount REAL, created_at TEXT);
  CREATE INDEX IF NOT EXISTS idx_acc_user ON salary_accruals(user_id, created_at);`);
  if (!hadAccruals) setSetting('accruals_backfill', '1');
  // Товар в заказе, взятый у поставщика (долг, если не было на складе)
  addColumn('order_items', 'contractor_id', 'INTEGER');
  addColumn('order_items', 'debt_op_id', 'INTEGER');
  addColumn('order_items', 'supplied_qty', 'REAL DEFAULT 0');
  if (get("SELECT 1 FROM settings WHERE key='cashless_markup'") === undefined) setSetting('cashless_markup', '10');
  // прайс студии (из таблицы заказчика) — один раз заменяет стартовый
  if (getSetting('price_v2') !== '1') {
    tx(() => {
      run('UPDATE services SET active=0 WHERE id NOT IN (SELECT DISTINCT ref_id FROM order_items WHERE kind=\'service\' AND ref_id IS NOT NULL)');
      const st = db.prepare('INSERT INTO services(name,category,price,duration_min,warranty_months) VALUES(?,?,?,?,?)');
      for (const [n, c, p, d, w] of PRICE_V2) if (!get('SELECT 1 FROM services WHERE name=? AND active=1', n)) st.run(n, c, p, d, w);
      setSetting('price_v2', '1');
    });
  }
  // 6 постов вместо стартовых двух боксов
  const bays = get("SELECT value FROM settings WHERE key='bays'");
  if (bays && bays.value === 'Бокс 1,Бокс 2') setSetting('bays', 'Пост 1,Пост 2,Пост 3,Пост 4,Пост 5,Пост 6');
}

// Начальные данные
function seed() {
  const defaults = {
    company_name: 'Бумсистем',
    company_subtitle: 'Студия автозвука и тюнинга',
    company_address: '', company_phone: '', company_inn: '', company_requisites: '',
    bays: 'Пост 1,Пост 2,Пост 3,Пост 4,Пост 5,Пост 6',
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
migrate();

module.exports = { db, all, get, run, tx, getSetting, setSetting, normPhone, DB_FILE, DATA_DIR };
