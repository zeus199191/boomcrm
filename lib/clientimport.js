'use strict';
// Импорт старой клиентской базы из Excel (.xlsx) или CSV: колонки определяются по заголовкам (или по содержимому),
// дубли — по телефону (в файле и в CRM). Нужен для рассылок в «Маркетинге».
const { db, all, get, run, tx, normPhone } = require('./db');
const { HttpError } = require('./http');

const FIELDS = {
  name: { t: 'Имя / ФИО', re: /^(фио|имя|клиент|контакт|заказчик|покупатель|ф\.?\s?и\.?\s?о|name)/i },
  phone: { t: 'Телефон', re: /(тел|phone|моб|сотов|whatsapp|номер\s*тел|контактн)/i },
  phone2: { t: 'Телефон 2', re: /^$/ },
  car: { t: 'Автомобиль', re: /(авто(?!номер)|машин|марка|модель|автомобиль|транспорт|car)/i },
  plate: { t: 'Госномер', re: /(гос|г\/н|гн\b|номер\s*авто|рег.*номер|plate)/i },
  date: { t: 'Дата / последний визит', re: /(дата|визит|обращен|когда|date)/i },
  sum: { t: 'Сумма', re: /(сумм|стоим|итого|оплат|чек|руб)/i },
  notes: { t: 'Что делали / примечание', re: /(работ|услуг|что дел|примеч|коммент|заметк|описан|заказ|note)/i },
  email: { t: 'E-mail', re: /(e-?mail|почта)/i },
  birthday: { t: 'День рождения', re: /(рожд|д\.?р\.?\b|birth)/i },
  source: { t: 'Откуда узнал', re: /(источник|откуда|канал|source)/i },
};

function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.slice(3);
  const u = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!u.includes('�')) return u;
  return new TextDecoder('windows-1251').decode(buf);
}
function parseCsv(text) {
  const first = text.split(/\r?\n/).slice(0, 5).join('\n');
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}
const COLS = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colIdx = (ref) => [...ref].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// таблица → массив строк-массивов
function table(buf, name) {
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const rows = require('./xlsx').readSheet(buf);
    const out = [];
    for (const r of rows) { const arr = []; for (const [ref, v] of Object.entries(r.cells)) arr[colIdx(ref)] = v; out.push(Array.from(arr, (v) => v ?? '')); }
    return out.filter((r) => r.some((c) => String(c).trim()));
  }
  if (/\.xls$/i.test(name || '') || (buf[0] === 0xd0 && buf[1] === 0xcf)) throw new HttpError(400, 'Это старый формат Excel (.xls). Откройте файл в Excel и сохраните как «Книга Excel (.xlsx)» или CSV.');
  return parseCsv(decodeText(buf));
}

const phoneLike = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 10 && d.length <= 12 && /^[78]?9\d{9}$|^[78]\d{10}$|^\d{10}$/.test(d); };
// Excel хранит даты числом дней от 1899-12-30
function dateOf(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) { const n = +s; if (n > 20000 && n < 60000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 864e5); return d.toISOString().slice(0, 10); } }
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(s); if (m) { let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`; }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function analyze(rows) {
  // строка заголовков — первая из 10 верхних, где ≥2 ячеек совпали с известными полями
  let hi = -1, map = {};
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const m = {}; rows[i].forEach((c, j) => { const t = String(c || '').trim(); if (!t || t.length > 40 || phoneLike(t)) return;
      for (const [k, f] of Object.entries(FIELDS)) if (!(k in m) && f.re.test(t)) { m[k] = j; break; } });
    if (Object.keys(m).length >= 2 || (m.phone !== undefined && Object.keys(m).length >= 1 && rows[i].every((c) => !phoneLike(c)))) { hi = i; map = m; break; }
  }
  const data = rows.slice(hi + 1);
  const width = Math.max(0, ...rows.map((r) => r.length));
  // телефонов может быть несколько колонок — по содержимому
  const phoneCols = [];
  for (let j = 0; j < width; j++) { const vals = data.slice(0, 200).map((r) => r[j]).filter(Boolean); if (vals.length && vals.filter(phoneLike).length / vals.length > 0.5) phoneCols.push(j); }
  if (map.phone === undefined && phoneCols.length) map.phone = phoneCols[0];
  if (map.phone2 === undefined) { const p2 = phoneCols.find((j) => j !== map.phone); if (p2 !== undefined) map.phone2 = p2; }
  if (map.name === undefined) { // первая текстовая колонка, где в основном буквы
    for (let j = 0; j < width; j++) { if (Object.values(map).includes(j)) continue; const vals = data.slice(0, 100).map((r) => r[j]).filter(Boolean);
      if (vals.length && vals.filter((v) => /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё .\-]{1,40}$/.test(v)).length / vals.length > 0.6) { map.name = j; break; } }
  }
  const headers = hi >= 0 ? rows[hi].map((c, j) => String(c || '').trim() || 'Колонка ' + COLS(j)) : Array.from({ length: width }, (_, j) => 'Колонка ' + COLS(j));
  return { header_row: hi, headers, map, data };
}

function toClients(data, map) {
  const g = (r, k) => (map[k] === undefined || map[k] === '' || map[k] === null ? '' : String(r[+map[k]] ?? '').trim());
  const out = [];
  for (const r of data) {
    let phone = g(r, 'phone'); if (!phoneLike(phone)) { const m = String(phone).match(/[+]?[78]?[\s(-]*9\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/); phone = m ? m[0] : ''; }
    if (!phone && phoneLike(g(r, 'phone2'))) phone = g(r, 'phone2');
    const name = g(r, 'name').replace(/\s+/g, ' ').slice(0, 100);
    const n = normPhone(phone);
    out.push({ name, phone: phone.trim(), norm: n.length === 11 ? n : '', phone2: g(r, 'phone2') !== phone ? g(r, 'phone2') : '', car: g(r, 'car'), plate: g(r, 'plate').toUpperCase().replace(/\s/g, ''),
      date: dateOf(g(r, 'date')), sum: +String(g(r, 'sum')).replace(/[^\d.,]/g, '').replace(',', '.') || 0, notes: g(r, 'notes'), email: g(r, 'email'), birthday: dateOf(g(r, 'birthday')), source: g(r, 'source') });
  }
  return out;
}

// «Журнал записи»: телефоны вписаны в ячейки свободным текстом вместе с машиной, работой и именем.
// Каждый телефон — клиент; машина — первая строка ячейки, имя — из словаря имён, дата — из колонки с датами.
const PHONE_RE = /(?:\+7|8|7)?[\s\-\/(]*\d{3}[\s\-\/)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2,4}/g;
const NAMES = new Set(('александр алексей анатолий андрей антон артем артём борис вадим валентин валерий василий виктор виталий владимир владислав влад вячеслав геннадий георгий глеб григорий даниил данил денис дмитрий евгений егор иван игорь илья кирилл константин лев леонид максим марк михаил никита николай олег павел петр пётр роман руслан сергей станислав степан тимур тимофей федор фёдор эдуард юрий ярослав едгор саша сережа серёжа дима женя миша коля вова паша рома слава толя юра леша лёша костя ваня витя гоша гена толик ' +
  'анастасия анна алёна алена алина валентина валерия вера виктория галина дарья евгения екатерина елена жанна зоя ирина карина кристина ксения лариса любовь людмила маргарита марина мария надежда наталья наталия нина оксана ольга полина светлана софья татьяна юлия яна настя катя лена оля таня юля маша наташа света').split(' '));
const SERVICE_START = /^(установка|диагностика|настройка|кнопка|консультация|демонтаж|монтаж|замена|ревизия|подключение|переподключение|изготовление|примерка|шумоизоляция|ремонт|бланк|звонок|позвонить|перезвонить|отзвониться|прошивка|перепрошивка|доработка|восстановление|перенос|снятие|проверка|коммутация|забрать|привезти|приедет|заказать|заказ)/i;
function journalExtract(rows) {
  // колонка с датами — где больше всего чисел-дат Excel или дат дд.мм.гггг
  const width = Math.max(0, ...rows.map((r) => r.length)); let dateCol = -1, best = 0;
  for (let j = 0; j < width; j++) { const n = rows.filter((r) => dateOf(r[j]) && !/[a-zа-я]/i.test(String(r[j]))).length; if (n > best) { best = n; dateCol = j; } }
  const out = [];
  for (const r of rows) {
    const date = dateCol >= 0 ? dateOf(r[dateCol]) : null;
    for (let j = 0; j < r.length; j++) {
      if (j === dateCol) continue; const cell = String(r[j] || ''); if (!cell) continue;
      const phones = (cell.match(PHONE_RE) || []).map((p) => p.trim()).filter((p) => { const n = normPhone(p); return n.length === 11 && /^7[39]/.test(n); });
      if (!phones.length) continue;
      const lines = cell.split(/\n/).map((x) => x.trim()).filter(Boolean);
      let first = (lines[0] || '').replace(/^\d{4}\.\d{2}\.\d{2}\s*/, '').replace(/^Бланк сметы\s*[-–—]\s*/i, '').replace(PHONE_RE, '').replace(/\b\d{1,2}[-:]\d{2}\b/g, '').replace(/\s+[—-]\s+.*$/, '').trim();
      const car = SERVICE_START.test(first) ? '' : first.split(/\s+/).filter((w) => !NAMES.has(w.toLowerCase().replace(/[^а-яё]/g, '')) && !/^(диагностика|настройка|установка|консультация)$/i.test(w)).join(' ').replace(/[,.;:\s]+$/, '').slice(0, 60);
      for (const ph of phones) {
        const line = lines.find((l) => l.includes(ph)) || '';
        const words = (line.replace(ph, ' ') + ' ' + lines.join(' ')).split(/[^А-Яа-яЁё]+/);
        const nm = words.find((w) => w && NAMES.has(w.toLowerCase()));
        const note = lines.filter((l) => !PHONE_RE.test(l) || l.replace(PHONE_RE, '').trim().length > 3).map((l) => l.replace(PHONE_RE, '').trim()).filter(Boolean).join(' / ');
        PHONE_RE.lastIndex = 0;
        out.push({ name: nm ? nm[0].toUpperCase() + nm.slice(1).toLowerCase() : '', phone: ph, norm: normPhone(ph), phone2: '', car, plate: '', date, sum: 0, notes: note.slice(0, 300), email: '', birthday: null, source: '' });
      }
    }
  }
  return out;
}

function migrate() {
  const cols = all('PRAGMA table_info(clients)').map((c) => c.name);
  if (!cols.includes('legacy_visit')) db.exec('ALTER TABLE clients ADD COLUMN legacy_visit TEXT'); // последний визит из старой базы
  if (!cols.includes('legacy_spent')) db.exec('ALTER TABLE clients ADD COLUMN legacy_spent REAL DEFAULT 0');
}

function register(r, OFFICE) {
  r.post('/api/clients/import', OFFICE, (ctx) => {
    const b = ctx.body || {};
    const buf = Buffer.from(String(b.file || '').replace(/^data:.*?base64,/, ''), 'base64');
    if (buf.length < 10) throw new HttpError(400, 'Файл пустой');
    const rows = table(buf, b.name);
    if (!rows.length) throw new HttpError(400, 'В файле не нашлось строк');
    const a = analyze(rows);
    const map = b.map && typeof b.map === 'object' ? b.map : a.map;
    const journal = map.phone === undefined || map.phone === '';
    const list = journal ? journalExtract(rows) : toClients(a.data, map);
    // группировка по телефону: одна запись — один клиент, визиты и заметки объединяются
    const byPhone = new Map(); let noPhone = 0;
    for (const c of list) {
      if (!c.norm) { noPhone++; continue; }
      const x = byPhone.get(c.norm);
      if (!x) { byPhone.set(c.norm, { ...c, notesAll: c.notes ? [c.notes] : [], cars: c.car || c.plate ? [[c.car, c.plate]] : [], visits: 1, sumAll: c.sum, dates: new Set(c.date ? [c.date] : []) }); continue; }
      if (c.date && x.dates.has(c.date) && x.notesAll.includes(c.notes)) continue; // тот же заказ на нескольких днях журнала
      if (c.date) x.dates.add(c.date); x.visits++; x.sumAll += c.sum; if (!x.name && c.name) x.name = c.name; if (c.date && (!x.date || c.date > x.date)) x.date = c.date;
      if (c.notes && !x.notesAll.includes(c.notes)) x.notesAll.push(c.notes);
      const lc = (v) => String(v || '').toLowerCase().replace(/\s+/g, '');
      if ((c.car || c.plate) && x.cars.length < 2 && !x.cars.some(([cc, pp]) => lc(cc) === lc(c.car) && pp === c.plate)) x.cars.push([c.car, c.plate]);
    }
    const uniq = [...byPhone.values()];
    const exist = new Set(uniq.filter((c) => get('SELECT 1 FROM clients WHERE phone_norm=?', c.norm)).map((c) => c.norm));
    const stats = { rows: list.length, clients: uniq.length, no_phone: noPhone, existing: exist.size, new: uniq.length - exist.size, merged: list.length - noPhone - uniq.length };
    if (b.mode !== 'commit') {
      return { ...stats, journal, header_row: a.header_row, headers: a.headers, map, fields: Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.t])),
        sample: a.data.slice(0, 8), preview: uniq.slice(0, 8).map((c) => ({ name: c.name, phone: c.phone, car: c.cars.map(([cc, pp]) => [cc, pp].filter(Boolean).join(' ')).join(', '), date: c.date, visits: c.visits, notes: c.notesAll.join('; ').slice(0, 120), exists: exist.has(c.norm) })) };
    }
    const source = String(b.source || 'Старая база').slice(0, 60);
    let added = 0, updated = 0;
    tx(() => {
      for (const c of uniq) {
        const notes = [c.notesAll.length ? 'Из старой базы: ' + c.notesAll.join('; ') : '', c.phone2 ? 'Доп. телефон: ' + c.phone2 : '', c.visits > 1 ? `Обращений в старой базе: ${c.visits}` : ''].filter(Boolean).join('\n').slice(0, 2000);
        const ex = get('SELECT * FROM clients WHERE phone_norm=?', c.norm);
        if (ex) {
          if (!b.update) continue; // по умолчанию существующих клиентов не трогаем
          run(`UPDATE clients SET name=CASE WHEN COALESCE(name,'')='' OR name='Клиент' THEN ? ELSE name END,
               notes=CASE WHEN ?='' OR COALESCE(notes,'') LIKE '%Из старой базы%' THEN notes ELSE TRIM(COALESCE(notes,'')||char(10)||?) END,
               legacy_visit=CASE WHEN ? IS NOT NULL AND (legacy_visit IS NULL OR legacy_visit<?) THEN ? ELSE legacy_visit END,
               legacy_spent=MAX(COALESCE(legacy_spent,0),?), birthday=COALESCE(birthday,?), email=COALESCE(email,?) WHERE id=?`,
          c.name || ex.name, notes, notes, c.date, c.date, c.date, c.sumAll, c.birthday, c.email || null, ex.id);
          for (const [car, plate] of c.cars) addCar(ex.id, car, plate);
          updated++; continue;
        }
        const id = Number(run('INSERT INTO clients(name,phone,phone_norm,email,source,birthday,notes,legacy_visit,legacy_spent) VALUES(?,?,?,?,?,?,?,?,?)',
          c.name || (c.cars[0] && c.cars[0][0] ? 'Клиент · ' + c.cars[0][0] : 'Клиент'), c.phone, c.norm, c.email || null, c.source || source, c.birthday, notes || null, c.date, c.sumAll || 0).lastInsertRowid);
        for (const [car, plate] of c.cars) addCar(id, car, plate);
        added++;
      }
    });
    return { ...stats, added, updated };
  });
}
function addCar(clientId, car, plate) {
  car = String(car || '').trim(); plate = String(plate || '').trim();
  if (!car && !plate) return;
  if (plate && get('SELECT 1 FROM cars WHERE client_id=? AND plate=?', clientId, plate)) return;
  const [brand, ...model] = car.split(/\s+/);
  if (!plate && get("SELECT 1 FROM cars WHERE client_id=? AND ulower(TRIM(COALESCE(brand,'')||' '||COALESCE(model,'')))=ulower(?)", clientId, car)) return;
  run('INSERT INTO cars(client_id,brand,model,plate) VALUES(?,?,?,?)', clientId, brand || null, model.join(' ') || null, plate || null);
}

module.exports = { migrate, register, table, analyze, toClients, dateOf, journalExtract };
