'use strict';
// Печатные формы: заказ-наряд, акт выполненных работ, гарантийный талон
const { getSetting } = require('./db');

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => (Math.round((n || 0) * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (s) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '');

// Сумма прописью
function rubWords(n) {
  const rub = Math.floor(n); const kop = Math.round((n - rub) * 100);
  const ones = [['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'], ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  const plural = (x, f) => { const a = x % 100, b = x % 10; return a > 10 && a < 20 ? f[2] : b === 1 ? f[0] : b >= 2 && b <= 4 ? f[1] : f[2]; };
  const groups = [[['рубль', 'рубля', 'рублей'], 0], [['тысяча', 'тысячи', 'тысяч'], 1], [['миллион', 'миллиона', 'миллионов'], 0], [['миллиард', 'миллиарда', 'миллиардов'], 0]];
  const tri = (x, g) => {
    const w = [hundreds[Math.floor(x / 100)]]; const t = x % 100;
    if (t >= 10 && t < 20) w.push(teens[t - 10]); else { w.push(tens[Math.floor(t / 10)]); w.push(ones[g][t % 10]); }
    return w.filter(Boolean).join(' ');
  };
  if (rub === 0) return `ноль рублей ${String(kop).padStart(2, '0')} копеек`;
  const parts = []; let x = rub, gi = 0;
  while (x > 0 && gi < groups.length) {
    const g = x % 1000;
    if (g || gi === 0) parts.unshift((g ? tri(g, groups[gi][1]) + ' ' : '') + plural(g, groups[gi][0]));
    x = Math.floor(x / 1000); gi++;
  }
  let s = parts.join(' ').replace(/\s+/g, ' ').trim();
  s = s[0].toUpperCase() + s.slice(1);
  return `${s} ${String(kop).padStart(2, '0')} ${plural(kop, ['копейка', 'копейки', 'копеек'])}`;
}

// Логотип студии (шапка печатных форм). Шрифт Unbounded подключается с Google Fonts, без интернета — Arial Black
const LOGO_SVG = `<svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="100 160 970 240" role="img" aria-label="Бумсистем — тюнинг-ателье с сибирским характером">
<g transform="translate(110,170)"><circle cx="110" cy="110" r="104" fill="none" stroke="#000" stroke-width="8"/>
<g fill="#000"><circle cx="110" cy="22" r="5"/><circle cx="198" cy="110" r="5"/><circle cx="110" cy="198" r="5"/><circle cx="22" cy="110" r="5"/><circle cx="172.2" cy="47.8" r="5"/><circle cx="172.2" cy="172.2" r="5"/><circle cx="47.8" cy="172.2" r="5"/><circle cx="47.8" cy="47.8" r="5"/></g>
<circle cx="110" cy="110" r="78" fill="#000"/><circle cx="110" cy="110" r="62" fill="#fff"/><circle cx="110" cy="110" r="50" fill="none" stroke="#000" stroke-width="4"/>
<circle cx="110" cy="110" r="38" fill="none" stroke="#000" stroke-width="3"/><circle cx="110" cy="110" r="24" fill="#000"/><circle cx="102" cy="102" r="6" fill="#fff"/></g>
<text class="lw" x="370" y="300" textLength="690" lengthAdjust="spacingAndGlyphs">БУМСИСТЕМ</text><rect x="372" y="336" width="48" height="6" fill="#000"/>
<text class="lt" x="436" y="345" textLength="560" lengthAdjust="spacing">ТЮНИНГ-АТЕЛЬЕ С СИБИРСКИМ ХАРАКТЕРОМ</text><rect x="1012" y="336" width="48" height="6" fill="#000"/></svg>`;
const FONTS = '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@400;900&display=swap">';

function header(title, o) {
  const company = getSetting('company_name'); const sub = getSetting('company_subtitle');
  const req = [getSetting('company_address'), getSetting('company_phone'), getSetting('company_inn') ? 'ИНН ' + getSetting('company_inn') : ''].filter(Boolean).join(' · ');
  return `<div class="head"><div>${LOGO_SVG}<div class="muted small">${esc(req)}</div>
    ${getSetting('company_requisites') ? `<div class="muted small">${esc(getSetting('company_requisites'))}</div>` : ''}</div>
    <div class="right"><h1>${title}</h1><div>№ <b>${esc(o.number)}</b> от ${dmy(o.created_at)}</div></div></div>`;
}

function carBlock(o) {
  return `<table class="kv"><tr><td>Заказчик</td><td><b>${esc(o.client_name)}</b> ${esc(o.client_phone || '')}</td>
    <td>Автомобиль</td><td><b>${esc([o.brand, o.model].filter(Boolean).join(' '))}</b> ${o.year ? esc(o.year) + ' г.' : ''}</td></tr>
    <tr><td>Гос. номер</td><td>${esc(o.plate || '—')}</td><td>VIN</td><td>${esc(o.vin || '—')}</td></tr>
    <tr><td>Пробег</td><td>${o.mileage ? esc(o.mileage) + ' км' : '—'}</td><td>Мастер</td><td>${esc(o.master_name || '—')}</td></tr></table>`;
}

function itemsTable(o, opts = {}) {
  const rows = (kind) => o.items.filter((i) => i.kind === kind);
  const tbl = (list, title) => !list.length ? '' : `<h3>${title}</h3><table class="items"><thead><tr><th>№</th><th>Наименование</th><th>Кол-во</th><th>Цена, ₽</th><th>Сумма, ₽</th>${opts.warranty ? '<th>Гарантия</th>' : ''}</tr></thead><tbody>
    ${list.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td class="c">${i.qty}</td><td class="r">${money(i.price)}</td><td class="r">${money(i.qty * i.price)}</td>${opts.warranty ? `<td class="c">${i.warranty_months ? i.warranty_months + ' мес.' : '—'}</td>` : ''}</tr>`).join('')}
    </tbody></table>`;
  const t = o.totals;
  return tbl(rows('service'), 'Работы') + tbl(rows('product'), 'Товары и материалы') +
    `<table class="totals"><tr><td>Работы</td><td>${money(t.services)}</td></tr><tr><td>Товары</td><td>${money(t.goods)}</td></tr>
    ${t.discount ? `<tr><td>Скидка ${o.discount_percent}%</td><td>−${money(t.discount)}</td></tr>` : ''}
    <tr class="big"><td>Итого</td><td>${money(t.total)} ₽</td></tr>
    ${o.cashless_markup ? `<tr><td class="small">При безналичной оплате (+${o.cashless_markup}%)</td><td class="small">${money(t.total * (1 + o.cashless_markup / 100))} ₽</td></tr>` : ''}
    ${opts.paid ? `<tr><td>Оплачено</td><td>${money(t.paid)}</td></tr><tr><td>К оплате</td><td>${money(Math.max(t.due, 0))}</td></tr>` : ''}</table>`;
}

const CSS = `*{box-sizing:border-box}body{font:13px/1.4 Arial,Helvetica,sans-serif;color:#111;margin:0;padding:24px;max-width:820px;margin:auto}
h1{font-size:20px;margin:0 0 4px}h3{font-size:14px;margin:18px 0 6px}.head{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px;gap:20px}
.right{text-align:right}svg.logo{display:block;width:290px;height:auto;margin:0 0 6px -2px}svg.logo .lw{font-family:'Unbounded','Arial Black',Arial,sans-serif;font-weight:900;font-size:80px;letter-spacing:-2px}svg.logo .lt{font-family:'Unbounded',Arial,sans-serif;font-weight:400;font-size:16px;letter-spacing:3px}.brand{font-size:22px;font-weight:800;letter-spacing:.5px}.muted{color:#555}.small{font-size:11px}
table{width:100%;border-collapse:collapse}.kv td{padding:4px 6px;border:1px solid #bbb}.kv td:nth-child(odd){color:#555;width:14%;white-space:nowrap}
.items th,.items td{border:1px solid #999;padding:5px 6px}.items th{background:#eee;font-size:12px}.c{text-align:center}.r{text-align:right;white-space:nowrap}
.totals{width:46%;margin:12px 0 0 auto}.totals td{padding:3px 6px}.totals td:last-child{text-align:right}.totals .big td{font-size:16px;font-weight:700;border-top:2px solid #111}
.box{border:1px solid #bbb;padding:8px 10px;margin-top:10px;min-height:40px}.terms{font-size:11px;color:#333;margin-top:14px}
.sign{display:flex;justify-content:space-between;gap:30px;margin-top:36px}.sign div{flex:1;border-top:1px solid #111;padding-top:4px;font-size:11px;color:#555}
.checks{display:grid;grid-template-columns:repeat(3,1fr);gap:3px 12px;font-size:12px}.checks.row5{grid-template-columns:repeat(5,1fr)}
.cb{display:inline-block;width:12px;height:12px;border:1px solid #333;font-size:10px;line-height:12px;text-align:center;vertical-align:-2px;margin-right:4px}
.cut{border-top:1px dashed #999;margin:30px 0}.noprint{position:fixed;bottom:16px;right:16px}.noprint button{font-size:14px;padding:8px 16px;cursor:pointer}
@media print{.noprint{display:none}body{padding:0}@page{margin:12mm}}`;

// ---------- Акт приёма автомобиля в работу ----------
const KIT = ['Ключ / брелок', 'Документы (СТС)', 'Запасное колесо', 'Домкрат, инструмент', 'Коврики', 'Аптечка, знак, огнетушитель', 'Штатная магнитола / панель', 'Видеорегистратор', 'Антенна', 'Подголовники', 'Шторка / полка багажника', 'Колпаки колёс'];
const WORKS = ['Штатная аудиосистема', 'Все динамики', 'Магнитола / экран', 'Камера заднего вида', 'Стеклоподъёмники', 'Центральный замок', 'Сигнализация / автозапуск', 'Освещение салона', 'Внешние световые приборы', 'Ошибки на приборной панели отсутствуют', 'Двигатель заводится', 'Кондиционер / климат'];
const FUEL = ['0', '¼', '½', '¾', 'Полный'];

// Схема кузова (обобщённый седан, 5 проекций) для отметки повреждений ручкой
// Схема седана: 5 видов в едином масштабе (обобщённый автомобиль, не конкретная модель)
const CAR_SVG = `<svg class="cs" viewBox="0 0 700 278" width="100%" style="max-width:700px;display:block;margin:6px auto" fill="none" stroke="#222" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" font-family="Arial" font-size="10"><style>.cs .b{fill:#fff;stroke-width:1.4}.cs .g{fill:#e3eaf0;stroke-width:1}.cs .p{fill:#2b2b2b}.cs .t{stroke-width:.8}.cs .w{fill:#fff;stroke-width:1}.cs .l{fill:#f1f1f1;stroke-width:.9}</style><g><path class="b" d="M34.4,100.4 C27.5,99.2 25.2,92.9 25.2,85.3 C25.2,76.0 26.3,70.2 31.5,67.3
 C36.8,64.4 43.7,63.3 54.2,62.1 C76.2,59.8 99.4,57.5 120.3,55.2
 C134.2,48.2 148.7,36.6 164.4,30.8 C180.6,26.2 209.6,26.2 227.0,29.6
 C243.2,33.1 257.2,43.6 268.8,49.9 C285.0,50.5 299.5,50.5 308.2,52.3
 C312.3,53.4 313.4,56.9 313.4,61.5 L312.8,85.3 C312.3,94.6 309.4,99.2 302.4,100.4
 L269.8,100.4 A22.9,22.9 0 1 0 227.1,100.4 L98.7,100.4 A22.9,22.9 0 1 0 56.0,100.4 Z"/>
<path class="g" d="M128.4,53.4 C140.0,45.9 151.6,36.6 166.1,32.5 C174.8,30.2 183.5,29.6 191.0,29.6 L192.2,52.8 Z"/>
<path class="g" d="M197.4,29.6 C209.6,29.6 222.4,31.4 231.6,34.9 C241.5,38.9 250.2,45.3 256.0,49.4 L198.0,52.3 Z"/>
<path class="p" d="M191.0,29.6 L197.4,29.6 L198.0,52.3 L192.2,52.8 Z"/>
<path class="t" d="M123.8,54.0 C174.8,53.4 221.2,51.7 261.8,49.4"/>
<path class="t" d="M33.3,66.2 C116.8,62.1 221.2,59.8 311.7,57.5"/>
<path class="t" d="M101.6,94.6 C151.6,95.2 192.2,95.2 224.2,94.6"/>
<path class="t" d="M126.1,54.0 C124.3,68.5 124.9,83.0 128.4,100.4"/>
<path class="t" d="M195.1,52.3 L195.1,100.4"/>
<path class="t" d="M256.0,49.4 L254.3,65.6 A27.3,27.3 0 0 0 222.5,100.4"/>
<path d="M169.0,61.5 h11.6 M229.9,59.8 h11.6" stroke-width="2.2"/>
<path class="w" d="M131.9,54.0 C129.6,49.9 131.9,45.9 138.3,45.9 L147.0,47.0 C149.3,49.9 147.0,53.4 142.3,54.0 Z"/>
<path class="l" d="M28.6,69.1 C38.5,65.6 53.0,63.9 69.2,61.5 L66.9,65.6 C53.0,66.8 38.5,69.1 26.9,73.1 Z"/>
<path class="l" d="M290.8,51.7 L312.8,54.6 L313.4,61.5 L293.1,58.1 Z"/>
<path class="t" d="M25.7,88.8 C35.6,90.0 46.0,89.4 53.0,87.6 M285.0,94.6 L310.5,93.4"/>
<rect class="t" x="273.4" y="62.1" width="9.3" height="7.0" rx="1.5"/><circle cx="77.4" cy="92.0" r="20.0" fill="#3a3a3a"/><circle cx="77.4" cy="92.0" r="14.0" fill="#fff" stroke-width="1"/><path d="M76.4,88.7 L75.4,79.1 L79.3,79.1 L78.3,88.7 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M80.2,90.1 L89.0,86.2 L90.2,89.9 L80.8,91.9 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M80.0,94.1 L86.5,101.3 L83.3,103.5 L78.5,95.2 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M76.2,95.2 L71.4,103.5 L68.2,101.3 L74.7,94.1 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M74.0,91.9 L64.5,89.9 L65.7,86.2 L74.5,90.1 Z" fill="#cfd4d8" stroke-width="0.8"/><circle cx="77.4" cy="92.0" r="3.0" fill="#cfd4d8" stroke-width="0.9"/><circle cx="248.5" cy="92.0" r="20.0" fill="#3a3a3a"/><circle cx="248.5" cy="92.0" r="14.0" fill="#fff" stroke-width="1"/><path d="M247.5,88.7 L246.5,79.1 L250.4,79.1 L249.4,88.7 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M251.3,90.1 L260.1,86.2 L261.3,89.9 L251.9,91.9 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M251.1,94.1 L257.6,101.3 L254.4,103.5 L249.6,95.2 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M247.3,95.2 L242.5,103.5 L239.3,101.3 L245.8,94.1 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M245.1,91.9 L235.6,89.9 L236.8,86.2 L245.6,90.1 Z" fill="#cfd4d8" stroke-width="0.8"/><circle cx="248.5" cy="92.0" r="3.0" fill="#cfd4d8" stroke-width="0.9"/></g><text x="169.0" y="128" text-anchor="middle" fill="#555" stroke="none">Левая сторона</text><g transform="translate(700,0) scale(-1,1)"><path class="b" d="M34.4,100.4 C27.5,99.2 25.2,92.9 25.2,85.3 C25.2,76.0 26.3,70.2 31.5,67.3
 C36.8,64.4 43.7,63.3 54.2,62.1 C76.2,59.8 99.4,57.5 120.3,55.2
 C134.2,48.2 148.7,36.6 164.4,30.8 C180.6,26.2 209.6,26.2 227.0,29.6
 C243.2,33.1 257.2,43.6 268.8,49.9 C285.0,50.5 299.5,50.5 308.2,52.3
 C312.3,53.4 313.4,56.9 313.4,61.5 L312.8,85.3 C312.3,94.6 309.4,99.2 302.4,100.4
 L269.8,100.4 A22.9,22.9 0 1 0 227.1,100.4 L98.7,100.4 A22.9,22.9 0 1 0 56.0,100.4 Z"/>
<path class="g" d="M128.4,53.4 C140.0,45.9 151.6,36.6 166.1,32.5 C174.8,30.2 183.5,29.6 191.0,29.6 L192.2,52.8 Z"/>
<path class="g" d="M197.4,29.6 C209.6,29.6 222.4,31.4 231.6,34.9 C241.5,38.9 250.2,45.3 256.0,49.4 L198.0,52.3 Z"/>
<path class="p" d="M191.0,29.6 L197.4,29.6 L198.0,52.3 L192.2,52.8 Z"/>
<path class="t" d="M123.8,54.0 C174.8,53.4 221.2,51.7 261.8,49.4"/>
<path class="t" d="M33.3,66.2 C116.8,62.1 221.2,59.8 311.7,57.5"/>
<path class="t" d="M101.6,94.6 C151.6,95.2 192.2,95.2 224.2,94.6"/>
<path class="t" d="M126.1,54.0 C124.3,68.5 124.9,83.0 128.4,100.4"/>
<path class="t" d="M195.1,52.3 L195.1,100.4"/>
<path class="t" d="M256.0,49.4 L254.3,65.6 A27.3,27.3 0 0 0 222.5,100.4"/>
<path d="M169.0,61.5 h11.6 M229.9,59.8 h11.6" stroke-width="2.2"/>
<path class="w" d="M131.9,54.0 C129.6,49.9 131.9,45.9 138.3,45.9 L147.0,47.0 C149.3,49.9 147.0,53.4 142.3,54.0 Z"/>
<path class="l" d="M28.6,69.1 C38.5,65.6 53.0,63.9 69.2,61.5 L66.9,65.6 C53.0,66.8 38.5,69.1 26.9,73.1 Z"/>
<path class="l" d="M290.8,51.7 L312.8,54.6 L313.4,61.5 L293.1,58.1 Z"/>
<path class="t" d="M25.7,88.8 C35.6,90.0 46.0,89.4 53.0,87.6 M285.0,94.6 L310.5,93.4"/>
<rect class="t" x="273.4" y="62.1" width="9.3" height="7.0" rx="1.5"/><circle cx="77.4" cy="92.0" r="20.0" fill="#3a3a3a"/><circle cx="77.4" cy="92.0" r="14.0" fill="#fff" stroke-width="1"/><path d="M76.4,88.7 L75.4,79.1 L79.3,79.1 L78.3,88.7 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M80.2,90.1 L89.0,86.2 L90.2,89.9 L80.8,91.9 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M80.0,94.1 L86.5,101.3 L83.3,103.5 L78.5,95.2 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M76.2,95.2 L71.4,103.5 L68.2,101.3 L74.7,94.1 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M74.0,91.9 L64.5,89.9 L65.7,86.2 L74.5,90.1 Z" fill="#cfd4d8" stroke-width="0.8"/><circle cx="77.4" cy="92.0" r="3.0" fill="#cfd4d8" stroke-width="0.9"/><circle cx="248.5" cy="92.0" r="20.0" fill="#3a3a3a"/><circle cx="248.5" cy="92.0" r="14.0" fill="#fff" stroke-width="1"/><path d="M247.5,88.7 L246.5,79.1 L250.4,79.1 L249.4,88.7 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M251.3,90.1 L260.1,86.2 L261.3,89.9 L251.9,91.9 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M251.1,94.1 L257.6,101.3 L254.4,103.5 L249.6,95.2 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M247.3,95.2 L242.5,103.5 L239.3,101.3 L245.8,94.1 Z" fill="#cfd4d8" stroke-width="0.8"/><path d="M245.1,91.9 L235.6,89.9 L236.8,86.2 L245.6,90.1 Z" fill="#cfd4d8" stroke-width="0.8"/><circle cx="248.5" cy="92.0" r="3.0" fill="#cfd4d8" stroke-width="0.9"/></g><text x="531.0" y="128" text-anchor="middle" fill="#555" stroke="none">Правая сторона</text><path class="b" d="M25.2,194.0 C24.0,170.8 26.3,148.8 35.6,143.0 C44.3,140.1 58.8,139.8 82.0,139.8 L273.4,139.8 C296.6,139.8 308.2,141.8 311.7,147.6 C314.0,159.2 314.0,176.6 314.0,194.0 C314.0,211.4 314.0,228.8 311.7,240.4 C308.2,246.2 296.6,248.2 273.4,248.2 L82.0,248.2 C58.8,248.2 44.3,247.9 35.6,245.0 C26.3,239.2 24.0,217.2 25.2,194.0 Z"/><path class="g" d="M121.4,194.0  C121.4,170.8 122.6,152.2 124.9,147.6 L162.0,155.7 C160.9,176.6 160.9,185.3 160.9,194.0 C160.9,202.7 160.9,211.4 162.0,232.3 L124.9,240.4 C122.6,235.8 121.4,217.2 121.4,194.0 Z"/><path class="g" d="M229.9,194.0 L229.9,155.7 L264.7,149.9 C267.6,165.0 268.2,179.5 268.2,194.0 C268.2,208.5 267.6,223.0 264.7,238.1 L229.9,232.3 L229.9,194.0 Z"/><path class="t" d="M162.0,194.0 L162.0,155.7 C186.4,154.0 209.6,154.0 229.9,155.7 L229.9,194.0 L229.9,232.3 C209.6,234.0 186.4,234.0 162.0,232.3 L162.0,194.0 Z"/><path class="t" d="M124.9,147.6 L162.0,155.7 M229.9,155.7 L264.7,149.9 M124.9,147.6 C174.8,144.1 221.2,144.1 264.7,149.9"/><path class="t" d="M41.4,162.1 C70.4,165.0 99.4,165.0 120.3,163.8"/><path class="w" d="M131.9,140.6 L135.4,132.5 L144.6,132.5 L143.5,140.6 Z"/><path class="t" d="M126.1,139.8 L126.1,145.3 M195.1,139.8 L195.1,144.7 M256.0,139.8 L256.0,147.0"/><path class="l" d="M27.5,158.0 C29.8,147.6 35.6,143.0 42.6,141.8 L44.9,148.8 C37.9,151.1 32.1,154.6 27.5,158.0 Z"/><path class="l" d="M312.3,159.2 C310.5,148.8 307.0,143.0 302.4,141.2 L300.1,147.6 C305.3,150.5 309.4,154.6 312.3,159.2 Z"/><path class="t" d="M124.9,240.4 L162.0,232.3 M229.9,232.3 L264.7,238.1 M124.9,240.4 C174.8,243.9 221.2,243.9 264.7,238.1"/><path class="t" d="M41.4,225.9 C70.4,223.0 99.4,223.0 120.3,224.2"/><path class="w" d="M131.9,247.4 L135.4,255.5 L144.6,255.5 L143.5,247.4 Z"/><path class="t" d="M126.1,248.2 L126.1,242.7 M195.1,248.2 L195.1,243.3 M256.0,248.2 L256.0,241.0"/><path class="l" d="M27.5,230.0 C29.8,240.4 35.6,245.0 42.6,246.2 L44.9,239.2 C37.9,236.9 32.1,233.4 27.5,230.0 Z"/><path class="l" d="M312.3,228.8 C310.5,239.2 307.0,245.0 302.4,246.8 L300.1,240.4 C305.3,237.5 309.4,233.4 312.3,228.8 Z"/><path class="t" d="M269.9,194.0 C269.9,170.8 270.5,152.2 273.4,144.1 C270.5,235.8 269.9,217.2 269.9,194.0"/><path class="t" d="M120.3,194.0 C120.3,170.8 121.4,153.4 123.8,144.1 C121.4,234.6 120.3,217.2 120.3,194.0"/><text x="169.0" y="272" text-anchor="middle" fill="#555" stroke="none">Вид сверху (перед слева)</text><path d="M402.1,237.4 L416.0,237.4 L416.0,254.3 Q416.0,256.0 414.3,256.0 L403.9,256.0 Q402.1,256.0 402.1,254.3 Z" fill="#3a3a3a"/><path d="M488.0,237.4 L501.9,237.4 L501.9,254.3 Q501.9,256.0 500.1,256.0 L489.7,256.0 Q488.0,256.0 488.0,254.3 Z" fill="#3a3a3a"/><path class="b" d="M452.0,246.1 L500.7,246.1 C504.2,246.1 505.9,243.2 505.9,238.6 L506.2,214.2 C506.2,207.3 505.4,203.8 503.0,200.9
 L500.7,198.0 C496.1,186.4 491.4,176.0 486.8,172.5 C481.0,170.2 463.6,170.2 452.0,170.2  C440.4,170.2 423.0,170.2 417.2,172.5 C412.6,176.0 407.9,186.4 403.3,198.0 L401.0,200.9 C398.6,203.8 397.8,207.3 397.8,214.2 L398.1,238.6 C398.1,243.2 399.8,246.1 403.3,246.1 L452.0,246.1 Z"/><path class="g" d="M406.2,198.0 L497.8,198.0 C493.8,187.6 489.7,178.3 485.1,174.8 C469.4,173.1 434.6,173.1 418.9,174.8 C414.3,178.3 410.2,187.6 406.2,198.0 Z"/><path class="t" d="M399.8,203.8 C428.8,200.9 475.2,200.9 504.2,203.8"/><path class="l" d="M399.8,207.9 L421.8,210.8 L423.0,215.4 L401.0,216.6 Z"/><path class="w" d="M402.1,198.0 L392.3,196.8 L391.7,191.0 L399.8,191.0 Z"/><circle class="t" cx="409.1" cy="235.1" r="2.9"/><path class="l" d="M504.2,207.9 L482.2,210.8 L481.0,215.4 L503.0,216.6 Z"/><path class="w" d="M501.9,198.0 L511.7,196.8 L512.3,191.0 L504.2,191.0 Z"/><circle class="t" cx="494.9" cy="235.1" r="2.9"/><path class="l" d="M428.8,213.1 L475.2,213.1 L477.5,221.2 L472.9,228.2 L431.1,228.2 L426.5,221.2 Z"/><path class="t" d="M430.0,218.3 L474.0,218.3 M430.0,222.9 L474.0,222.9"/><rect class="w" x="436.9" y="229.9" width="30.2" height="6.4"/><path class="t" d="M420.1,238.6 L483.9,238.6 L481.0,243.2 L423.0,243.2 Z"/><text x="452" y="272" text-anchor="middle" fill="#555" stroke="none">Спереди</text><path d="M554.1,237.4 L568.0,237.4 L568.0,254.3 Q568.0,256.0 566.3,256.0 L555.9,256.0 Q554.1,256.0 554.1,254.3 Z" fill="#3a3a3a"/><path d="M640.0,237.4 L653.9,237.4 L653.9,254.3 Q653.9,256.0 652.1,256.0 L641.7,256.0 Q640.0,256.0 640.0,254.3 Z" fill="#3a3a3a"/><path class="b" d="M604.0,246.1 L652.7,246.1 C656.2,246.1 657.9,243.2 657.9,238.6 L658.2,214.2 C658.2,207.3 657.4,203.8 655.0,200.9
 L652.7,198.0 C648.1,186.4 643.4,176.0 638.8,172.5 C633.0,170.2 615.6,170.2 604.0,170.2  C592.4,170.2 575.0,170.2 569.2,172.5 C564.6,176.0 559.9,186.4 555.3,198.0 L553.0,200.9 C550.6,203.8 549.8,207.3 549.8,214.2 L550.1,238.6 C550.1,243.2 551.8,246.1 555.3,246.1 L604.0,246.1 Z"/><path class="g" d="M562.2,193.4 L645.8,193.4 C643.4,185.2 640.0,177.7 636.5,174.8 C621.4,173.1 586.6,173.1 571.5,174.8 C568.0,177.7 564.6,185.2 562.2,193.4 Z"/><path class="t" d="M554.1,195.7 C580.8,193.9 627.2,193.9 653.9,195.7"/><path class="t" d="M569.2,213.1 L638.8,213.1"/><path class="l" d="M550.1,199.7 L570.4,200.9 L570.4,206.7 L550.1,208.4 Z"/><path class="w" d="M554.1,198.0 L544.3,196.8 L543.7,191.0 L551.8,191.0 Z"/><rect class="t" x="564.0" y="238.6" width="8.1" height="4.1" rx="2"/><path class="l" d="M657.9,199.7 L637.6,200.9 L637.6,206.7 L657.9,208.4 Z"/><path class="w" d="M653.9,198.0 L663.7,196.8 L664.3,191.0 L656.2,191.0 Z"/><rect class="t" x="635.9" y="238.6" width="8.1" height="4.1" rx="2"/><rect class="w" x="588.9" y="216.6" width="30.2" height="6.4"/><path class="t" d="M551.8,231.6 C580.8,232.8 627.2,232.8 656.2,231.6"/><text x="604" y="272" text-anchor="middle" fill="#555" stroke="none">Сзади</text></svg>`;

function acceptBody(o) {
  const acceptAt = o.accept_at ? `${dmy(o.accept_at)} ${o.accept_at.slice(11, 16)}` : '«___» __________ 20__ г.  ___:___';
  return header('Акт приёма автомобиля в работу', o) + carBlock(o) +
    `<p>Дата и время приёмки: <b>${acceptAt}</b>${o.bay ? ` · ${esc(o.bay)}` : ''}${o.end_date ? ` · ориентировочная готовность: <b>${dmy(o.end_date)}</b>` : ''}</p>
    <h3>Внешние и внутренние повреждения</h3>${CAR_SVG}
    <div class="box">${esc(o.accept_damage || '')}</div>
    <h3>Личные вещи в автомобиле</h3><div class="box">${esc(o.accept_items || 'Ценных вещей в автомобиле не оставлено')}</div>
    <h3>Работы, на которые принят автомобиль</h3><div class="box">${esc(o.complaint || '')}${o.items.length ? '<br>' + o.items.map((i) => esc(i.name) + (i.qty !== 1 ? ' × ' + i.qty : '')).join('; ') : ''}</div>
    <div class="terms">Заказчик подтверждает, что указанные выше повреждения имелись до передачи автомобиля Исполнителю. Исполнитель не несёт ответственности за ценные вещи, не указанные в акте.</div>
    <div class="sign"><div>Автомобиль принял ____________ / ${esc(o.accept_by_name || o.manager_name || '')}</div><div>Автомобиль сдал ____________ / ${esc(o.client_name)}</div></div>`;
}

function render(o, type) {
  let body = '';
  const terms = esc(getSetting('order_terms'));
  if (type === 'accept') {
    body = acceptBody(o);
  } else if (type === 'act') {
    body = header('Акт выполненных работ', o) + carBlock(o) + itemsTable(o, { warranty: true }) +
      `<p>Всего оказано услуг и отпущено товаров на сумму <b>${money(o.totals.total)} ₽</b> (${esc(rubWords(o.totals.total))}).</p>
      <p>Вышеперечисленные работы выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет. Автомобиль получен.</p>
      <div class="terms">${terms}</div>
      <div class="sign"><div>Исполнитель ____________ / ${esc(o.master_name || o.manager_name || '')}</div><div>Заказчик ____________ / ${esc(o.client_name)}</div></div>`;
  } else if (type === 'warranty') {
    const issued = o.issued_at || o.done_at || (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; })();
    const list = o.items.filter((i) => i.warranty_months > 0);
    const until = (m) => { const d = new Date(issued.slice(0, 10)); d.setMonth(d.getMonth() + m); return d.toLocaleDateString('ru-RU'); };
    body = header('Гарантийный талон', o) + carBlock(o) +
      `<h3>Гарантийные обязательства</h3><table class="items"><thead><tr><th>№</th><th>Работа / оборудование</th><th>Кол-во</th><th>Срок</th><th>Действует до</th></tr></thead><tbody>
      ${list.length ? list.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td class="c">${i.qty}</td><td class="c">${i.warranty_months} мес.</td><td class="c">${until(i.warranty_months)}</td></tr>`).join('') : '<tr><td colspan="5" class="c">Нет позиций с гарантией</td></tr>'}
      </tbody></table><p>Дата выдачи автомобиля: <b>${dmy(issued)}</b></p>
      <div class="terms">${esc(getSetting('warranty_terms'))}</div>
      <div class="sign"><div>Выдал ____________ / ${esc(o.master_name || o.manager_name || '')}</div><div>С условиями гарантии ознакомлен ____________ / ${esc(o.client_name)}</div></div>
      <p class="small muted">М.П.</p>`;
  } else {
    body = header('Заказ-наряд', o) + carBlock(o) +
      `<h3>Пожелания заказчика</h3><div class="box">${esc(o.complaint || '')}</div>` +
      (o.scheduled_at ? `<p>Дата записи: <b>${dmy(o.scheduled_at)} ${o.scheduled_at.slice(11, 16)}</b>${o.bay ? ', ' + esc(o.bay) : ''}</p>` : '') +
      itemsTable(o, { paid: true }) +
      `<h3>Состояние автомобиля при приёмке (повреждения, комплектность)</h3><div class="box" style="min-height:60px"></div>
      <div class="terms">${terms}<br>Заказчик согласен с перечнем и стоимостью работ. Стоимость может быть изменена по согласованию с заказчиком.</div>
      <div class="sign"><div>Принял ____________ / ${esc(o.manager_name || '')}</div><div>Заказчик ____________ / ${esc(o.client_name)}</div></div>`;
  }
  const title = { act: 'Акт', warranty: 'Гарантийный талон', accept: 'Акт приёма' }[type] || 'Заказ-наряд';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title} ${esc(o.number)}</title>${FONTS}<style>${CSS}</style></head>
  <body><div class="noprint"><button onclick="print()">🖨 Печать</button></div>${body}</body></html>`;
}

// Акт сверки взаиморасчётов с контрагентом
function sverka(c, before, rows, from, to) {
  const company = getSetting('company_name');
  const open = before.reduce((s, x) => s + x.they - x.we, 0);
  let bal = open; let tTheir = 0, tOur = 0;
  const lines = rows.map((x) => {
    // дебет — увеличивает долг контрагента нам, кредит — уменьшает (или наш долг ему)
    const v = x.they - x.we; bal += v;
    const debit = v > 0 ? v : 0, credit = v < 0 ? -v : 0; tTheir += debit; tOur += credit;
    return `<tr><td class="c">${dmy(x.d)}</td><td>${esc(x.text)}${x.note ? ' — ' + esc(x.note) : ''}</td><td class="r">${debit ? money(debit) : ''}</td><td class="r">${credit ? money(credit) : ''}</td><td class="r">${money(bal)}</td></tr>`;
  }).join('');
  const fin = bal;
  const verdict = Math.abs(fin) < 0.5 ? 'Задолженность отсутствует.' : fin > 0 ? `Задолженность ${esc(c.name)} перед ${esc(company)}: <b>${money(fin)} ₽</b> (${esc(rubWords(fin))}).` : `Задолженность ${esc(company)} перед ${esc(c.name)}: <b>${money(-fin)} ₽</b> (${esc(rubWords(-fin))}).`;
  const body = `<div class="head"><div>${LOGO_SVG}<div class="muted small">${esc([getSetting('company_address'), getSetting('company_inn') ? 'ИНН ' + getSetting('company_inn') : ''].filter(Boolean).join(' · '))}</div></div>
    <div class="right"><h1>Акт сверки взаиморасчётов</h1><div>за период ${dmy(from)} — ${dmy(to)}</div></div></div>
    <p>Между <b>${esc(company)}</b> и <b>${esc(c.name)}</b>${c.inn ? ' (ИНН ' + esc(c.inn) + ')' : ''}.</p>
    <table class="items"><thead><tr><th>Дата</th><th>Документ / операция</th><th>Дебет, ₽</th><th>Кредит, ₽</th><th>Сальдо, ₽</th></tr></thead><tbody>
    <tr><td></td><td><b>Сальдо на ${dmy(from)}</b></td><td></td><td></td><td class="r"><b>${money(open)}</b></td></tr>${lines}
    <tr><td></td><td><b>Обороты за период</b></td><td class="r"><b>${money(tTheir)}</b></td><td class="r"><b>${money(tOur)}</b></td><td></td></tr>
    <tr><td></td><td><b>Сальдо на ${dmy(to)}</b></td><td></td><td></td><td class="r"><b>${money(fin)}</b></td></tr></tbody></table>
    <p class="small muted">Положительное сальдо — задолженность контрагента перед ${esc(company)}, отрицательное — задолженность ${esc(company)} перед контрагентом.</p>
    <p>${verdict}</p>
    <div class="sign"><div>От ${esc(company)} ____________</div><div>От ${esc(c.name)} ____________</div></div><p class="small muted">М.П.</p>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Акт сверки ${esc(c.name)}</title>${FONTS}<style>${CSS}</style></head><body><div class="noprint"><button onclick="print()">🖨 Печать</button></div>${body}</body></html>`;
}


// Гарантия: акт приёма товара от клиента и акт передачи поставщику
function warrantyClaim(c, type) {
  const company = getSetting('company_name');
  const req = [getSetting('company_address'), getSetting('company_phone'), getSetting('company_inn') ? 'ИНН ' + getSetting('company_inn') : ''].filter(Boolean).join(' · ');
  const sup = type === 'supplier';
  const title = sup ? 'Акт передачи товара поставщику на гарантию' : 'Акт приёма товара на гарантийное обслуживание';
  const date = sup ? (c.sent_at || '') : c.received_at;
  const head = `<div class="head"><div>${LOGO_SVG}<div class="muted small">${esc(req)}</div></div>
    <div class="right"><h1>${title}</h1><div>№ <b>${esc(c.number)}</b> от ${dmy(date) || '____________'}</div></div></div>`;
  const kv = (rows) => `<table class="kv"><tbody>${rows.filter(Boolean).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</tbody></table>`;
  const goods = `<h3>Товар</h3>${kv([
    ['Наименование', `<b>${esc(c.product_name)}</b>`], ['Серийный номер', esc(c.serial || '—')], ['Количество', esc(c.qty || 1)],
    ['Дата продажи / установки', dmy(c.sale_date) || '—'], c.order_id ? ['Заказ-наряд', 'БС-' + String(c.order_id).padStart(5, '0')] : null])}
    <h3>Заявленная неисправность</h3><div class="box">${esc(c.defect || '')}</div>
    <h3>Комплектность и внешний вид</h3><div class="box">${esc(c.kit || '')}</div>`;
  const body = sup
    ? head + `<p>${esc(company)} передаёт, а <b>${esc(c.supplier || '____________________')}</b> принимает для гарантийной диагностики / ремонта / замены следующий товар:</p>` + goods +
      `<p>Дата приёма товара от покупателя: <b>${dmy(c.received_at)}</b>. Просим рассмотреть обращение в кратчайший срок: срок удовлетворения требований покупателя не может превышать ${c.deadline ? '45 дней (до ' + dmy(c.deadline) + ')' : '45 дней'}.</p>
      ${c.sent_doc ? `<p>Документ / трек-номер: ${esc(c.sent_doc)}</p>` : ''}
      <div class="sign"><div>Передал ____________ / ${esc(company)}</div><div>Принял ____________ / ${esc(c.supplier || '')}</div></div><p class="small muted">М.П.</p>`
    : head + `<h3>Покупатель</h3>${kv([['ФИО', esc(c.client_name || '')], ['Телефон', esc(c.client_phone || '')]])}` + goods +
      `<div class="terms">Товар принят для проверки качества и передачи поставщику (сервисному центру). Срок рассмотрения — не более 45 дней с даты приёма (до ${dmy(c.deadline)}). При подтверждении гарантийного случая товар будет отремонтирован, заменён или будут возвращены деньги. Если неисправность возникла по вине покупателя (механические повреждения, следы влаги, нарушение правил эксплуатации или установки), в гарантийном обслуживании может быть отказано. О результате мы сообщим по телефону.</div>
      <div class="sign"><div>Принял ____________ / ${esc(c.created_by_name || '')}</div><div>Сдал, с условиями согласен ____________ / ${esc(c.client_name || '')}</div></div>
      <h3 style="margin-top:30px">Отметка о выдаче</h3><div class="box">Результат: ${esc(c.outcome ? ({ repaired: 'отремонтирован', replaced: 'замена', refund: 'возврат денег', rejected: 'отказ', other: '' }[c.outcome] || '') : '')} ${esc(c.outcome_note || '')}<br><br>Товар получил, претензий не имею ____________ / ${esc(c.client_name || '')} &nbsp; Дата ____________</div>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(c.number)} — ${sup ? 'передача поставщику' : 'приём на гарантию'}</title>${FONTS}<style>${CSS}</style></head><body><div class="noprint"><button onclick="print()">🖨 Печать</button></div>${body}</body></html>`;
}

module.exports = { render, rubWords, sverka, warrantyClaim, KIT, WORKS, FUEL };
