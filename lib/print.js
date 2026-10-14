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
.cut{border-top:1px dashed #999;margin:30px 0}.noprint{position:fixed;bottom:16px;right:16px}.noprint button{font-size:14px;padding:8px 16px;cursor:pointer}
@media print{.noprint{display:none}body{padding:0}@page{margin:12mm}}`;

function render(o, type) {
  let body = '';
  const terms = esc(getSetting('order_terms'));
  if (type === 'act') {
    body = header('Акт выполненных работ', o) + carBlock(o) + itemsTable(o, { warranty: true }) +
      `<p>Всего оказано услуг и отпущено товаров на сумму <b>${money(o.totals.total)} ₽</b> (${esc(rubWords(o.totals.total))}).</p>
      <p>Вышеперечисленные работы выполнены полностью и в срок. Заказчик претензий по объёму, качеству и срокам оказания услуг не имеет. Автомобиль получен.</p>
      <div class="terms">${terms}</div>
      <div class="sign"><div>Исполнитель ____________ / ${esc(o.master_name || o.manager_name || '')}</div><div>Заказчик ____________ / ${esc(o.client_name)}</div></div>`;
  } else if (type === 'warranty') {
    const issued = o.issued_at || o.done_at || new Date().toISOString();
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
  const title = { act: 'Акт', warranty: 'Гарантийный талон' }[type] || 'Заказ-наряд';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title} ${esc(o.number)}</title><style>${CSS}</style></head>
  <body><div class="noprint"><button onclick="print()">🖨 Печать</button></div>${body}</body></html>`;
}

module.exports = { render, rubWords };
