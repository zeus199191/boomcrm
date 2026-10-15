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

function header(title, o) {
  const company = getSetting('company_name'); const sub = getSetting('company_subtitle');
  const req = [getSetting('company_address'), getSetting('company_phone'), getSetting('company_inn') ? 'ИНН ' + getSetting('company_inn') : ''].filter(Boolean).join(' · ');
  return `<div class="head"><div><div class="brand">${esc(company)}</div><div class="muted">${esc(sub)}</div><div class="muted small">${esc(req)}</div>
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
.right{text-align:right}.brand{font-size:22px;font-weight:800;letter-spacing:.5px}.muted{color:#555}.small{font-size:11px}
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
const CAR_SVG = `<svg viewBox="0 0 700 300" width="100%" style="max-width:700px;display:block;margin:6px auto" fill="none" stroke="#222" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" font-family="Arial" font-size="10">
  <defs>
    <g id="carSide">
      <!-- кузов -->
      <path d="M14,86 L11,70 Q12,62 24,59 L98,51 Q121,32 146,24 Q180,18 214,20 Q238,23 262,45 L290,49 Q299,51 300,61 L300,80 Q299,86 292,86 L265,86 A24,24 0 0 0 217,86 L87,86 A24,24 0 0 0 39,86 Z"/>
      <!-- линия порога и боковая рельефная линия -->
      <path d="M87,80 L217,80" stroke-width="0.9"/>
      <path d="M26,64 Q160,58 296,60" stroke-width="0.7"/>
      <!-- остекление -->
      <path d="M106,51 Q127,34 148,28 L150,51 Z"/>
      <path d="M156,27 Q186,22 212,23 Q232,26 250,47 L156,50 Z"/>
      <path d="M150,51 L153,27" stroke-width="2.2"/>
      <!-- двери -->
      <path d="M102,52 L101,80 M153,51 L154,80 M212,49 Q216,66 214,80" stroke-width="0.9"/>
      <path d="M134,58 h10 M190,58 h10" stroke-width="2"/>
      <!-- зеркало -->
      <path d="M103,49 q-6,-6 3,-8 l5,5 z" stroke-width="1"/>
      <!-- оптика -->
      <path d="M13,63 Q20,60 34,59 L33,64 Q22,65 14,67 Z" stroke-width="0.9"/>
      <path d="M288,50 L299,53 L299,59 L287,57 Z" stroke-width="0.9"/>
      <!-- колёса -->
      <circle cx="63" cy="86" r="19"/><circle cx="63" cy="86" r="10" stroke-width="0.9"/>
      <circle cx="241" cy="86" r="19"/><circle cx="241" cy="86" r="10" stroke-width="0.9"/>
      <!-- лючок бензобака -->
      <rect x="246" y="56" width="9" height="7" rx="2" stroke-width="0.8"/>
    </g>
  </defs>

  <!-- левый бок -->
  <g transform="translate(20,20)"><use href="#carSide"/></g>
  <text x="170" y="132" text-anchor="middle" fill="#555" stroke="none">Левая сторона</text>
  <!-- правый бок (зеркально) -->
  <g transform="translate(680,20) scale(-1,1)"><use href="#carSide"/></g>
  <text x="530" y="132" text-anchor="middle" fill="#555" stroke="none">Правая сторона</text>

  <!-- вид сверху -->
  <g transform="translate(20,150)">
    <path d="M30,20 Q12,22 10,45 L10,95 Q12,118 30,120 L278,120 Q298,118 300,98 L300,42 Q298,22 278,20 Z"/>
    <path d="M10,48 Q4,48 4,56 L4,84 Q4,92 10,92" stroke-width="0.9"/>
    <path d="M300,46 Q306,46 306,54 L306,86 Q306,94 300,94" stroke-width="0.9"/>
    <!-- капот -->
    <path d="M30,32 Q60,30 92,34 L92,106 Q60,110 30,108" stroke-width="0.8"/>
    <!-- лобовое -->
    <path d="M96,30 L128,36 L128,104 L96,110 Z"/>
    <!-- крыша -->
    <rect x="130" y="36" width="78" height="68" rx="6"/>
    <!-- заднее стекло -->
    <path d="M210,36 L238,32 L238,108 L210,104 Z"/>
    <!-- багажник -->
    <path d="M242,32 Q270,30 290,36 L290,104 Q270,110 242,108" stroke-width="0.8"/>
    <!-- зеркала -->
    <path d="M104,20 l6,-9 l10,2 l-4,7" stroke-width="1"/><path d="M104,120 l6,9 l10,-2 l-4,-7" stroke-width="1"/>
    <!-- колёса (вид сверху) -->
    <rect x="44" y="12" width="36" height="8" rx="2" stroke-width="0.8" stroke-dasharray="3 2"/><rect x="44" y="120" width="36" height="8" rx="2" stroke-width="0.8" stroke-dasharray="3 2"/>
    <rect x="222" y="12" width="36" height="8" rx="2" stroke-width="0.8" stroke-dasharray="3 2"/><rect x="222" y="120" width="36" height="8" rx="2" stroke-width="0.8" stroke-dasharray="3 2"/>
    <!-- линии дверей -->
    <path d="M100,20 v-0 M150,20 L150,36 M150,104 L150,120 M206,21 L208,36 M206,119 L208,104" stroke-width="0.8"/>
  </g>
  <text x="175" y="292" text-anchor="middle" fill="#555" stroke="none">Вид сверху (перед слева)</text>

  <!-- вид спереди -->
  <g transform="translate(375,160)">
    <path d="M14,104 L10,72 Q10,60 22,56 L36,30 Q42,20 60,18 L100,18 Q118,20 124,30 L138,56 Q150,60 150,72 L146,104 Z"/>
    <path d="M40,32 Q44,24 60,23 L100,23 Q116,24 120,32 L130,52 L30,52 Z"/>
    <!-- фары -->
    <path d="M16,66 L46,62 L44,72 L18,74 Z" stroke-width="0.9"/><path d="M144,66 L114,62 L116,72 L142,74 Z" stroke-width="0.9"/>
    <!-- решётка радиатора (обобщённая) -->
    <rect x="54" y="64" width="52" height="14" rx="3"/>
    <path d="M58,71 h44" stroke-width="0.7"/>
    <!-- бампер и номер -->
    <path d="M18,86 Q80,92 142,86" stroke-width="0.9"/>
    <rect x="62" y="88" width="36" height="9" stroke-width="0.8"/>
    <!-- зеркала -->
    <path d="M22,54 l-12,-2 l0,8 l12,2" stroke-width="1"/><path d="M138,54 l12,-2 l0,8 l-12,2" stroke-width="1"/>
    <rect x="16" y="104" width="22" height="10" rx="2"/><rect x="122" y="104" width="22" height="10" rx="2"/>
  </g>
  <text x="455" y="292" text-anchor="middle" fill="#555" stroke="none">Спереди</text>

  <!-- вид сзади -->
  <g transform="translate(535,160)">
    <path d="M14,104 L10,70 Q10,60 22,56 L36,30 Q42,20 60,18 L100,18 Q118,20 124,30 L138,56 Q150,60 150,70 L146,104 Z"/>
    <path d="M42,30 Q46,24 60,23 L100,23 Q114,24 118,30 L126,50 L34,50 Z"/>
    <!-- фонари -->
    <path d="M14,60 L52,58 L52,66 L16,70 Z" stroke-width="0.9"/><path d="M146,60 L108,58 L108,66 L144,70 Z" stroke-width="0.9"/>
    <path d="M52,62 L108,62" stroke-width="0.7"/>
    <!-- крышка багажника и номер -->
    <path d="M30,56 L130,56" stroke-width="0.8"/>
    <rect x="62" y="72" width="36" height="10" stroke-width="0.8"/>
    <path d="M18,88 Q80,94 142,88" stroke-width="0.9"/>
    <circle cx="52" cy="98" r="3" stroke-width="0.8"/><circle cx="108" cy="98" r="3" stroke-width="0.8"/>
    <rect x="16" y="104" width="22" height="10" rx="2"/><rect x="122" y="104" width="22" height="10" rx="2"/>
  </g>
  <text x="615" y="292" text-anchor="middle" fill="#555" stroke="none">Сзади</text>
</svg>`;

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
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title} ${esc(o.number)}</title><style>${CSS}</style></head>
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
  const body = `<div class="head"><div><div class="brand">${esc(company)}</div><div class="muted small">${esc([getSetting('company_address'), getSetting('company_inn') ? 'ИНН ' + getSetting('company_inn') : ''].filter(Boolean).join(' · '))}</div></div>
    <div class="right"><h1>Акт сверки взаиморасчётов</h1><div>за период ${dmy(from)} — ${dmy(to)}</div></div></div>
    <p>Между <b>${esc(company)}</b> и <b>${esc(c.name)}</b>${c.inn ? ' (ИНН ' + esc(c.inn) + ')' : ''}.</p>
    <table class="items"><thead><tr><th>Дата</th><th>Документ / операция</th><th>Дебет, ₽</th><th>Кредит, ₽</th><th>Сальдо, ₽</th></tr></thead><tbody>
    <tr><td></td><td><b>Сальдо на ${dmy(from)}</b></td><td></td><td></td><td class="r"><b>${money(open)}</b></td></tr>${lines}
    <tr><td></td><td><b>Обороты за период</b></td><td class="r"><b>${money(tTheir)}</b></td><td class="r"><b>${money(tOur)}</b></td><td></td></tr>
    <tr><td></td><td><b>Сальдо на ${dmy(to)}</b></td><td></td><td></td><td class="r"><b>${money(fin)}</b></td></tr></tbody></table>
    <p class="small muted">Положительное сальдо — задолженность контрагента перед ${esc(company)}, отрицательное — задолженность ${esc(company)} перед контрагентом.</p>
    <p>${verdict}</p>
    <div class="sign"><div>От ${esc(company)} ____________</div><div>От ${esc(c.name)} ____________</div></div><p class="small muted">М.П.</p>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Акт сверки ${esc(c.name)}</title><style>${CSS}</style></head><body><div class="noprint"><button onclick="print()">🖨 Печать</button></div>${body}</body></html>`;
}

module.exports = { render, rubWords, sverka, KIT, WORKS, FUEL };
