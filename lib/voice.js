'use strict';
// Голосовая запись: фраза администратора → клиент, автомобиль, услуга, товар, дата и время.
// Пример: «Алексей, Тойота Филдер 2017 год, установка автосигнализации StarLine E97 на 3 ноября 2026 года на 11 часов»
const { all, get, getSetting, normPhone } = require('./db');
const { NAMES } = require('./clientimport');

const MONTHS = { январ: 1, феврал: 2, март: 3, апрел: 4, ма: 5, июн: 6, июл: 7, август: 8, сентябр: 9, октябр: 10, ноябр: 11, наябр: 11, декабр: 12 };
const NUMW = { перв: 1, втор: 2, трет: 3, четверт: 4, пят: 5, шест: 6, седьм: 7, восьм: 8, девят: 9, десят: 10, одиннадцат: 11, двенадцат: 12,
  тринадцат: 13, четырнадцат: 14, пятнадцат: 15, шестнадцат: 16, семнадцат: 17, восемнадцат: 18, девятнадцат: 19, двадцат: 20, тридцат: 30 };
const HOURW = { час: 1, два: 2, двух: 2, три: 3, трех: 3, трёх: 3, четыре: 4, четырех: 4, пять: 5, пяти: 5, шесть: 6, шести: 6, семь: 7, семи: 7, восемь: 8, восьми: 8,
  девять: 9, девяти: 9, десять: 10, десяти: 10, одиннадцать: 11, одиннадцати: 11, двенадцать: 12, двенадцати: 12 };
const BRANDS = [
  [/тойот|toyota/, 'Toyota'], [/ниссан|nissan/, 'Nissan'], [/хонд|honda/, 'Honda'], [/мазд|mazda/, 'Mazda'], [/мицубиси|митсубиси|mitsubishi/, 'Mitsubishi'],
  [/субару|subaru/, 'Subaru'], [/лексус|lexus/, 'Lexus'], [/(?<![а-яёa-z0-9])киа(?![а-яёa-z0-9])|(?<![а-яёa-z0-9])kia(?![а-яёa-z0-9])/, 'Kia'], [/хендай|хёндай|хундай|хюндай|hyundai/, 'Hyundai'], [/(?<![а-яёa-z0-9])лад[аы](?![а-яёa-z0-9])|(?<![а-яёa-z0-9])lada(?![а-яёa-z0-9])|(?<![а-яёa-z0-9])ваз(?![а-яёa-z0-9])/, 'Lada'],
  [/(?<![а-яёa-z0-9])уаз(?![а-яёa-z0-9])|uaz/, 'УАЗ'], [/шевроле|chevrolet/, 'Chevrolet'], [/(?<![а-яёa-z0-9])форд|(?<![а-яёa-z0-9])ford/, 'Ford'], [/фольксваген|volkswagen|(?<![а-яёa-z0-9])vw(?![а-яёa-z0-9])/, 'Volkswagen'], [/шкод|skoda/, 'Skoda'],
  [/рено(?![а-яёa-z0-9])|renault/, 'Renault'], [/(?<![а-яёa-z0-9])бмв(?![а-яёa-z0-9])|(?<![а-яёa-z0-9])bmw(?![а-яёa-z0-9])/, 'BMW'], [/мерседес|mercedes/, 'Mercedes-Benz'], [/(?<![а-яёa-z0-9])ауди(?![а-яёa-z0-9])|(?<![а-яёa-z0-9])audi(?![а-яёa-z0-9])/, 'Audi'], [/джили|geely/, 'Geely'],
  [/чери(?![а-яёa-z0-9])|черри|chery/, 'Chery'], [/хавал|haval/, 'Haval'], [/сузуки|suzuki/, 'Suzuki'], [/инфинити|infiniti/, 'Infiniti'], [/дайхатсу|daihatsu/, 'Daihatsu'],
  [/исузу|isuzu/, 'Isuzu'], [/опель|opel/, 'Opel'], [/пежо|peugeot/, 'Peugeot'], [/ситроен|citroen/, 'Citroen'], [/вольво|volvo/, 'Volvo'], [/порше|porsche/, 'Porsche'],
  [/ленд ровер|land rover|рендж|range rover/, 'Land Rover'], [/тесла|tesla/, 'Tesla'], [/эксид|exeed/, 'Exeed'], [/омода|omoda/, 'Omoda'], [/джетур|jetour/, 'Jetour'],
  [/танк(?![а-яёa-z0-9])|tank/, 'Tank'], [/чанган|changan/, 'Changan'], [/газ(?![а-яёa-z0-9])|газель/, 'ГАЗ'], [/джип|jeep/, 'Jeep'], [/дэу|daewoo/, 'Daewoo'], [/ssang|санг ?йонг/, 'SsangYong'],
];
const MODELS = {
  филдер: 'Fielder', королла: 'Corolla', камри: 'Camry', приус: 'Prius', аксио: 'Axio', премио: 'Premio', аллион: 'Allion', 'ленд крузер': 'Land Cruiser', прадо: 'Prado',
  'рав 4': 'RAV4', рав4: 'RAV4', 'марк 2': 'Mark II', витц: 'Vitz', виц: 'Vitz', харриер: 'Harrier', хайс: 'HiAce', хайэйс: 'HiAce', ипсум: 'Ipsum', виш: 'Wish', ноах: 'Noah',
  вокси: 'Voxy', альфард: 'Alphard', алфард: 'Alphard', хайлюкс: 'Hilux', хайлакс: 'Hilux', спринтер: 'Sprinter', калдина: 'Caldina', креста: 'Cresta', чайзер: 'Chaser',
  солярис: 'Solaris', крета: 'Creta', туссан: 'Tucson', туксон: 'Tucson', рио: 'Rio', спортейдж: 'Sportage', веста: 'Vesta', гранта: 'Granta', приора: 'Priora', калина: 'Kalina',
  нива: 'Niva', патриот: 'Patriot', 'икс трейл': 'X-Trail', 'х трейл': 'X-Trail', ноут: 'Note', тиида: 'Tiida', кашкай: 'Qashqai', альмера: 'Almera', теана: 'Teana', серена: 'Serena',
  фит: 'Fit', 'цр в': 'CR-V', срв: 'CR-V', степвагон: 'StepWGN', стрим: 'Stream', демио: 'Demio', аксела: 'Axela', атенза: 'Atenza', форестер: 'Forester',
  импреза: 'Impreza', легаси: 'Legacy', аутбек: 'Outback', оутбек: 'Outback', фокус: 'Focus', мондео: 'Mondeo', поло: 'Polo', тигуан: 'Tiguan', октавия: 'Octavia', рапид: 'Rapid',
  логан: 'Logan', дастер: 'Duster', сандеро: 'Sandero', тигго: 'Tiggo', монжаро: 'Monjaro', кулрей: 'Coolray', аутлендер: 'Outlander', паджеро: 'Pajero', лансер: 'Lancer',
  круз: 'Cruze', лачетти: 'Lacetti', нексия: 'Nexia', матиз: 'Matiz', джолион: 'Jolion', 'f7': 'F7', 'x5': 'X5', 'x3': 'X3', 'rx': 'RX',
};
const PROD_BRANDS = [[/старлайн|стар лайн|starline/, 'starline'], [/пандора|pandora|пандект|pandect/, 'pandora'], [/teyes|тейс|тиес/, 'teyes']];
const LAT = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 's', т: 't', у: 'y', х: 'x', д: 'd', и: 'i', л: 'l', г: 'g', ф: 'f' };
const cap = (w) => w ? w[0].toUpperCase() + w.slice(1) : w;
const lc = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const pad = (n) => String(n).padStart(2, '0');

function parseDate(t, now = new Date()) {
  let y = null, m = null, d = null, h = null, mi = 0, rest = t;
  const take = (re) => { const x = re.exec(rest); if (x) rest = rest.replace(x[0], ' '); return x; };
  // время: «в 11 часов», «на 11:30», «в 15-00», «в полдвенадцатого» (упрощённо), «в два часа»
  const TRE = /(?:(?<![а-яёa-z0-9])в|(?<![а-яёa-z0-9])на|(?<![а-яёa-z0-9])к)\s+(\d{1,2})(?:[:.\-\s](\d{2}))?\s*(?:час(?:ов|а)?|ч(?![а-яёa-z0-9]))?(?:\s*(утра|дня|вечера))?(?=\s|$|,|\.)/g;
  let x = null;
  for (const c of rest.matchAll(TRE)) if (c[2] || /час|ч(?![а-яёa-z0-9])|утра|дня|вечера/.test(c[0]) || +c[1] >= 7) { x = c; break; }
  if (x) { rest = rest.replace(x[0], ' '); h = +x[1]; mi = x[2] ? +x[2] : 0; if (x[3] === 'вечера' || (x[3] === 'дня' && h < 12)) h = h < 12 ? h + 12 : h; }
  if (h === null) { x = take(/(?:(?<![а-яёa-z0-9])в|(?<![а-яёa-z0-9])на|(?<![а-яёa-z0-9])к)\s+([а-я]+)\s+час/); if (x && HOURW[x[1]]) h = HOURW[x[1]]; }
  if (h === null) { x = take(/(?<![0-9])(\d{1,2}):(\d{2})/); if (x) { h = +x[1]; mi = +x[2]; } }
  // дата: «3 ноября 2026», «третьего ноября», «03.11.2026», «завтра», «послезавтра», «в понедельник»
  x = take(/(?<![а-яёa-z0-9.])(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?(?![0-9])/);
  if (x) { d = +x[1]; m = +x[2]; if (x[3]) y = +x[3] < 100 ? 2000 + +x[3] : +x[3]; }
  if (!d) {
    x = take(/(?<![а-яёa-z0-9])(\d{1,2}|[а-я]+(?:\s+[а-я]+)?)\s+(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|наябр|декабр)[а-я]*(?:\s+(\d{4})\s*(?:г(?:ода|од)?\.?)?)?/);
    if (x) {
      let dd = /^\d+$/.test(x[1]) ? +x[1] : 0;
      if (!dd) { for (const part of x[1].split(/\s+/)) for (const [k, v] of Object.entries(NUMW)) if (part.startsWith(k)) dd += v; }
      if (dd) { d = dd; m = MONTHS[x[2].startsWith('ма') ? 'ма' : x[2]] || Object.entries(MONTHS).find(([k]) => x[2].startsWith(k))?.[1]; if (x[3]) y = +x[3]; }
    }
  }
  if (!d) {
    const base = new Date(now); let add = null;
    if (take(/послезавтра/)) add = 2; else if (take(/завтра/)) add = 1; else if (take(/сегодня/)) add = 0;
    const wd = take(/(?:(?<![а-яёa-z0-9])в|(?<![а-яёa-z0-9])во)\s+(понедельник|вторник|сред[уа]|четверг|пятниц[уа]|суббот[уа]|воскресенье)/);
    if (wd) { const idx = ['воскресенье', 'понедельник', 'вторник', 'сред', 'четверг', 'пятниц', 'суббот'].findIndex((w) => wd[1].startsWith(w)); add = ((idx - base.getDay()) + 7) % 7 || 7; }
    if (add !== null) { base.setDate(base.getDate() + add); d = base.getDate(); m = base.getMonth() + 1; y = base.getFullYear(); }
  }
  if (d && m && !y) { y = now.getFullYear(); const cand = new Date(y, m - 1, d, 23, 59); if (cand < now) y++; }
  if (h !== null) { const ws = +(getSetting('work_start', '09:00').split(':')[0]); if (h < ws && h + 12 <= 21) h += 12; }
  const date = d && m && y ? `${y}-${pad(m)}-${pad(d)}` : null;
  return { date, time: h !== null ? `${pad(h)}:${pad(mi)}` : null, rest };
}

function stem(w) { return lc(w).replace(/^авто(?=сигнал)/, '').slice(0, 6); }
const STOP = new Set(['на', 'в', 'и', 'с', 'по', 'для', 'к', 'от', 'год', 'года', 'году', 'запиши', 'запись', 'записать', 'сделай', 'клиент', 'клиента', 'часов', 'часа', 'машина', 'автомобиль']);

function parse(text, now = new Date()) {
  const raw = String(text || '').trim();
  let t = ' ' + lc(raw).replace(/[«»"]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const out = { text: raw, client: {}, car: {}, scheduled_at: null, service: null, product: null, notes: [] };
  // телефон
  const ph = t.match(/(?:\+7|8|7)?[\s\-(]*9\d{2}[\s\-)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/);
  if (ph) { const n = normPhone(ph[0]); if (n.length === 11) { out.client.phone = '+' + n; t = t.replace(ph[0], ' '); } }
  // год выпуска: «2017 год(а)», «17-го года» перед датой не путаем — берём 4 цифры рядом со словом «год», иначе 19xx/20xx до названия месяца
  let ym = t.match(/(?<![а-яёa-z0-9])(19[89]\d|20[0-3]\d)\s*(?:-?го)?\s*(?:г\.?|год[а]?(?:\s+выпуска)?)(?=\s|,|$)/);
  if (ym && !new RegExp('(январ|феврал|март|апрел|ма[яй]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-я]*\\s+' + ym[1]).test(t)) { out.car.year = +ym[1]; t = t.replace(ym[0], ' '); }
  // дата и время
  const dt = parseDate(t, now); t = dt.rest;
  if (dt.date) out.scheduled_at = dt.date + 'T' + (dt.time || '10:00');
  if (dt.date && !dt.time) out.notes.push('Время не названо — поставлено 10:00');
  // марка и модель
  for (const [re, name] of BRANDS) {
    const mm = re.exec(t); if (!mm) continue;
    out.car.brand = name; t = t.replace(mm[0], ' ');
    const after = t.slice(mm.index).trim().split(/[\s,]+/).slice(0, 3).join(' ');
    for (const [k, v] of Object.entries(MODELS).sort((a, b) => b[0].length - a[0].length)) { if ((' ' + after + ' ').includes(' ' + k + ' ') || after.startsWith(k + ' ') || after === k) { out.car.model = v; t = t.replace(k, ' '); break; } }
    if (!out.car.model) { const w = (after.split(' ')[0] || '').replace(/[^а-яa-z0-9\-]/g, ''); if (w && !STOP.has(w) && !/^(установ|замен|диагност|настрой)/.test(w)) { out.car.model = cap(w); t = t.replace(w, ' '); } }
    break;
  }
  if (!out.car.brand) { for (const [k, v] of Object.entries(MODELS).sort((a, b) => b[0].length - a[0].length)) if (t.includes(' ' + k + ' ')) { out.car.model = v; t = t.replace(k, ' '); break; } }
  // имя клиента: первое слово-имя из словаря (или после «клиент»)
  const words = t.split(/[\s,.]+/).filter(Boolean);
  const nmIdx = words.findIndex((w) => NAMES.has(w));
  if (nmIdx >= 0) {
    out.client.name = cap(words[nmIdx]);
    const next = words[nmIdx + 1];
    if (next && /(ов|ев|ин|ын|ский|цкий|ова|ева|ина|ская)$/.test(next) && !BRANDS.some(([re]) => re.test(next))) out.client.name += ' ' + cap(next);
    t = t.replace(new RegExp('(?<![а-яa-z])' + words[nmIdx] + '(?![а-яa-z])'), ' ');
  }
  // товар из каталога: бренд + код модели (E97, A93, S96, DX 9x…)
  const pb = PROD_BRANDS.find(([re]) => re.test(t));
  if (pb) {
    const latin = t.replace(/[а-я]/g, (c) => LAT[c] || c).replace(/икс/g, 'x');
    const code = []; for (const m of latin.matchAll(/(?<![a-z])([a-z]{1,3})\s?-?\s?(\d{1,4})([a-z]{0,2})(?![a-z])/g)) { code.push(m[1] + m[2] + m[3]); if (m[3]) code.push(m[1] + m[2]); }
    const extras = ['eco', 'эко', 'lora', 'лора', 'gsm', 'gps', 'lte', 'bt', 'v2', 'v3', 'fd'].filter((e) => t.includes(e)).map((e) => ({ эко: 'eco', лора: 'lora' }[e] || e));
    const prods = all("SELECT id,name,price,brand FROM products WHERE active=1 AND (ulower(brand) LIKE ? OR ulower(name) LIKE ?)", '%' + pb[1] + '%', '%' + pb[1] + '%');
    const norm = (s) => lc(s).replace(/[\s\-_.]/g, '');
    let best = null, bestScore = 0;
    for (const p of prods) {
      const n = norm(p.name.split(',')[0]);
      let sc = 0;
      for (const c of code) { const cc = norm(c); if (cc.length >= 2 && n.includes(cc)) sc += 10 + cc.length; }
      for (const e of extras) if (n.includes(e)) sc += 2;
      if (!sc) continue;
      sc -= n.length / 100; // при равенстве — более короткое (базовая) название
      if (sc > bestScore) { bestScore = sc; best = p; }
    }
    if (best) out.product = { id: best.id, name: best.name, price: best.price };
    else out.notes.push('Оборудование из фразы не найдено в каталоге — добавьте вручную');
  }
  // услуга из прайса: по совпадению основ слов
  const tokens = lc(raw).split(/[^а-яa-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)).map(stem);
  let svc = null, svcScore = 0;
  const ORIGIN = [[/^(Toyota|Nissan|Honda|Mazda|Mitsubishi|Subaru|Lexus|Suzuki|Infiniti|Daihatsu|Isuzu)$/, /япон/],
    [/^(Geely|Chery|Haval|Exeed|Omoda|Jetour|Tank|Changan)$/, /кита/], [/^(Mercedes-Benz|BMW|Porsche|Land Rover)$/, /(?<![a-z])mb(?![a-z])/],
    [/^(Volkswagen|Skoda|Audi|Opel|Peugeot|Citroen|Volvo|Ford|Renault)$/, /европ|пассат|ауди/]];
  const region = out.car.brand ? (ORIGIN.find(([re]) => re.test(out.car.brand)) || [])[1] : null;
  for (const s of all('SELECT id,name,price,duration_min FROM services WHERE active=1')) {
    const st = [...new Set(lc(s.name).split(/[^а-яa-z0-9]+/).filter((w) => w.length > 3).map(stem))];
    const sc = st.filter((w) => tokens.includes(w)).length;
    let score = sc ? sc - st.length / 100 : 0;
    if (sc && region && region.test(lc(s.name))) score += 0.6; // «Япония», «Китай», «MB»… под марку автомобиля
    else if (sc && ORIGIN.some(([, rr]) => rr.test(lc(s.name)))) score -= 0.2; // чужая категория машин
    if (sc && !region && /стандарт(?!\+)/.test(lc(s.name))) score += 0.3; // марка неизвестна — базовый вариант
    if (sc && /доп\.|модул|чуж/.test(lc(s.name)) && !/модул/.test(lc(raw))) score -= 0.5;
    if (score > svcScore) { svcScore = score; svc = s; }
  }
  if (svc && svcScore >= 0.9) out.service = { id: svc.id, name: svc.name, price: svc.price, duration_min: svc.duration_min };
  // клиент в базе: по телефону, иначе по имени (если такой один)
  if (out.client.phone) { const c = get('SELECT id,name,phone FROM clients WHERE phone_norm=?', normPhone(out.client.phone)); if (c) out.client = { ...out.client, id: c.id, name: c.name, found: 'phone' }; }
  if (!out.client.id && out.client.name) {
    const list = all("SELECT c.id,c.name,c.phone FROM clients c WHERE ulower(c.name) LIKE ? LIMIT 20", lc(out.client.name) + '%');
    const withCar = out.car.brand ? list.filter((c) => get("SELECT 1 FROM cars WHERE client_id=? AND ulower(COALESCE(brand,'')) LIKE ?", c.id, lc(out.car.brand) + '%')) : [];
    const pick = withCar.length === 1 ? withCar[0] : list.length === 1 ? list[0] : null;
    if (pick) out.client = { ...out.client, id: pick.id, name: pick.name, phone: pick.phone, found: 'name' };
    else if (list.length > 1) out.client.matches = list.slice(0, 8);
  }
  if (out.client.id && (out.car.brand || out.car.model)) {
    const car = get("SELECT id,brand,model,year FROM cars WHERE client_id=? AND ulower(COALESCE(brand,'')||' '||COALESCE(model,'')) LIKE ?", out.client.id, '%' + lc(out.car.model || out.car.brand) + '%');
    if (car) out.car = { ...out.car, id: car.id };
  }
  if (!out.client.name && !out.client.id) out.notes.push('Имя клиента не распознано');
  if (!out.scheduled_at) out.notes.push('Дата записи не распознана');
  return out;
}

function register(r, OFFICE) {
  r.post('/api/voice/parse', OFFICE, (ctx) => parse(ctx.body.text));
}

module.exports = { parse, parseDate, register };
