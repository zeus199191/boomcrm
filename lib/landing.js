'use strict';
// Сайт-лендинг тюнинг-ателье: главная страница сервера. Контакты и режим работы берутся из Настроек CRM.
// Фото — бесплатные, по лицензии Unsplash (коммерческое использование разрешено).
const { getSetting, all } = require('./db');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMG = (id, w) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=72`;
const srcset = (id, local) => local ? local.map((w) => `${id}-${w}.webp ${w}w`).join(', ') : [640, 960, 1400].map((w) => `${IMG(id, w)} ${w}w`).join(', ');

// Основные направления (карточки и выбор в форме заявки)
const GROUPS = [
  { key: 'sound', title: 'Автозвук', text: 'Лучшие мировые и российские бренды. Непревзойдённое качество и точность. Детальная настройка систем от победителей всероссийских соревнований по качеству звучания.',
    more: '/avtozvuk', img: '/img/sound2', sizesLocal: [800, 1536], alt: 'Сабвуфер и усилители JL Audio в багажнике с подсветкой', pos: '42% center' },
  { key: 'noise', title: 'Шумоизоляция', text: 'Двери, пол, арки, багажник, потолок. Тишина на трассе и на шипах, музыка звучит чище.',
    img: '/img/noise2', sizesLocal: [900], alt: 'Мастер прикатывает виброизоляцию STP Aero в двери автомобиля', pos: 'center top' },
  { key: 'alarm', title: 'Сигнализации и автозапуск', text: 'StarLine и Pandora: автозапуск по времени и температуре, управление с телефона, защита от угона.',
    img: '/img/alarm3', sizesLocal: [880], alt: 'Брелок Pandora с экраном и приложение на телефоне', pos: 'center top' },
  { key: 'media', title: 'Магнитолы и мультимедиа', text: 'Android-магнитолы, CarPlay и Android Auto, сохранение штатных кнопок и камер.',
    img: '/img/media3', sizesLocal: [860], alt: 'Мастер устанавливает мультимедиа с навигацией и CarPlay', pos: 'center top' },
  { key: 'cam', title: 'Камеры и регистраторы', text: 'Камеры переднего и заднего вида, парктроники, регистраторы со скрытой проводкой.',
    img: '/img/cam4', sizesLocal: [1000], alt: 'Видеорегистратор на лобовом стекле и камеры кругового обзора на экране', pos: 'center top' },
  { key: 'print3d', title: '3D-печать', text: 'Подиумы под динамики, рамки магнитол, крепления и накладки — моделируем и печатаем под вашу машину.',
    img: '/img/print3d2', sizesLocal: [1000], alt: '3D-принтер печатает подиум под динамик', pos: 'center top' },
  { key: 'diag', title: 'Диагностика и доработки', text: 'Ищем неисправности электрики, ставим дополнительное оборудование, приводим в порядок проводку после чужих установок.',
    img: '/img/diag', sizesLocal: [1800], alt: 'Компьютерная диагностика автомобиля сканером', pos: '78% center' },
];
// Фон: лёд Байкала (Sergey Pesterev / Unsplash), полупрозрачно под стальной вуалью
const ICE = { img: '1552575358-c91311522b16', by: 'Sergey Pesterev' };
const HERO = { img: '/img/hero2', sizesLocal: [560, 1122], alt: 'Мастер Бумсистем настраивает звук: подиумы в двери, ноутбук с процессором' };

const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function hoursText() {
  const off = getSetting('days_off', '0').split(',').filter((x) => x !== '').map(Number);
  const order = [1, 2, 3, 4, 5, 6, 0]; const work = order.filter((d) => !off.includes(d));
  const idx = work.map((d) => order.indexOf(d));
  const days = work.length && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
    ? (work.length === 1 ? cap(DOW[work[0]]) : `${cap(DOW[work[0]])}–${DOW[work[work.length - 1]]}`)
    : work.map((d) => DOW[d]).join(', ');
  return { days, time: `${getSetting('work_start', '09:00')}–${getSetting('work_end', '21:00')}`, off: order.filter((d) => off.includes(d)).map((d) => DOW[d]).join(', ') };
}

const EMBLEM = `<g><circle cx="110" cy="110" r="104" fill="none" stroke="currentColor" stroke-width="8"/>
<g fill="currentColor"><circle cx="110" cy="22" r="5"/><circle cx="198" cy="110" r="5"/><circle cx="110" cy="198" r="5"/><circle cx="22" cy="110" r="5"/><circle cx="172.2" cy="47.8" r="5"/><circle cx="172.2" cy="172.2" r="5"/><circle cx="47.8" cy="172.2" r="5"/><circle cx="47.8" cy="47.8" r="5"/></g>
<g class="cone"><circle cx="110" cy="110" r="78" fill="currentColor"/><circle cx="110" cy="110" r="62" fill="var(--bg-e)"/><circle cx="110" cy="110" r="50" fill="none" stroke="currentColor" stroke-width="4"/>
<circle cx="110" cy="110" r="38" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="110" cy="110" r="24" fill="currentColor"/><circle cx="102" cy="102" r="6" fill="var(--bg-e)"/></g></g>`;

const LOGO = `<svg class="logo" viewBox="100 160 970 240" role="img" aria-label="Бумсистем — тюнинг-ателье с сибирским характером">
<g transform="translate(110,170)" style="--bg-e:var(--paper)">${EMBLEM}</g>
<text class="lw" x="370" y="300" textLength="690" lengthAdjust="spacingAndGlyphs">БУМСИСТЕМ</text><rect x="372" y="336" width="48" height="6" fill="currentColor"/>
<text class="lt" x="436" y="345" textLength="560" lengthAdjust="spacing">ТЮНИНГ-АТЕЛЬЕ С СИБИРСКИМ ХАРАКТЕРОМ</text><rect x="1012" y="336" width="48" height="6" fill="currentColor"/></svg>`;

function card(g, cls, sizes, moreLabel = 'Подробнее') {
  return `<article class="svc ${cls}">
    <img src="${g.sizesLocal ? `${g.img}-${g.sizesLocal.at(-1)}.webp` : IMG(g.img, 960)}" srcset="${srcset(g.img, g.sizesLocal)}" sizes="${sizes}"${g.pos ? ` style="object-position:${g.pos}"` : ''} alt="${esc(g.alt)}" loading="lazy" decoding="async" onerror="this.remove()">
    <div class="svc-body"><h3>${esc(g.title)}</h3><p>${esc(g.text)}</p>
    <div class="svc-btns"><button type="button" data-pick="${esc(g.title)}">Записаться</button>${g.more ? `<a class="svc-more" href="${g.more}">${esc(moreLabel)} →</a>` : ''}</div></div></article>`;
}

const stars = (n) => `<span class="stars" aria-label="Оценка ${n} из 5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dLong = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${+d} ${MONTHS_GEN[+m - 1]} ${y}`; };
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
// «Наши работы»: публикации из CRM (Маркетинг → Публикации) с галочкой «Сайт»
// home — 6 свежих работ и кнопка «Все работы»; page — отдельная страница /raboty с вкладками по разделам
function worksBlock({ page = false } = {}) {
  let list = [], CATS = {}; try { const pb = require('./pubs'); list = pb.siteWorks(page ? 150 : 6); CATS = pb.SITE_CATS; } catch {}
  if (!list.length && !page) return '';
  const clip = (t, n) => { t = String(t || '').replace(/#\S+/g, '').replace(/[📍📞].*$/gmu, '').trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t; };
  const cards = list.map((w, i) => {
    const m = w.media[0];
    const cover = m.kind === 'video' ? '<video src="' + m.url + '#t=0.5" muted playsinline preload="metadata"></video>' : '<img src="' + m.url + '" alt="' + esc(w.title || 'Наша работа') + '" loading="lazy" decoding="async">';
    return '<article class="wk" data-wk="' + i + '" data-cat="' + (w.cat || 'other') + '"><button type="button" class="wk-media" aria-label="Открыть работу: ' + esc(w.title || '') + '">' + cover +
      (w.media.length > 1 ? '<span class="wk-n">' + w.media.length + ' фото/видео</span>' : '') + (m.kind === 'video' ? '<span class="wk-play" aria-hidden="true">▶</span>' : '') + '</button>' +
      '<div class="wk-body"><h3>' + esc(w.title || 'Наша работа') + '</h3><p>' + esc(clip(w.text, 160)) + '</p></div></article>';
  }).join('');
  const data = JSON.stringify(list.map((w) => ({ t: w.title || '', x: String(w.text || '').replace(/#\S+/g, '').trim(), m: w.media.map((m) => [m.kind === 'video' ? 'v' : 'p', m.url]) }))).replace(/</g, '\\u003c');
  const js = '(function(){var D=' + data + ';var dlg=document.getElementById("wkDlg");if(!dlg)return;var cur=null,k=0;' +
    'function show(){var m=cur.m[k];var box=dlg.querySelector(".wkd-media");box.innerHTML="";var el=document.createElement(m[0]==="v"?"video":"img");el.src=m[1];if(m[0]==="v"){el.controls=true;el.playsInline=true;el.autoplay=true;}box.appendChild(el);dlg.querySelector(".wkd-cnt").textContent=cur.m.length>1?(k+1)+" / "+cur.m.length:"";}' +
    'document.querySelectorAll("[data-wk]").forEach(function(a){a.querySelector(".wk-media").addEventListener("click",function(){cur=D[+a.dataset.wk];k=0;dlg.querySelector("h3").textContent=cur.t;dlg.querySelector(".wkd-text").textContent=cur.x;show();dlg.showModal();});});' +
    'dlg.querySelector(".wkd-prev").onclick=function(){k=(k-1+cur.m.length)%cur.m.length;show();};dlg.querySelector(".wkd-next").onclick=function(){k=(k+1)%cur.m.length;show();};' +
    'dlg.querySelector(".wkd-x").onclick=function(){dlg.close();};dlg.addEventListener("close",function(){dlg.querySelector(".wkd-media").innerHTML="";});dlg.addEventListener("click",function(e){if(e.target===dlg)dlg.close();});})();';
  const cnt = {}; list.forEach((w) => { cnt[w.cat || 'other'] = (cnt[w.cat || 'other'] || 0) + 1; });
  const first = Object.keys(CATS).find((k) => cnt[k]) || 'sound';
  const tabs = page ? '<div class="wk-tabs" role="tablist" aria-label="Разделы работ">' + Object.entries(CATS).map(([k, t]) =>
    '<button type="button" role="tab" class="wk-tab' + (k === first ? ' on' : '') + '" data-tab="' + k + '" aria-selected="' + (k === first) + '">' + esc(t) + '<span>' + (cnt[k] || 0) + '</span></button>').join('') + '</div>' : '';
  const tabJs = page ? '(function(){var tb=document.querySelectorAll("[data-tab]"),cards=document.querySelectorAll("[data-cat]"),empty=document.getElementById("wkEmpty");' +
    'function sel(c){var n=0;tb.forEach(function(b){var on=b.dataset.tab===c;b.classList.toggle("on",on);b.setAttribute("aria-selected",on);});cards.forEach(function(a){var v=a.dataset.cat===c;a.hidden=!v;if(v)n++;});empty.hidden=n>0;}' +
    'tb.forEach(function(b){b.addEventListener("click",function(){sel(b.dataset.tab);history.replaceState(null,"","#"+b.dataset.tab);});});' +
    'var h=location.hash.slice(1);sel(' + JSON.stringify(Object.keys(CATS)) + '.indexOf(h)>=0?h:' + JSON.stringify(first) + ');})();' : '';
  return '<section class="works' + (page ? ' works-page' : '') + '" id="works"><div class="wrap"><div class="sec-head">' + (page ? '<h1>Наши работы</h1>' : '<h2>Наши работы</h2>') +
    '<p>' + (page ? 'Проекты студии по разделам: что сделали и какое оборудование поставили.' : 'Свежие проекты студии: что сделали и какое оборудование поставили.') + '</p></div>' + tabs +
    '<div class="wk-grid">' + cards + '</div>' + (page ? '<p class="wk-empty" id="wkEmpty" hidden>В этом разделе работы скоро появятся.</p>' : '<div class="wk-all"><a class="btn btn-line" href="/raboty">Все работы по разделам →</a></div>') + '</div>' +
    '<dialog id="wkDlg" class="wkd"><div class="wkd-in"><button type="button" class="wkd-x" aria-label="Закрыть">✕</button><div class="wkd-media"></div>' +
    '<div class="wkd-nav"><button type="button" class="wkd-prev" aria-label="Назад">‹</button><span class="wkd-cnt"></span><button type="button" class="wkd-next" aria-label="Вперёд">›</button></div>' +
    '<h3></h3><p class="wkd-text"></p></div></dialog><script>' + js + tabJs + '</script></section>';
}
function reviewsBlock() {
  const list = all('SELECT author,date,rating,text,source FROM site_reviews WHERE visible=1 ORDER BY sort, date DESC, id DESC LIMIT 12');
  const url = getSetting('twogis_url'); const rating = getSetting('twogis_rating'); const cnt = +getSetting('twogis_count') || 0;
  if (!list.length && !url) return '';
  const score = url || rating ? `<a class="rv-score" ${url ? `href="${esc(url)}" target="_blank" rel="noopener"` : ''}><span class="gis" aria-hidden="true">2ГИС</span>
    ${rating ? `<span class="num">${esc(String(rating).replace('.', ','))}</span>` : ''}<span class="meta">${rating ? stars(Math.round(+rating)) : ''}<b>${cnt ? `${cnt} ${plural(cnt, 'отзыв', 'отзыва', 'отзывов')} на 2ГИС` : 'Отзывы на 2ГИС'}</b>${url ? 'Открыть все отзывы' : ''}</span></a>` : '';
  return `<section class="reviews" id="reviews"><div class="wrap">
  <div class="rv-head"><h2>Отзывы клиентов</h2>${score}</div>
  ${list.length ? `<div class="rv-list">${list.map((r) => `<figure class="rv${r.text.length > 420 ? ' clamp' : ''}">${r.rating ? stars(r.rating) : ''}<blockquote>${esc(r.text)}</blockquote>${r.text.length > 420 ? '<button type="button" class="more">Читать полностью</button>' : ''}
    <figcaption><b>${esc(r.author)}</b><span>${[dLong(r.date), r.source].filter(Boolean).map(esc).join(' · ')}</span></figcaption></figure>`).join('')}</div>` : ''}
  ${url && list.length ? `<div class="rv-all"><a class="btn btn-line" href="${esc(url)}" target="_blank" rel="noopener">Все отзывы на 2ГИС</a></div>` : ''}
</div></section>`;
}

// Витрина «Автосигнализации»: товары с отметкой «Показывать на сайте», цены — розничные из каталога CRM
const rubFmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/\s/g, ' ') + ' ₽';
const FEATS = [[/\b(LTE|4G)\b/i, 'LTE'], [/\bGSM\b|телеметрическ/i, 'GSM'], [/\bGPS\b/i, 'GPS'], [/\bBT\b|bluetooth/i, 'Bluetooth'], [/\bLoRa\b/i, 'LoRa'], [/CAN[ -]?FD|\bFD\b/i, 'CAN FD']];
// Фото упаковок StarLine (выданы StarLine): подбираем к модели по коду, версии и опциям (ECO, LTE, GPS…)
let SL_PACKS = null;
function slPack(name) {
  if (SL_PACKS === null) { try { SL_PACKS = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'img', 'starline', 'index.json'), 'utf8')); } catch { SL_PACKS = []; } }
  const n = String(name).toLowerCase().split(',')[0].replace(/starline/g, ' ');
  const m = /(?<![a-z0-9])(as|[abestvi])\s?(\d{1,2})(?!\d)\s*(?:v\.?\s?(\d))?/.exec(n); if (!m) return null;
  const base = m[1] + m[2], ver = m[3] ? 'v' + m[3] : '', rest = n.slice(m.index + m[0].length) + ' ' + String(name).toLowerCase().slice(n.length);
  const has = (k) => ({ '2can': /2can/, canfd: /can\s?fd/, '2sim': /2sim/ }[k] || new RegExp('(?<![a-z])' + k + '(?![a-z])')).test(rest);
  let best = null, bs = -1e9;
  for (const x of SL_PACKS) {
    if (x.base !== base) continue;
    let sc = (ver ? (x.ver === ver ? 10 : x.ver ? -6 : -2) : (x.ver ? -1 : 0)) - (x.sm ? 1.5 : 0);
    for (const k of x.feats) sc += has(k) ? 1 : k === 'kz' ? -3 : -0.7; // kz — упаковка для Казахстана
    if (sc > bs) { bs = sc; best = x; }
  }
  return best ? { src: `/img/starline/${best.f}.webp`, white: !!best.wb } : null;
}
// Фото упаковок Pandora (с alarmtrade.ru, с разрешения): белый фон, поэтому на сайте выводятся в режиме multiply
const PD_PACKS = ['vx4ggpsfd', 'uf3810', 'x1800l', 'dx40rs', 'dx9x', 'dx6x', 'vx4g'];
function pdPack(name) {
  const n = String(name).toLowerCase().split(',')[0].replace(/pandora|pandect/g, '').replace(/[^a-z0-9]/g, '');
  const k = PD_PACKS.find((x) => n.includes(x));
  return k ? { src: `/img/pandora/${k}.webp`, white: true } : null;
}
// Яндекс Метрика: номер счётчика — в CRM (Маркетинг → Инструменты). Цели: lead — заявка с сайта, call — нажатие на телефон.
function metrika() {
  const id = String(getSetting('ym_id') || '').replace(/\D/g, ''); if (!id) return '';
  return `<script>(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,'script','https://mc.yandex.ru/metrika/tag.js','ym');
ym(${id},'init',{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});
window.ymGoal=function(g){try{ym(${id},'reachGoal',g)}catch(e){}};
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href^="tel:"]');if(a)window.ymGoal('call');var m=e.target.closest&&e.target.closest('a[href*="t.me"],a[href*="vk.ru"],a[href*="vk.com"],a[href*="max.ru"]');if(m)window.ymGoal('messenger');});</script>
<noscript><div><img src="https://mc.yandex.ru/watch/${id}" style="position:absolute;left:-9999px" alt=""></div></noscript>`;
}
function alarmModels() {
  const rows = all("SELECT id,brand,name,price,stock FROM products WHERE active=1 AND site=1 AND price>0 ORDER BY price, name");
  const groups = new Map();
  for (const p of rows) {
    let brand = (p.brand || '').trim(); if (/pandect|pandora/i.test(brand + ' ' + p.name)) brand = 'Pandora'; else if (/starline/i.test(brand + ' ' + p.name)) brand = 'StarLine';
    if (!brand) brand = 'Другие';
    let model = p.name.split(',')[0].replace(/\s+(охранн|автосигнал|телеметр|телемат).*$/i, '').trim().replace(new RegExp('^' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i'), '');
    const f = []; for (const [re, t] of FEATS) if (re.test(p.name) && !f.includes(t)) f.push(t);
    if (f.includes('LTE')) f.splice(f.indexOf('GSM'), f.includes('GSM') ? 1 : 0);
    if (!groups.has(brand)) groups.set(brand, []);
    groups.get(brand).push({ brand, model, feats: f, pack: brand === 'StarLine' ? slPack(p.name) : brand === 'Pandora' ? pdPack(p.name) : null, eco: /\bECO\b/i.test(p.name), price: p.price, stock: p.stock > 0 });
  }
  const order = ['StarLine', 'Pandora'];
  return [...groups.entries()].sort((a, b) => ((order.indexOf(a[0]) + 1) || 9) - ((order.indexOf(b[0]) + 1) || 9));
}
function alarmsBlock() {
  const groups = alarmModels(); if (!groups.length) return '';
  const d = new Date(); const today = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
  const brands = groups.map(([b]) => b);
  const title = brands.filter((b) => b !== 'Другие').join(' и ') || 'популярных марок';
  return `<section class="alarms" id="alarms"><div class="wrap">
  <div class="sec-head"><h2>Автосигнализации ${esc(title)}</h2><p>Популярные модели, которые ставим чаще всего. Поможем выбрать под вашу машину и настроим автозапуск под сибирскую зиму.</p></div>
  ${groups.length > 1 ? `<div class="al-tabs" role="tablist" aria-label="Марка">${groups.map(([b, l], i) => `<button type="button" role="tab" id="alt-${i}" aria-controls="alp-${i}" aria-selected="${i ? 'false' : 'true'}" data-tab="${i}">${esc(b)}<span>${l.length}</span></button>`).join('')}</div>` : ''}
  ${groups.map(([b, list], i) => `<div class="al-grid" id="alp-${i}" role="tabpanel" aria-labelledby="alt-${i}" ${i ? 'data-off' : ''}>
    ${list.map((m) => `<article class="al${m.pack ? ' has-pack' : ''}">
      ${m.pack ? `<div class="al-pack${m.pack.white ? ' wb' : ''}"><img src="${m.pack.src}" alt="Упаковка ${esc(m.brand + ' ' + m.model)}" loading="lazy" decoding="async" onerror="this.parentNode.remove()"></div>` : ''}
      <div class="al-top"><span class="al-brand">${esc(m.brand)}</span>${m.stock && getSetting('stock_on') === '1' ? '<span class="al-stock">В наличии</span>' : ''}</div>
      <h3>${esc(m.model)}</h3>
      ${m.feats.length ? `<ul class="al-f">${m.feats.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="al-bot"><div class="al-price"><b>${rubFmt(m.price)}</b><span>оборудование</span></div>
      <button type="button" class="al-go" data-pick="Сигнализации и автозапуск" data-model="${esc(m.brand + ' ' + m.model)}" aria-label="Записаться на установку ${esc(m.brand + ' ' + m.model)}">Установить</button></div>
    </article>`).join('')}
  </div>`).join('')}
  <div class="al-note">
    <div><p><b>Цены на оборудование актуальны на ${today}.</b> Стоимость установки зависит от автомобиля и комплектации — назовём после осмотра.</p>
    ${brands.includes('StarLine') ? `<a class="al-cert" href="/img/starline-cert.webp" target="_blank" rel="noopener"><img src="/img/starline-cert-600.webp" width="600" height="424" alt="Сертификат StarLine" loading="lazy"><span><b>Сертификат StarLine</b>Оборудование рекомендовано ведущими автопроизводителями — Lada, Geely, Chery, Toyota, Kia, Hyundai, Volkswagen и другими. Нажмите, чтобы открыть.</span></a>` : ''}</div>
    <dl><div><dt>GSM / LTE</dt><dd>управление со смартфона из любой точки</dd></div><div><dt>GPS</dt><dd>местоположение машины на карте</dd></div><div><dt>Bluetooth</dt><dd>смартфон или метка вместо ключа</dd></div><div><dt>LoRa</dt><dd>брелок, который «достаёт» далеко</dd></div></dl>
  </div>
</div></section>`;
}

const SOC_ICON = {
  tg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.2-8.3c.4-.4-.1-.6-.6-.2L6.2 13.1l-4.9-1.5c-1-.3-1.1-1 .2-1.5L20.6 2.8c.9-.3 1.6.2 1.3 1.5z"/></svg>',
  vk: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.8 18.5C6.3 18.5 2.6 14 2.4 6.6h3.3c.1 5.4 2.5 7.7 4.4 8.2V6.6h3.1v4.7c1.9-.2 3.9-2.3 4.5-4.7h3.1c-.5 2.9-2.6 5-4.1 5.9 1.5.7 3.9 2.6 4.8 5.9h-3.4c-.7-2.3-2.5-4-4.9-4.2v4.2z"/></svg>',
  avito: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="16.5" cy="7.5" r="4.5" fill="currentColor"/><circle cx="7" cy="16" r="3.2" fill="currentColor"/><circle cx="17" cy="17.5" r="2.2" fill="currentColor"/><circle cx="7.5" cy="7.5" r="1.8" fill="currentColor"/></svg>',
  max: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5c-5.5 0-9.5 3.9-9.5 9.1 0 2.7 1.1 5 3 6.6l-.6 3.3 3.5-1.6c1.1.4 2.3.6 3.6.6 5.5 0 9.5-3.9 9.5-9S17.5 2.5 12 2.5zm-3.6 12.3H6.7V8.4h1.6l2.2 3.1 2.2-3.1h1.6v6.4h-1.7v-3.7l-2.1 2.9-2.1-2.9zm9.1 0h-1.7V8.4h1.7z"/></svg>',
};
// ---------- Страница «Автозвук» (/avtozvuk) ----------
const ICO = (d) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const PARTS = [
  { t: 'Фронтальная акустика', d: 'Компонентные системы: мидбас в двери, среднечастотник и твитер на подиумах в стойках. От них зависит сцена — звук перед вами, а не из-под ног.', img: '/img/sound-883.webp' },
  { t: 'Сабвуфер', d: 'Короб или стелс под объём багажника и задачу: плотный, быстрый бас, который не гудит и не заглушает музыку.', img: '/img/hero-694.webp' },
  { t: 'Усилители', d: 'Мощность с запасом и чистый сигнал. Подбираем по каналам и нагрузке, ставим с правильным питанием и охлаждением.', ico: ICO('<rect x="6" y="12" width="36" height="24" rx="3"/><path d="M12 30v-6M18 30v-10M24 30v-4M30 30v-12M36 30v-8"/>') },
  { t: 'Процессоры DSP', d: 'Сердце системы: задержки, кроссоверы, эквалайзер по каждому каналу. Без процессора нет настоящей сцены.', ico: ICO('<rect x="12" y="12" width="24" height="24" rx="2"/><path d="M18 6v6M24 6v6M30 6v6M18 36v6M24 36v6M30 36v6M6 18h6M6 24h6M6 30h6M36 18h6M36 24h6M36 30h6"/><path d="M19 27l4-6 3 4 3-3"/>') },
  { t: 'Источник сигнала', d: 'Штатная магнитола, Android-головное устройство или Hi-Res плеер — сохраняем штатные функции и чистоту сигнала.', ico: ICO('<rect x="6" y="10" width="36" height="22" rx="3"/><path d="M14 38h20M24 32v6"/><circle cx="24" cy="21" r="5"/>') },
  { t: 'Провода и питание', d: 'Медные кабели, конденсаторы, дистрибьюторы, разъёмы. Проводка как с завода — в гофре, без скруток.', ico: ICO('<path d="M8 14h10a6 6 0 0 1 6 6v8a6 6 0 0 0 6 6h10"/><circle cx="8" cy="14" r="2"/><circle cx="40" cy="34" r="2"/><path d="M28 10l4 4-4 4M20 30l-4 4 4 4"/>') },
];
const brandCell = (b, sub) => `<li${b.logo ? ' class="haslogo"' : ''}>${b.logo ? `<img class="blogo${/\.jpg\?/.test(b.logo) ? ' jpg' : ''}" src="${esc(b.logo)}" alt="${esc(b.name)}" loading="lazy" onerror="this.parentNode.classList.remove('haslogo');this.remove()">` : ''}<b>${esc(b.name)}</b>${sub && b.country ? `<span>${esc(b.country)}</span>` : ''}</li>`;
// Награды: фото + подпись (добавлять сюда новые; фото — public/img/awards/)
const AWARDS = [
  { img: '/img/awards/sqc2026-baikal-master-stock', car: 'Мастер СТОК', place: '1 место', cls: '', event: 'SQC Club · Кубок Байкала', date: '2026', pos: 'center 45%' },
  { img: '/img/awards/sqc2026-baikal-carmus', car: 'Кубок CARMUS', place: 'Лучший звук · СТОК', cls: '', event: 'SQC Club · Кубок Байкала', date: '2026', pos: 'center 45%' },
  { img: '/img/awards/emma2025-krsk-focus', car: 'Ford Focus', place: '3 место', cls: 'SQ Мастер 8000', event: 'EMMA Россия · XXVIII Чемпионат России по автозвуку и тюнингу · этап Красноярск', date: 'июнь 2025', pos: 'center 62%' },
  { img: '/img/awards/amt2025-krsk-focus', car: 'Ford Focus', place: 'Участник', part: 1, cls: '', event: 'АМТ · Красноярск', date: '2025', pos: 'center 60%' },
];
const awardsBlock = () => !AWARDS.length ? '' : `<section class="awards" id="awards"><div class="wrap">
  <div class="sec-head"><h2>Наши награды</h2><p>Системы, собранные в Бумсистем, на соревнованиях по качеству звучания.</p></div>
  <div class="aw-grid">${AWARDS.map((a) => `<figure class="aw"><img src="${a.img}-480.webp" srcset="${a.img}-480.webp 480w, ${a.img}.webp 960w" sizes="(max-width:640px) 100vw, 380px" alt="${esc([a.car, a.place, a.event].filter(Boolean).join(', '))}" loading="lazy"${a.pos ? ` style="object-position:${a.pos}"` : ''}>
    <figcaption>${a.place ? `<span class="aw-place${a.part ? ' part' : ''}">${esc(a.place)}</span>` : ''}<b>${esc(a.car)}</b>${a.cls ? `<span>${esc(a.cls)}</span>` : ''}<small>${esc(a.event)} · ${esc(a.date)}</small></figcaption></figure>`).join('')}</div>
</div></section>`;
function soundMain(phone, tel) {
  return `
<section class="hero hero-snd"><div class="wrap">
  <div>
    <h1><span>Автозвук уровня</span><span>соревнований.</span></h1>
    <p class="lead">Собираем системы на компонентах мировых брендов и настраиваем их по замерам. Тот же подход, с которым побеждаем на всероссийских соревнованиях по качеству звучания, — в каждой машине клиента.</p>
    <div class="actions"><a class="btn btn-gold" href="/kontakty?svc=%D0%90%D0%B2%D1%82%D0%BE%D0%B7%D0%B2%D1%83%D0%BA">Записаться на подбор</a>${phone ? `<a class="btn btn-line" href="tel:${esc(tel)}">Позвонить</a>` : ''}</div>
    <div class="promise">
      <div><b>Сцена и тембры</b><span>звук перед вами, инструменты на своих местах</span></div>
      <div><b>Настройка по замерам</b><span>микрофон и процессор, а не «на слух»</span></div>
    </div>
  </div>
  <figure class="shot"><div class="ph"><img src="/img/sound-883.webp" srcset="/img/sound-640.webp 640w, /img/sound-883.webp 883w" sizes="(max-width:980px) 100vw, 46vw" alt="Компонентная акустика: мидбас, твитер и кроссовер" fetchpriority="high" style="object-position:center 70%"></div>
    <div class="seal" aria-hidden="true"><i class="ring"></i><i class="ring"></i><i class="ring"></i><svg viewBox="0 0 220 220">${EMBLEM}</svg></div></figure>
</div></section>

<section class="trust comp" id="comp"><div class="wrap">
  <div><h2>Соревновательный опыт</h2><p class="comp-lead">Мы — победители всероссийских соревнований по качеству звучания в классе SQ (Sound Quality), где судьи оценивают не громкость, а качество: точность сцены, тембральный баланс, детальность и динамику. Этот опыт — в основе каждой системы, которую мы собираем.</p>
    <div class="comps"><span>Выступаем и побеждаем на соревнованиях</span><ul><li>AMT Евразия</li><li>EMMA</li><li>SQC Club</li></ul></div>
    <p class="comp-cl"><b>Клиентские автомобили, собранные в Бумсистем, тоже берут призовые места — среди них есть абсолютные чемпионы.</b> Систему такого уровня соберём и для вашей машины.</p></div>
  <dl>
    <div><dt>Сцена</dt><dd>Исполнители — перед вами, на уровне глаз, по ширине лобового стекла.</dd></div>
    <div><dt>Тональный баланс</dt><dd>Ни бубнящего баса, ни режущих верхов — ровно, как задумал звукорежиссёр.</dd></div>
    <div><dt>Детальность</dt><dd>Слышно дыхание вокалиста и хвосты реверберации, даже на скорости.</dd></div>
    <div><dt>Инсталляция</dt><dd>Подиумы, короба и проводка — надёжно, аккуратно, в стиле салона.</dd></div>
  </dl>
</div></section>

${awardsBlock()}

<section class="services parts" id="parts"><div class="wrap">
  <div class="sec-head"><h2>Из чего собираем систему</h2><p>Каждый компонент подбираем под машину, музыку и бюджет — и только потом ставим. Можно начать с фронта и докупать остальное поэтапно.</p></div>
  <div class="pgrid">${PARTS.map((x) => `<article class="part${x.img ? ' has-img' : ''}">${x.img ? `<img src="${x.img}" alt="${esc(x.t)}" loading="lazy">` : `<div class="pico">${x.ico}</div>`}<div><h3>${esc(x.t)}</h3><p>${esc(x.d)}</p></div></article>`).join('')}</div>
</div></section>

<section class="brands" id="brands"><div class="wrap">
  <div class="sec-head"><h2>Бренды, с которыми работаем</h2><p>Мировые и российские производители автозвука: Hi-End из Германии, Италии, Франции, Израиля и США — на них собирают соревновательные SQ-системы. Поможем выбрать линейку под задачу и бюджет.</p></div>
  ${(() => { const L = require('./brands').list(); return `<ul class="blist">${L.map((b) => brandCell(b, false)).join('')}</ul>`; })()}
</div></section>

<section class="steps" id="steps"><div class="wrap">
  <h2>Как собираем систему</h2>
  <ol>
    <li><b>Прослушивание</b><span>Слушаем вашу машину и музыку, обсуждаем, чего не хватает.</span></li>
    <li><b>Подбор</b><span>Предлагаем варианты компонентов под бюджет, можно поэтапно.</span></li>
    <li><b>Подготовка</b><span>Шумоизоляция дверей, питание, подиумы и короба.</span></li>
    <li><b>Монтаж</b><span>Аккуратная коммутация, штатные разъёмы, гарантия.</span></li>
    <li><b>Настройка</b><span>Процессор по замерам микрофоном и контрольное прослушивание.</span></li>
  </ol>
</div></section>
`;
}

function harmonixPage(tel) {
  const features = [
    ['01','Измерения','Импульсный отклик, АЧХ, фаза, время прихода и диагностика качества сигнала.'],
    ['02','Временное согласование','Автоматический расчёт задержек и проверка полярности каналов с учётом структуры системы.'],
    ['03','Кроссоверы','Подбор частот раздела, типов и крутизны фильтров с оценкой согласования соседних полос.'],
    ['04','Эквализация','Коррекция АЧХ по целевой кривой с учётом рабочих диапазонов динамиков.'],
    ['05','i-Halin','Пошаговый мастер измерений и настройки автомобильной аудиосистемы.'],
    ['06','Hand Meter','Инструмент ручного анализа амплитуды, фазы и импульса для контрольных измерений.']
  ];
  return `<section class="hx-hero"><div class="wrap"><div class="hx-panel">
    <div><p class="hx-kicker">BOOMSYSTEM · AUDIO ENGINEERING</p><h1>BS HarmoniX</h1><h2>Точность измерений.<br>Контроль звучания.</h2><p class="hx-lead">Программный комплекс для измерения и автонастройки автомобильных аудиосистем с DSP. Создан студией Бумсистем для установщиков, настройщиков и энтузиастов SQ.</p><div class="hx-actions"><a class="btn btn-gold" href="/kontakty?product=bs-harmonix">Получить консультацию</a><a class="btn btn-line" href="#hx-license">Варианты лицензии</a></div><div class="hx-tags"><span>Windows</span><span>DSP</span><span>Измерительный микрофон</span></div></div>
    <figure class="hx-visual" aria-label="Декоративная схема звукового сигнала"><div class="hx-visual-top"><span>BS / HARMONIX</span><span>ACOUSTIC ANALYSIS</span></div><svg viewBox="0 0 480 240" role="img" aria-label="Иллюстрация частотной характеристики, не результат измерения"><defs><pattern id="hxGrid" width="40" height="30" patternUnits="userSpaceOnUse"><path d="M40 0H0V30" fill="none" stroke="#526a7b" stroke-opacity=".35"/></pattern><linearGradient id="hxGlow" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#82cdec"/><stop offset="1" stop-color="#e9f4fb"/></linearGradient></defs><rect width="480" height="240" fill="url(#hxGrid)"/><path d="M0 180C28 178 32 115 58 119S95 148 122 104 155 65 186 93 225 102 254 90 283 107 311 80 351 114 380 93 414 104 440 115 465 142 480 160" fill="none" stroke="url(#hxGlow)" stroke-width="3"/><path d="M0 204Q70 201 96 176T160 142 230 151 300 130 370 150 430 170 480 212" fill="none" stroke="#5b8197" stroke-width="2" stroke-dasharray="5 6"/></svg><div class="hx-visual-bottom"><span>TIME ALIGNMENT</span><span>PHASE · EQ · CROSSOVER</span></div><figcaption>Концептуальная иллюстрация анализа сигнала</figcaption></figure>
  </div></div></section>
  <section class="hx-section"><div class="wrap"><div class="sec-head"><h2>Инструменты настройки</h2><p>От первого замера до расчёта параметров DSP и контрольной проверки.</p></div><div class="hx-grid">${features.map(([n,t,d])=>`<article class="hx-card"><span>${n}</span><h3>${t}</h3><p>${d}</p></article>`).join('')}</div></div></section>
  <section class="hx-section"><div class="wrap"><h2>Рабочий процесс</h2><ol class="hx-steps"><li><b>Подключите</b> звуковую карту и измерительный микрофон.</li><li><b>Измерьте</b> каналы и задайте состав системы.</li><li><b>Рассчитайте</b> задержки, фильтры и коррекцию.</li><li><b>Проверьте</b> результат контрольными замерами и перенесите параметры в DSP.</li></ol></div></section>
  <section class="hx-section" id="hx-license"><div class="wrap"><div class="sec-head"><h2>Лицензии</h2><p>Выберите формат знакомства с программой. Условия приобретения уточняйте у студии.</p></div><div class="hx-licenses"><article class="hx-card"><span>TRIAL · 48 ЧАСОВ</span><h3>Пробная версия</h3><p>Доступ к i-Halin на 48 часов. Остальные модули, включая Hand Meter, доступны в полной версии.</p><a class="btn btn-line" href="/kontakty?product=bs-harmonix&amp;license=trial">Запросить пробную лицензию</a></article><article class="hx-card hx-full"><span>FULL VERSION</span><h3>Полная версия</h3><p>Полный набор доступных инструментов измерения, автоматической и ручной настройки.</p><a class="btn btn-gold" href="/kontakty?product=bs-harmonix&amp;license=full">Узнать стоимость и приобрести</a></article></div></div></section>
  <section class="cta"><div class="wrap"><div class="cta-in"><div><h2>BS HarmoniX от Бумсистем</h2><p>Расскажем о возможностях программы, оборудовании и лицензировании.</p></div><div class="cta-btns"><a class="btn btn-gold" href="/kontakty?product=bs-harmonix">Связаться с нами</a>${tel ? `<a class="btn btn-line" href="tel:${esc(tel)}">Позвонить</a>` : ''}</div></div></div></section>`;
}

function render({ loggedIn = false, page = 'home' } = {}) {
  const isSnd = page === 'sound', isWk = page === 'works';
  const isHome = page === 'home', hasForm = isHome || page === 'contacts';
  const phone = getSetting('company_phone') || '';
  // в Настройках может быть несколько номеров через запятую — каждый отдельной ссылкой
  const phones = (phone.match(/(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/g) || (phone ? [phone] : [])).map((x) => x.trim());
  const telOf = (x) => x.replace(/[^\d+]/g, '');
  const tel = phones.length ? telOf(phones[0]) : '';
  const address = getSetting('company_address') || '';
  const h = hoursText();
  const map = address ? `https://yandex.ru/maps/?text=${encodeURIComponent(address)}` : '';
  const year = new Date().getFullYear();
  const [sound, noise, alarm, media, cam, print3d, diag] = GROUPS;
  const alarms = alarmsBlock();
  const works = worksBlock({ page: isWk });
  const socials = [['tg', 'Telegram', getSetting('social_tg')], ['vk', 'ВКонтакте', getSetting('social_vk')], ['max', 'MAX', getSetting('social_max')], ['avito', 'Авито', getSetting('social_avito')]].filter((x) => /^https:\/\//.test(x[2] || ''));
  const rvOn = !!(getSetting('twogis_url') || all('SELECT 1 FROM site_reviews WHERE visible=1 LIMIT 1').length);


  // ---------- страницы сайта: каждый раздел — своя короткая страница ----------
  const featured = AWARDS.find((award) => award.img === '/img/awards/emma2025-krsk-focus');
  const FEATURED = featured ? `<section class="featured"><div class="wrap featured-grid">
    <img src="${featured.img}-480.webp" srcset="${featured.img}-480.webp 480w, ${featured.img}.webp 960w" sizes="(max-width:640px) 100vw, 46vw" alt="Ford Focus на соревнованиях EMMA в Красноярске" loading="lazy" decoding="async" style="object-position:${featured.pos}">
    <div><h2>Ford Focus на EMMA</h2><p>Система студии заняла <strong>3-е место</strong> в классе SQ Мастер 8000 на этапе чемпионата России в Красноярске в июне 2025 года.</p>
    <a class="btn btn-line" href="/raboty#sound">Посмотреть работы по автозвуку</a></div>
  </div></section>` : '';
  const HERO_S = `<section class="hero"><div class="wrap">
  <div>
    <p class="bs-kicker">Бумсистем</p><h1>Автозвук, шумоизоляция и автосигнализации в Ангарске</h1>
    <p class="lead">Инженерия звука. Искусство установки. Настраиваем аудиосистемы по замерам и подбираем оборудование под ваш автомобиль.</p>
    <div class="actions"><a class="btn btn-gold" href="#order" data-lead-open>Обсудить проект</a><a class="btn btn-line" href="/raboty">Наши работы</a></div>
    <div class="promise">
      <div><b>Гарантия</b><span>на работы и установленное оборудование</span></div>
      <div><b>Фотоотчёт</b><span>фиксируем состояние машины при приёмке</span></div>
    </div>
  </div>
  <figure class="shot">
    <div class="ph"><img src="${HERO.img}-${HERO.sizesLocal.at(-1)}.webp" srcset="${srcset(HERO.img, HERO.sizesLocal)}" sizes="(max-width:980px) 100vw, 46vw" alt="${esc(HERO.alt)}" fetchpriority="high" onerror="this.remove()"></div>
    <div class="seal" aria-hidden="true"><i class="ring"></i><i class="ring"></i><i class="ring"></i><svg viewBox="0 0 220 220">${EMBLEM}</svg></div>
  </figure>
</div></section>`;
  const SERVICES_S = `<section class="services" id="services"><div class="wrap">
  <div class="sec-head"><h2>Что мы делаем</h2><p>Стоимость автозвука зависит от состава системы и штатного оборудования, а шумоизоляции — от автомобиля, выбранных зон и материалов. Смету согласуем после осмотра.</p></div>
  <div class="grid">
    ${card(sound, 'big', '(max-width:640px) 100vw, (max-width:1060px) 100vw, 66vw')}
    ${card(noise, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw')}
    ${card(alarms ? { ...alarm, more: '/signalizacii' } : alarm, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw', 'Модели и цены')}
    ${card(media, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw')}
    ${card(cam, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw')}
    ${card(print3d, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw')}
    ${card(diag, 'wide', '100vw')}
  </div>
</div></section>`;
  const TRUST_S = `<section class="trust"><div class="wrap">
  <h2>Сделано так, чтобы не возвращаться</h2>
  <dl>
    <div><dt>Звук по замерам</dt><dd>Настраиваем процессор по микрофону, а не на слух «как получится».</dd></div>
    <div><dt>Проводка как с завода</dt><dd>Штатные разъёмы, гофра и изоляция — без скруток и свисающих проводов.</dd></div>
    <div><dt>Автозапуск в мороз</dt><dd>Настраиваем запуск по температуре и времени, проверяем на вашей машине.</dd></div>
    <div><dt>Документы на всё</dt><dd>Акт приёма с фото, заказ-наряд и гарантийный талон на каждую работу.</dd></div>
  </dl>
</div></section>`;
  const STEPS_S = `<section class="steps" id="steps"><div class="wrap">
  <h2>Как проходит работа</h2>
  <ol>
    <li><b>Заявка</b><span>Оставляете заявку на сайте или звоните.</span></li>
    <li><b>Подбор</b><span>Перезваниваем, уточняем задачу, предлагаем варианты.</span></li>
    <li><b>Запись</b><span>Назначаем удобный день и время, чтобы вы не ждали в очереди.</span></li>
    <li><b>Работа</b><span>Принимаем машину по акту с фото, работаем по заказ-наряду.</span></li>
    <li><b>Выдача</b><span>Показываем результат, выдаём документы и гарантийный талон.</span></li>
  </ol>
</div></section>`;
  const ORDER = `<section class="order" id="order"><div class="wrap">
  <div>
    <h2>Оставьте заявку</h2>
    <p>Напишите, что хотите сделать, — перезвоним в рабочее время и подскажем по срокам и решению.</p>
    <div class="contacts">
      ${phones.length ? `<div><span>${phones.length > 1 ? 'Телефоны' : 'Телефон'}</span>${phones.map((x) => `<a href="tel:${esc(telOf(x))}" style="display:block">${esc(x)}</a>`).join('')}</div>` : ''}
      ${address ? `<div><span>Адрес</span>${map ? `<a href="${esc(map)}" target="_blank" rel="noopener">${esc(address)}</a>` : esc(address)}</div>` : ''}
      <div><span>Режим работы</span>${esc(h.days)}, ${esc(h.time)}${h.off ? `, выходной: ${esc(h.off)}` : ''}</div>
      ${socials.length ? `<div><span>Мы в соцсетях</span><div class="soc">${socials.map(([k, n, u]) => `<a class="soc-${k}" href="${esc(u)}" target="_blank" rel="noopener" aria-label="${n}">${SOC_ICON[k]}<b>${n}</b></a>`).join('')}</div></div>` : ''}
    </div>
  </div>
  <div id="formBox">
  <form id="leadForm" novalidate>
    <div class="f2">
      <label>Как к вам обращаться<input name="name" autocomplete="name" maxlength="100" required></label>
      <label>Телефон<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7" maxlength="30" required></label>
    </div>
    <p id="leadContext" class="lead-context" hidden></p>
    <details id="leadDetails" class="lead-details">
      <summary>Добавить детали</summary>
    <label>Автомобиль<input name="car" placeholder="Например: Toyota Camry 2019" maxlength="120"></label>
    <div><div style="font-size:14px;color:#aeb9c1;margin-bottom:8px" id="svcLbl">Что нужно сделать</div>
      <div class="chips" role="group" aria-labelledby="svcLbl">${GROUPS.map((g) => `<label><input type="checkbox" name="svc" value="${esc(g.title)}"${isSnd && g.key === 'sound' ? ' checked' : ''}><span>${esc(g.title)}</span></label>`).join('')}</div></div>
    <label>Комментарий<textarea name="message" maxlength="2000" placeholder="Что важно учесть: бюджет, сроки, какое оборудование уже есть"></textarea></label>
    </details>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <label class="agree"><input type="checkbox" name="agree" required><span>Согласен на обработку персональных данных — только чтобы связаться со мной по этой заявке.</span></label>
    <div><button class="btn btn-gold" type="submit" id="sendBtn">Отправить заявку</button></div>
    <div class="msg" id="msg" role="status" aria-live="polite"></div>
  </form>
  </div>
</div></section>`;
  const CTA = `<section class="cta"><div class="wrap"><div class="cta-in"><div><h2>Обсудим вашу машину?</h2><p>Оставьте заявку — перезвоним в рабочее время, подскажем решение и сроки.</p></div>
    <div class="cta-btns"><a class="btn btn-gold" href="/kontakty${isSnd ? '?svc=' + encodeURIComponent('Автозвук') : ''}#order" data-lead-open>Оставить заявку</a>${tel ? `<a class="btn btn-line" href="tel:${esc(tel)}">Позвонить</a>` : ''}</div></div></div></section>`;
  const TILES = [['/avtozvuk', 'Автозвук', 'Системы уровня соревнований и настройка по замерам', sound],
    alarms ? ['/signalizacii', 'Сигнализации', 'StarLine и Pandora с автозапуском — цены и модели', alarm] : null,
    ['/uslugi', 'Все услуги', 'Шумоизоляция, мультимедиа, камеры, 3D-печать, диагностика', noise],
    ['/raboty', 'Наши работы', 'Фото проектов по разделам', media]].filter(Boolean);
  const HOME_TILES = `<section class="tiles"><div class="wrap"><div class="tl-grid">${TILES.map(([href, t, d, g]) => `<a class="tl" href="${href}">
      <img src="${g.img}-${(g.sizesLocal || [800]).at(0)}.webp" alt="" loading="lazy" decoding="async" onerror="this.remove()"><span class="tl-b"><b>${esc(t)}</b><i>${esc(d)}</i></span><span class="tl-go" aria-hidden="true">→</span></a>`).join('')}</div>
    <div class="tl-row"><a href="/bs-harmonix">BS HarmoniX — программа настройки DSP</a><a href="/otzyvy">★ Отзывы клиентов</a><a href="/uslugi#steps">Как проходит работа</a><a href="/kontakty">Адрес и режим работы</a></div></div></section>`;
  const PAGES = {
    home: () => HERO_S + FEATURED + SERVICES_S + works + `<section class="bs-product"><div class="wrap"><div class="bs-product-in"><div><p class="bs-kicker">СОБСТВЕННАЯ РАЗРАБОТКА</p><h2>BS HarmoniX</h2><p>Измерение, анализ и автонастройка автомобильных аудиосистем с DSP.</p><a class="btn btn-gold" href="/bs-harmonix">О программе →</a></div><div class="bs-product-art" aria-hidden="true"><svg viewBox="0 0 480 180"><path d="M0 90H480M0 45H480M0 135H480" stroke="#516778" fill="none" stroke-dasharray="4 6"/><path d="M0 125 Q30 125 48 75T95 95 140 45 185 80 230 52 275 83 320 56 365 88 410 78 480 110" fill="none" stroke="#84cbea" stroke-width="3"/></svg><span>MEASURE / ALIGN / TUNE</span></div></div></div></section>` + awardsBlock() + TRUST_S + (reviewsBlock() || ''),
    services: () => SERVICES_S + STEPS_S,
    sound: () => soundMain(phone, tel),
    harmonix: () => harmonixPage(tel),
    alarms: () => alarms || SERVICES_S,
    works: () => works,
    reviews: () => (reviewsBlock() || '') + TRUST_S,
    contacts: () => '',
  };
  const MAIN = (PAGES[page] || PAGES.home)();
  const NAV = [['/uslugi', 'Услуги', 'services'], ['/avtozvuk', 'Автозвук', 'sound'], ['/bs-harmonix', 'BS HarmoniX', 'harmonix'], alarms ? ['/signalizacii', 'Сигнализации', 'alarms'] : null, ['/raboty', 'Работы', 'works'],
    rvOn ? ['/otzyvy', 'Отзывы', 'reviews'] : null, ['/kontakty', 'Контакты', 'contacts']].filter(Boolean);
  const NAV_HTML = NAV.map(([h, t, k]) => `<a href="${h}"${k === page ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  const TITLES = { home: 'Бумсистем — автозвук, сигнализации с автозапуском, шумоизоляция в Ангарске', services: 'Услуги — автозвук, шумоизоляция, сигнализации, мультимедиа | Бумсистем',
    sound: 'Автозвук в Ангарске — системы уровня SQ: Brax, Helix, Audison, Focal, Morel, JL Audio | Бумсистем', alarms: 'Автосигнализации StarLine и Pandora с автозапуском — цены и установка | Бумсистем',
    harmonix: 'BS HarmoniX — программа измерения и настройки автозвука | Бумсистем', works: 'Наши работы — автозвук, автосигнализации, шумоизоляция | Бумсистем, Ангарск', reviews: 'Отзывы клиентов | Бумсистем, Ангарск', contacts: 'Контакты и заявка | Бумсистем, Ангарск' };
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(TITLES[page] || TITLES.home)}</title>
<meta name="description" content="${page === 'harmonix' ? 'BS HarmoniX — программа для измерения и настройки автомобильных аудиосистем: i-Halin, задержки, кроссоверы, эквализация и Hand Meter.' : isWk ? 'Фото работ студии Бумсистем по разделам: автозвук, автосигнализации с автозапуском, шумоизоляция и другие проекты.' : isSnd ? 'Автозвук уровня соревнований: компоненты Brax, Helix, Match, Audison, Hertz, Focal, Morel, JL Audio, Recoil Audio, процессоры DSP и настройка по замерам. Опыт соревнований в классе SQ. Бумсистем.' : 'Тюнинг-ателье Бумсистем: премиальный автозвук, шумоизоляция, сигнализации StarLine и Pandora с автозапуском, мультимедиа, камеры и 3D-печать деталей. Оставьте заявку — перезвоним.'}">
<meta name="theme-color" content="#EEF2F4">
<link rel="icon" type="image/png" href="/favicon-64.png"><link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://images.unsplash.com">
<link rel="preload" as="image" href="${HERO.img}-${HERO.sizesLocal.at(-1)}.webp" imagesrcset="${srcset(HERO.img, HERO.sizesLocal)}" imagesizes="(max-width:980px) 100vw, 46vw">
<link rel="preload" as="font" type="font/woff2" href="/fonts/unbounded-cyrillic-800-normal.woff2" crossorigin><link rel="stylesheet" href="/fonts/fonts.css">
<script>if (/^#\\//.test(location.hash)) location.replace('/crm' + location.hash);</script>
<style>
:root{--paper:#E3E9ED;--ice:rgba(214,225,232,.75);--ink:#0D1820;--text:#1a2630;--muted:#4b5a66;--baikal:#2B6A88;--frost:rgba(132,155,171,.38);--amber:#86CDEB;--amber-ink:#0b1a22;--white:#fff;--night:#0b141b;
  --steel:linear-gradient(180deg,#f6f9fb 0%,#d3dce2 46%,#aebcc6 54%,#dfe6eb 100%);--glass:rgba(246,249,251,.62);--glass2:rgba(255,255,255,.74);
  --display:'Unbounded','Arial Black',Arial,sans-serif;--body:'Golos Text',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;--wrap:1320px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body::before,body::after{content:'';position:fixed;inset:0;z-index:-2;pointer-events:none}
body::before{background:#c9d5dc url('${IMG(ICE.img, 1920)}') center/cover no-repeat;filter:saturate(.75)}
body::after{z-index:-1;background:linear-gradient(180deg,rgba(230,236,240,.74) 0%,rgba(220,229,235,.64) 50%,rgba(208,219,227,.80) 100%)}
body{margin:0;background:transparent;color:var(--text);font:17px/1.6 var(--body);-webkit-font-smoothing:antialiased}
a{color:var(--baikal)}a:hover{color:var(--ink)}
:focus-visible{outline:3px solid var(--amber);outline-offset:3px;border-radius:4px}
.wrap{max-width:var(--wrap);margin:0 auto;padding:0 clamp(16px,3vw,40px)}
section[id]{scroll-margin-top:112px}
h1,h2,h3{font-family:var(--display);color:var(--ink);margin:0;letter-spacing:-.015em}
h1{font-size:clamp(26px,3.1vw,46px);line-height:1.1;font-weight:800}
h2{font-size:clamp(28px,3.4vw,44px);line-height:1.1;font-weight:800}
h3{font-size:21px;line-height:1.2;font-weight:600}
p{margin:0 0 1em;max-width:62ch}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;font:600 16px/1 var(--body);border-radius:999px;padding:17px 30px;text-decoration:none;cursor:pointer;border:2px solid var(--ink);transition:background .15s,color .15s}
.btn-gold{background:var(--steel);color:var(--ink);border:1px solid #8496a3;box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 10px 24px -14px rgba(13,24,32,.7);text-shadow:0 1px 0 rgba(255,255,255,.6)}.btn-gold:hover{filter:brightness(1.05);color:var(--ink)}
.btn-line{background:transparent;color:var(--ink)}.btn-line:hover{background:var(--ink);color:var(--white)}

/* шапка */
.top{position:sticky;top:0;z-index:20;background:rgba(228,235,239,.72);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid var(--frost)}
.top .wrap{display:flex;align-items:center;gap:28px;height:112px}
.home{display:block;color:var(--ink);text-decoration:none}
.logo{height:88px;width:auto;color:var(--ink);display:block}
.logo .lw{font-family:var(--display);font-weight:800;font-size:80px}.logo .lt{font-family:var(--display);font-weight:400;font-size:16px;letter-spacing:3px}
.top nav{display:flex;gap:clamp(16px,1.6vw,26px);margin-left:auto}.top nav a{color:var(--text);text-decoration:none;font-weight:500;white-space:nowrap}.top nav a:hover{color:var(--baikal)}
.top .tel2{margin-left:-14px}.top .tel{font-weight:600;color:var(--ink);text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;gap:8px}.top .tel svg{width:18px;height:18px;flex:none}

/* первый экран */
.hero{padding:56px 0 96px;overflow:hidden}
.hero .wrap{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);gap:56px;align-items:center}
.hero h1 span{display:block}
.hero h1 span+span{color:var(--baikal);background:linear-gradient(100deg,#1d4a62 0%,#3f7fa0 45%,#6d97ad 70%,#2b5870 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.lead{font-size:20px;color:var(--muted);margin:28px 0 36px;max-width:44ch}
.hero .actions{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.promise{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));max-width:560px;gap:22px;margin-top:48px;padding-top:26px;border-top:1px solid var(--frost)}
.promise b{display:block;color:var(--ink);font:600 16px/1.3 var(--display);margin-bottom:6px}.promise span{font-size:15px;color:var(--muted)}
.shot{position:relative;margin:0}
.shot .ph{position:relative;aspect-ratio:4/5;border-radius:28px 28px 28px 120px;overflow:hidden;background:linear-gradient(160deg,#25343e,#0a1218);box-shadow:0 40px 80px -30px rgba(10,18,24,.55)}
.shot .ph img{width:100%;height:100%;object-fit:cover;display:block}
.shot .ph::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(10,18,24,.35))}
.seal{position:absolute;left:-34px;bottom:46px;width:136px;height:136px;border-radius:50%;background:var(--steel);display:grid;place-items:center;color:var(--ink);box-shadow:0 18px 40px -16px rgba(10,18,24,.5);--bg-e:var(--paper)}
.seal svg{width:104px;height:104px;position:relative;z-index:1}
.ring{position:absolute;inset:8px;border-radius:50%;border:2px solid var(--baikal);opacity:0}
@media (prefers-reduced-motion:no-preference){
  .ring{animation:wave 1.6s cubic-bezier(.2,.6,.3,1) .7s 3 both}.ring:nth-child(2){animation-delay:.95s}.ring:nth-child(3){animation-delay:1.2s}
  .cone{transform-origin:110px 110px;animation:thump 1.6s ease-out .7s 3}
}
@keyframes wave{0%{transform:scale(.8);opacity:.6}100%{transform:scale(1.9);opacity:0}}
@keyframes thump{0%{transform:scale(1)}8%{transform:scale(1.07)}22%{transform:scale(.985)}40%,100%{transform:scale(1)}}

/* страница Автозвук */
.svc-btns{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.svc-more{color:#fff;font:600 14px var(--body);text-decoration:none;border-bottom:1px solid rgba(255,255,255,.5);padding-bottom:1px}.svc-more:hover{color:var(--amber)}
.comp .wrap{align-items:start}.awards{padding:96px 0}.aw-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,380px));gap:18px}
.aw{margin:0;background:var(--glass2);border:1px solid var(--frost);border-radius:20px;overflow:hidden;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.aw img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}
.aw figcaption{padding:18px 20px 20px;display:grid;gap:4px}.aw b{font:700 20px/1.2 var(--display);color:var(--ink)}.aw span{color:var(--text);font-size:15px}.aw small{color:var(--muted);font-size:13px;line-height:1.45}
.aw .aw-place{justify-self:start;padding:6px 12px;border-radius:999px;background:linear-gradient(180deg,#fbe8a6,#d9a93a 55%,#f3d27a);color:#3a2a00;font:700 13px/1 var(--display);letter-spacing:.02em;margin-bottom:4px}
.aw .aw-place.part{background:var(--steel);color:var(--ink);border:1px solid #8496a3}
@media (max-width:640px){.awards{padding:64px 0}.aw-grid{grid-template-columns:1fr}}
.comps{margin-top:26px}.comp-cl{margin-top:22px;padding:16px 18px;border-left:3px solid #9fc7dc;background:rgba(255,255,255,.05);border-radius:0 12px 12px 0;color:#b8c6cf;font-size:15px;max-width:52ch}.comp-cl b{color:#fff;font-weight:600}.comps span{display:block;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8fa3b0;margin-bottom:10px}.comps ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}.comps li{padding:9px 16px;border-radius:999px;background:var(--steel);color:var(--ink);font:700 15px/1 var(--display);box-shadow:inset 0 1px 0 rgba(255,255,255,.9)}.comp-lead{color:#b8c6cf;margin-top:18px;max-width:46ch}
.pgrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.part{background:var(--glass2);border:1px solid var(--frost);border-radius:20px;overflow:hidden;display:flex;flex-direction:column;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.part img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block}.part>div:last-child{padding:20px 22px 22px}.part h3{font-size:19px;margin-bottom:8px}.part p{font-size:15px;color:var(--muted);margin:0}
.pico{aspect-ratio:16/10;display:grid;place-items:center;background:linear-gradient(150deg,#26343e,#0e1820);color:#9fc7dc}.pico svg{width:84px;height:84px;stroke-width:1.6}
.brands{padding:96px 0}.blist{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
.blist li{display:grid;place-items:center;min-height:96px;padding:12px;border-radius:18px;background:var(--steel);border:1px solid #8496a3;box-shadow:inset 0 1px 0 rgba(255,255,255,.9);color:var(--ink);text-align:center}.blist b{display:block;font:800 clamp(18px,2vw,26px)/1.1 var(--display);letter-spacing:-.01em}.b2h{margin:28px 0 12px;font-size:16px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-family:var(--body);font-weight:600}.blist.b2{grid-template-columns:repeat(6,minmax(0,1fr))}.blist.b2 li{min-height:72px;background:var(--glass2);box-shadow:none;border-color:var(--frost)}.blist.b2 b{font-size:clamp(15px,1.4vw,19px)}
.blogo{display:block;max-width:86%;max-height:60px;width:auto;height:auto;object-fit:contain;filter:brightness(0);opacity:.92}.blist.b2 .blogo{max-height:30px}.blogo.jpg{filter:grayscale(1) contrast(1.2);mix-blend-mode:multiply}.blist li.haslogo b{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.blist li{position:relative}.blist li.haslogo span{margin-top:10px}
.blist span{display:block;margin-top:6px;font-size:13px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
@media (max-width:1060px){.blist.b2{grid-template-columns:repeat(3,minmax(0,1fr))}.pgrid{grid-template-columns:repeat(2,minmax(0,1fr))}.blist{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:640px){.pgrid{grid-template-columns:1fr}.blist{grid-template-columns:repeat(2,minmax(0,1fr))}.brands{padding:64px 0}}

/* витрина сигнализаций */
.alarms{padding:104px 0}
.al-tabs{display:inline-flex;gap:6px;padding:6px;background:var(--glass2);border:1px solid var(--frost);border-radius:999px;margin-bottom:28px}
.al-tabs button{font:600 16px/1 var(--body);border:0;background:none;color:var(--muted);padding:13px 22px;border-radius:999px;cursor:pointer;display:inline-flex;gap:10px;align-items:center}
.al-tabs button span{font-size:12px;font-weight:600;background:var(--ice);color:var(--muted);border-radius:999px;padding:4px 8px}
.al-tabs button[aria-selected=true]{background:linear-gradient(180deg,#3a4b57,#16232c);color:var(--white)}.al-tabs button[aria-selected=true] span{background:#2a3138;color:#cfd8de}
.al-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.al-grid[data-off]{display:none}
.al{background:var(--glass2);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid var(--frost);border-radius:20px;padding:22px 22px 20px;display:flex;flex-direction:column;gap:12px;transition:border-color .15s,box-shadow .15s,transform .15s}
.al:hover{border-color:#a9bcc6;box-shadow:0 22px 40px -28px rgba(10,18,24,.45);transform:translateY(-2px)}
.al-pack{margin:-8px -8px 4px;height:190px;border-radius:14px;display:grid;place-items:center;background:radial-gradient(120% 90% at 50% 95%,#ffffff 0%,#eef3f6 45%,#d9e3ea 100%);border:1px solid var(--frost);position:relative;overflow:hidden}
.al-pack::after{content:'';position:absolute;left:18%;right:18%;bottom:14px;height:14px;border-radius:50%;background:radial-gradient(closest-side,rgba(13,24,32,.28),transparent);z-index:0}
.al-pack img{position:relative;z-index:1;max-width:86%;max-height:160px;width:auto;height:auto;filter:drop-shadow(0 14px 14px rgba(13,24,32,.22));transition:transform .35s cubic-bezier(.2,.7,.3,1)}
.al-pack.wb img{mix-blend-mode:multiply;filter:none}
.al:hover .al-pack img{transform:translateY(-6px) scale(1.04) rotate(-1.2deg)}
.al-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.al-brand{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--baikal)}
.al-stock{font-size:12px;font-weight:600;color:#1f6b3d;background:#e3f2e8;border-radius:999px;padding:4px 10px}
.al h3{font-size:20px;overflow-wrap:anywhere}
.al-f{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.al-f li{font-size:13px;font-weight:500;color:var(--text);background:var(--ice);border-radius:8px;padding:5px 9px}
.al-bot{margin-top:auto;padding-top:14px;border-top:1px solid var(--ice);display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.al-price b{display:block;font:800 24px/1.1 var(--display);color:var(--ink);white-space:nowrap}.al-price span{font-size:13px;color:var(--muted)}
.al-go{font:600 15px/1 var(--body);background:var(--steel);color:var(--ink);border:1px solid #8496a3;box-shadow:inset 0 1px 0 rgba(255,255,255,.9);border-radius:999px;padding:12px 18px;cursor:pointer}.al-go:hover{filter:brightness(1.05)}
.al-note{margin-top:28px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:32px;align-items:start;padding:24px 26px;border-radius:20px;background:var(--glass);border:1px solid var(--frost)}
.al-note p{margin:0;font-size:15px;color:var(--muted)}.al-note p b{color:var(--ink);font-weight:600}
.soc{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}.soc a{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;border:1.5px solid rgba(160,180,194,.35);color:var(--white);text-decoration:none;font-size:15px}.soc a:hover{background:rgba(255,255,255,.08)}.soc svg{width:18px;height:18px}.soc b{font-weight:600}
.foot-soc{display:inline-flex;align-items:center;gap:14px}.foot-soc a{color:var(--muted);display:inline-flex}.foot-soc a:hover{color:var(--ink)}.foot-soc svg{width:20px;height:20px}
.al-cert{display:flex;gap:14px;align-items:center;margin-top:16px;text-decoration:none;color:var(--muted);font-size:13px;line-height:1.45}.al-cert img{width:132px;height:auto;border-radius:10px;border:1px solid var(--frost);box-shadow:0 10px 24px -16px rgba(13,24,32,.6);flex:none;transition:transform .15s}.al-cert:hover img{transform:scale(1.03)}.al-cert b{display:block;color:var(--ink);font-size:14px;margin-bottom:2px}
.al-note dl{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;font-size:14px}
.al-note dt{font-weight:600;color:var(--ink)}.al-note dd{margin:0;color:var(--muted)}
@media (max-width:980px){.al-note{grid-template-columns:1fr;gap:18px}}
@media (max-width:640px){.alarms{padding:64px 0}.al-tabs{display:flex}.al-tabs button{flex:1;justify-content:center;padding:12px 10px}.al-note dl{grid-template-columns:1fr}.al-grid{grid-template-columns:1fr}}

/* услуги — журнальная сетка фото */
.services{padding:104px 0;background:var(--glass);border-top:1px solid var(--frost);border-bottom:1px solid var(--frost)}
.sec-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px;align-items:end;margin-bottom:44px}
.sec-head p{color:var(--muted);margin:0;justify-self:end;max-width:44ch}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:300px;gap:18px}
.svc{position:relative;overflow:hidden;border-radius:22px;background:linear-gradient(160deg,#2b3d48,#0a1218);color:#e9eff2;isolation:isolate}
.svc img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;transition:transform .6s cubic-bezier(.2,.6,.3,1)}
.svc::before{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(10,18,24,0) 30%,rgba(10,18,24,.55) 58%,rgba(10,18,24,.92) 100%)}
.svc:hover img{transform:scale(1.04)}
.svc-body{position:absolute;left:0;right:0;bottom:0;padding:26px 26px 24px}
.svc h3{color:var(--white);margin-bottom:8px}
.svc p{font-size:15px;line-height:1.5;color:#c9d4da;margin:0 0 16px;max-width:46ch}
.svc button{background:rgba(255,255,255,.12);border:1.5px solid rgba(255,255,255,.55);color:var(--white);border-radius:999px;padding:10px 18px;font:600 14px var(--body);cursor:pointer;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.svc button:hover{background:var(--steel);border-color:#dfe6eb;color:var(--ink)}
.svc.big{grid-column:span 2;grid-row:span 2}.svc.big h3{font-size:clamp(26px,2.6vw,36px);font-weight:800}.svc.big p{font-size:17px}
.svc.wide{grid-column:span 3;grid-row:span 1}
.svc.wide::before{background:linear-gradient(90deg,rgba(10,18,24,.92) 0%,rgba(10,18,24,.7) 42%,rgba(10,18,24,.05) 75%)}
.svc.wide .svc-body{top:0;right:auto;width:min(560px,60%);display:flex;flex-direction:column;justify-content:center;align-items:flex-start}

/* надёжность — тёмная полоса */
.trust{background:linear-gradient(135deg,rgba(14,24,32,.93),rgba(40,56,68,.88));border-top:1px solid rgba(255,255,255,.12);color:#c9d4da;padding:84px 0}
.trust .wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:56px;align-items:start}
.trust h2{color:var(--white)}
.trust dl{display:grid;grid-template-columns:1fr 1fr;gap:30px 40px;margin:0}
.trust dt{font:600 18px/1.3 var(--display);color:var(--white);margin-bottom:6px}
.trust dd{margin:0;font-size:15px;color:#9fb0ba}

/* отзывы */
.works{padding:96px 0}.works-page{padding-top:40px}.works-page h1{font:800 clamp(30px,4vw,48px)/1.1 var(--display);margin:0 0 10px;color:var(--ink)}
.wk-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}.wk-tab{font:600 15px var(--body);padding:10px 16px;border-radius:999px;border:1px solid var(--frost);background:var(--glass2);color:var(--ink);cursor:pointer;display:inline-flex;gap:8px;align-items:center}
.wk-tab span{font-size:12px;background:rgba(13,24,32,.08);border-radius:999px;padding:2px 8px}.wk-tab.on{background:var(--ink);color:#fff;border-color:var(--ink)}.wk-tab.on span{background:rgba(255,255,255,.18)}
.wk-empty{color:var(--muted);text-align:center;padding:30px 0}.wk-all{text-align:center;margin-top:24px}.wk[hidden]{display:none}.wk-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}
.wk{background:var(--glass2);border:1px solid var(--frost);border-radius:20px;overflow:hidden;display:flex;flex-direction:column}
.wk-media{position:relative;display:block;width:100%;aspect-ratio:4/3;padding:0;border:0;background:#0d1820;cursor:zoom-in;overflow:hidden}
.wk-media img,.wk-media video{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s}.wk:hover .wk-media img,.wk:hover .wk-media video{transform:scale(1.04)}
.wk-n{position:absolute;right:10px;bottom:10px;background:rgba(10,18,24,.75);color:#fff;font:600 12px var(--body);padding:5px 10px;border-radius:999px}
.wk-play{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:44px;text-shadow:0 4px 18px rgba(0,0,0,.6)}
.wk-body{padding:18px 20px 20px}.wk-body h3{font-size:18px;margin:0 0 8px}.wk-body p{margin:0;font-size:14px;line-height:1.5;color:var(--muted);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.wkd{border:0;padding:0;border-radius:20px;max-width:min(920px,94vw);width:100%;background:#0d1820;color:#e9eff2}.wkd::backdrop{background:rgba(5,10,14,.82)}
.wkd-in{position:relative;padding:0 0 20px}.wkd-media{background:#000;display:grid;place-items:center;max-height:70vh}.wkd-media img,.wkd-media video{max-width:100%;max-height:70vh;display:block}
.wkd-x{position:absolute;top:10px;right:10px;z-index:2;width:40px;height:40px;border-radius:50%;border:0;background:rgba(255,255,255,.15);color:#fff;font-size:18px;cursor:pointer}
.wkd-nav{display:flex;justify-content:center;align-items:center;gap:16px;padding:10px}.wkd-nav button{width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.3);background:none;color:#fff;font-size:22px;cursor:pointer}
.wkd h3{padding:0 22px;margin:4px 0 8px;color:#fff}.wkd-text{padding:0 22px;margin:0;white-space:pre-line;color:#c9d4da;font-size:15px;line-height:1.55}
@media (max-width:1060px){.wk-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media (max-width:640px){.wk-grid{grid-template-columns:1fr}.works{padding:64px 0}}
.reviews{padding:96px 0;background:var(--glass);border-top:1px solid var(--frost)}
.rv-head{display:flex;justify-content:space-between;align-items:end;gap:28px;flex-wrap:wrap;margin-bottom:40px}
.rv-score{display:flex;align-items:center;gap:18px;text-decoration:none;color:var(--ink);border:1.5px solid var(--frost);border-radius:20px;padding:14px 20px 14px 16px;background:var(--glass2)}
.rv-score:hover{border-color:var(--ink);color:var(--ink)}
.rv-score .num{font:800 40px/1 var(--display)}
.rv-score .meta{font-size:14px;color:var(--muted);line-height:1.35}.rv-score .meta b{display:block;color:var(--ink);font-size:15px}
.gis{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#19aa1e;color:#fff;font:800 15px/1 var(--body);letter-spacing:-.02em}
.stars{color:#f2a900;letter-spacing:2px;font-size:16px;white-space:nowrap}.rv .stars{display:block;margin-bottom:10px}.stars i{color:var(--frost);font-style:normal}
.rv-list{columns:3 300px;column-gap:18px}
.rv{break-inside:avoid;margin:0 0 18px;background:var(--glass2);border-radius:20px;padding:24px 24px 20px;border:1px solid var(--frost)}
.rv blockquote{white-space:pre-line;margin:0 0 16px;font-size:16px;line-height:1.6;color:var(--text)}
.rv figcaption{display:flex;justify-content:space-between;gap:12px;font-size:14px;color:var(--muted)}.rv figcaption b{color:var(--ink);font-weight:600}
.rv .more{background:none;border:0;padding:0;color:var(--baikal);font:500 14px var(--body);cursor:pointer;margin-top:-8px;margin-bottom:12px}
.rv.clamp blockquote{display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden}
.rv-all{margin-top:10px}
@media (max-width:640px){.reviews{padding:64px 0}.rv-score .num{font-size:32px}}

/* как работаем */
.steps{padding:96px 0}
.steps ol{list-style:none;counter-reset:s;margin:44px 0 0;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:26px}
.steps li{counter-increment:s;padding-top:18px;border-top:2px solid var(--ink)}
.steps li::before{content:counter(s);display:block;font:800 34px/1 var(--display);color:var(--baikal);margin-bottom:14px}
.steps li b{display:block;color:var(--ink);font-weight:600;margin-bottom:6px}.steps li span{font-size:15px;color:var(--muted)}

/* заявка */
.order{background:linear-gradient(160deg,rgba(11,20,27,.95),rgba(30,44,55,.92));color:#d7dee3;padding:100px 0}
.order .wrap{display:grid;grid-template-columns:.9fr 1.1fr;gap:64px;align-items:start}
.order h2{color:var(--white)}.order p{color:#aeb9c1}
.order .contacts{margin-top:30px;display:grid;gap:14px;font-size:16px}
.order .contacts a{color:var(--white)}.order .contacts span{color:#8c98a1;display:block;font-size:14px}
form{display:grid;gap:16px}
.f2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
label{display:grid;gap:6px;font-size:14px;color:#aeb9c1}
input,textarea,select{font:16px var(--body);color:var(--white);background:rgba(255,255,255,.06);border:1.5px solid rgba(160,180,194,.3);border-radius:12px;padding:14px 16px;width:100%}
input:focus,textarea:focus{border-color:var(--amber);outline:none}
textarea{min-height:96px;resize:vertical}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips label{display:block;position:relative}.chips input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;left:0;top:0}
.chips span{display:inline-block;padding:9px 14px;border:1.5px solid #3a434b;border-radius:999px;color:#d7dee3;font-size:14px;cursor:pointer;user-select:none}
.chips input:checked+span{background:var(--amber);border-color:var(--amber);color:var(--amber-ink);font-weight:600}
.chips input:focus-visible+span{outline:3px solid var(--amber);outline-offset:2px}
.agree{display:flex;gap:10px;align-items:flex-start;font-size:13px;color:#8c98a1}.agree input{width:18px;height:18px;margin-top:2px;flex:none;accent-color:var(--amber)}
.hp{position:absolute;left:-9999px}
.msg{font-size:15px;min-height:1px}.msg.err{color:#ff9a8a}
.done{border:1.5px solid var(--amber);border-radius:18px;padding:34px}.done h3{color:var(--white);margin-bottom:10px}

footer{background:rgba(228,235,239,.7);padding:34px 0 calc(34px + env(safe-area-inset-bottom));font-size:14px;color:var(--muted)}
footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
footer small{display:block;font-size:12px;margin-top:4px}

@media (max-width:1240px){
  .top .wrap{height:100px}.logo{height:76px}
  section[id]{scroll-margin-top:100px}
}
@media (max-width:1060px){
  .grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .svc.big{grid-column:span 2;grid-row:span 2}.svc.wide{grid-column:span 2}
}
@media (max-width:980px){
  .hero .wrap,.order .wrap,.trust .wrap,.sec-head{grid-template-columns:1fr}.sec-head p{justify-self:start}
  .shot{max-width:560px}.seal{left:auto;right:18px;bottom:-34px;width:112px;height:112px}.seal svg{width:86px;height:86px}
  .steps ol{grid-template-columns:1fr 1fr}
}
@media (max-width:640px){
  .wrap{padding:0 16px}.top .wrap{height:84px;gap:12px}.logo{height:60px}.top .tel{font-size:15px}
  section[id]{scroll-margin-top:84px}
  .hero{padding:28px 0 64px}.lead{font-size:18px}.promise{grid-template-columns:1fr;gap:14px}
  .shot .ph{aspect-ratio:4/4.2;border-radius:22px 22px 22px 80px}
  .services,.steps{padding:64px 0}.order,.trust{padding:64px 0}
  .grid{grid-template-columns:1fr;grid-auto-rows:auto;gap:14px}.svc{min-height:360px}
  .svc.big,.svc.wide{grid-column:auto;grid-row:auto}.svc.big{min-height:460px}
  .svc.wide::before{background:linear-gradient(180deg,rgba(10,18,24,0) 30%,rgba(10,18,24,.6) 58%,rgba(10,18,24,.94) 100%)}.svc.wide .svc-body{top:auto;width:auto}
  .trust dl{grid-template-columns:1fr}
  .f2,.steps ol{grid-template-columns:1fr}
  .hero .btn{width:100%}
}
@media (max-width:1400px){.top .tel2{display:none}}
@media (max-width:480px){.top .tel span{display:none}.top .tel{width:46px;height:46px;justify-content:center;border-radius:50%;background:var(--steel);border:1px solid #8496a3}}
@media (max-width:400px){.logo{height:54px}h2{font-size:clamp(22px,7vw,28px)}h1{font-size:6.6vw}}
@media (prefers-reduced-motion:reduce){.svc img{transition:none}html{scroll-behavior:auto}}

/* ---- многостраничная навигация ---- */
.top nav a[aria-current=page]{color:var(--baikal);font-weight:700;box-shadow:inset 0 -2px 0 var(--baikal)}
.burger{display:none;width:46px;height:46px;border-radius:12px;border:1px solid #8496a3;background:var(--steel);flex-direction:column;justify-content:center;align-items:center;gap:5px;cursor:pointer;padding:0;flex:none}
.burger i{display:block;width:20px;height:2px;background:var(--ink);border-radius:2px;transition:transform .2s,opacity .2s}
.top.open .burger i:nth-child(1){transform:translateY(7px) rotate(45deg)}.top.open .burger i:nth-child(2){opacity:0}.top.open .burger i:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
.tiles{padding:8px 0 72px}.tl-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.tl{position:relative;display:flex;align-items:flex-end;min-height:220px;border-radius:20px;overflow:hidden;text-decoration:none;color:#fff;background:#0d1820;isolation:isolate}
.tl img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-2;transition:transform .5s}.tl:hover img{transform:scale(1.05)}
.tl::before{content:'';position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(10,18,24,.05) 25%,rgba(10,18,24,.88) 100%)}
.tl-b{padding:18px 54px 18px 18px;display:flex;flex-direction:column;gap:4px}.tl-b b{font:800 19px/1.2 var(--display)}.tl-b i{font-style:normal;font-size:14px;line-height:1.35;color:#dbe5eb}
.tl-go{position:absolute;right:14px;bottom:16px;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center;font-size:18px}
.tl-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}.tl-row a{flex:1 1 200px;text-align:center;padding:14px 16px;border-radius:14px;background:var(--glass2);border:1px solid var(--frost);color:var(--ink);text-decoration:none;font-weight:600}
.tl-row a:hover{border-color:var(--baikal);color:var(--baikal)}
.cta{padding:24px 0 72px}.cta-in{display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;padding:28px clamp(20px,3vw,40px);border-radius:24px;background:var(--night);color:#e9eff2}
.cta-in h2{margin:0 0 6px;color:#fff;font-size:clamp(22px,2.6vw,30px)}.cta-in p{margin:0;color:#aeb9c1}.cta-btns{display:flex;gap:10px;flex-wrap:wrap}.cta .btn-line{color:#fff;border-color:rgba(255,255,255,.5)}
/* BS HarmoniX product page */
.hx-hero{padding:40px 0 20px}.hx-panel{background:linear-gradient(135deg,#111e28,#233d4c);border-radius:30px;padding:clamp(24px,5vw,64px);display:grid;grid-template-columns:1.1fr 1fr;gap:36px;align-items:center;color:#e1ecf2}.hx-kicker,.hx-tags,.hx-visual-top,.hx-visual-bottom{font-size:12px;letter-spacing:.09em;font-weight:600;color:#9ccbe0}.hx-panel h1{font-size:clamp(32px,5vw,66px);color:#f5fbff;overflow-wrap:anywhere}.hx-panel h2{font-size:clamp(21px,2.5vw,32px);color:#9ed1e8;margin-top:18px;line-height:1.3}.hx-lead{margin:24px 0;color:#d4e0e7}.hx-actions,.hx-tags{display:flex;flex-wrap:wrap;gap:12px}.hx-panel .btn-line{color:#fff;border-color:#829eaf}.hx-tags{margin-top:26px}.hx-tags span{border:1px solid #577486;border-radius:999px;padding:7px 12px}.hx-visual{margin:0;min-width:0;padding:20px;border:1px solid #526e80;border-radius:18px;background:#0d1922}.hx-visual svg{display:block;width:100%;height:auto;margin:22px 0}.hx-visual-top,.hx-visual-bottom{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.hx-visual figcaption{font-size:12px;color:#a6bbc8;margin-top:14px}.hx-section{padding:40px 0}.hx-grid,.hx-licenses{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.hx-licenses{grid-template-columns:repeat(2,minmax(0,1fr))}.hx-card{padding:clamp(20px,3vw,30px);background:var(--glass2);border:1px solid var(--frost);border-radius:20px}.hx-card>span{font-size:12px;color:var(--baikal);font-weight:600;letter-spacing:.08em}.hx-card h3{margin:12px 0}.hx-card p{color:var(--muted)}.hx-full{border:2px solid var(--baikal)}.hx-card .btn{white-space:normal;text-align:center;line-height:1.3}.hx-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;padding:0;list-style:none;counter-reset:hxstep}.hx-steps li{counter-increment:hxstep;padding:20px;border-top:2px solid var(--baikal);background:var(--glass);border-radius:0 0 14px 14px}.hx-steps li::before{content:"0" counter(hxstep);display:block;color:var(--baikal);font-weight:600;margin-bottom:12px}.hx-steps b{display:block}.top nav{gap:clamp(10px,1vw,18px)}
@media(max-width:900px){.hx-panel{grid-template-columns:1fr}.hx-grid,.hx-steps{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:580px){.hx-grid,.hx-licenses,.hx-steps{grid-template-columns:1fr}.hx-actions .btn{width:100%;text-align:center}.hx-section{padding:26px 0}}
@media (max-width:1280px){
  .burger{display:flex}.top .tel{margin-left:auto}
  .top nav{position:fixed;left:0;right:0;top:var(--hh,100px);display:none;flex-direction:column;gap:0;margin:0;padding:8px 16px 16px;background:#eef2f5;border-bottom:1px solid var(--frost);box-shadow:0 20px 40px rgba(10,18,24,.18);max-height:calc(100dvh - var(--hh,100px));overflow:auto}
  .top.open nav{display:flex}.top nav a{padding:15px 6px;font-size:18px;border-bottom:1px solid var(--frost)}.top nav a:last-child{border-bottom:0}.top nav a[aria-current=page]{box-shadow:none;padding-left:12px;border-left:3px solid var(--baikal)}
  .tl-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media (max-width:640px){.tl-grid{grid-template-columns:1fr}.tl{min-height:170px}.cta-in{flex-direction:column;align-items:stretch;text-align:center}.cta-btns .btn{flex:1}.tiles{padding-bottom:48px}}
/* BoomSystem 2.0 — restrained titanium and graphite */
:root{--paper:#f1f4f6;--ice:#e3e9ee;--ink:#111b24;--text:#263540;--muted:#536471;--baikal:#286784;--frost:#ccd6de;--amber:#84cbea;--amber-ink:#0d141c;--night:#0d141c;--glass:#e9eef2;--glass2:#fff;--steel:#c5d1da}
body{background:var(--paper)}body::before,body::after{display:none}
.top{background:#f1f4f6;border-bottom:1px solid #d0dae1;backdrop-filter:none}.top .wrap{height:84px;gap:20px}.logo{height:60px}.top nav{gap:clamp(10px,1vw,18px)}.top nav a{font-size:15px}.btn{border-radius:8px;padding:15px 24px}.btn-gold{background:#c5d1da;box-shadow:none;text-shadow:none;border:1px solid #a6b5c0}.btn-gold:hover{background:#d7e1e8;filter:none}.btn-line{border-width:1px}.seal{display:none}.hero .shot .ph{border-radius:18px;box-shadow:none}.hero .shot .ph::after{display:none}
.bs-home .hero{background:#0d141c;color:#dce7ee;padding:48px 0 56px}.bs-home .hero .wrap{gap:40px}.bs-home .hero h1{color:#f1f4f6;font-size:clamp(32px,4vw,58px)}.bs-home .hero h1 span+span{color:#84cbea;background:none;-webkit-text-fill-color:currentColor}.bs-home .hero .lead{color:#bdcbd5}.bs-home .hero .btn-line{color:#e8f1f6;border-color:#718797}.bs-home .hero .btn-line:hover{background:#314958}.bs-home .hero .promise{border-color:#41525f;margin-top:30px}.bs-home .hero .promise b{color:#f1f4f6}.bs-home .hero .promise span{color:#bccad4}.bs-home .hero .ph{aspect-ratio:5/4}.bs-kicker{font-size:12px;letter-spacing:.15em;font-weight:600;color:#84cbea;margin-bottom:18px}
.bs-proof{background:#202c36;color:#f1f4f6;padding:20px 0}.bs-proof .wrap{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}.bs-proof span{font-size:14px;color:#bac7d1}.bs-proof .wrap>div{display:flex;gap:24px;flex-wrap:wrap}.bs-proof b{font:600 15px var(--display)}.bs-proof a{color:#84cbea;font-size:14px}
.bs-home .services,.bs-home .works,.bs-home .reviews,.bs-home .awards{padding:64px 0}.bs-home .grid{grid-auto-rows:300px}.bs-home .svc{border-radius:16px}.bs-home .svc p{max-width:50ch}.bs-product{padding:10px 0 32px}.bs-product-in{background:#202c36;border-radius:20px;padding:clamp(24px,4vw,48px);display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center;color:#cbd7e0}.bs-product h2{color:#fff;margin-bottom:18px}.bs-product-art{background:#0d141c;border:1px solid #465b6b;border-radius:12px;padding:22px;min-width:0}.bs-product-art svg{display:block;width:100%;height:auto}.bs-product-art span{font-size:11px;color:#84cbea;letter-spacing:.14em}.trust,.order{background:#202c36}.cta-in{border-radius:16px}.hx-panel{border-radius:20px;background:#202c36}
.featured{background:#202c36;color:#dce7ee;padding:32px 0}.featured-grid{display:grid;grid-template-columns:1fr 1fr;gap:clamp(20px,4vw,48px);align-items:center}.featured img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:16px}.featured h2,.featured .btn-line{color:#fff}.featured p{margin:12px 0 20px}
.lead-details summary{cursor:pointer;margin-bottom:8px}.lead-details[open]>*+*{margin-top:12px}.lead-context{margin:0;color:inherit}#order{scroll-margin-top:calc(var(--hh, 80px) + 12px)}
@media(max-width:640px){.featured-grid{grid-template-columns:1fr}.bs-home .hero h1{overflow-wrap:anywhere}}
.bs-mobile-actions{display:none}
@media(max-width:1280px){.top .wrap{height:76px}.logo{height:54px}}
@media(max-width:980px){.bs-home .hero .wrap,.bs-product-in{grid-template-columns:1fr}.bs-home .hero .ph{aspect-ratio:16/10}.bs-home .grid{grid-auto-rows:320px}}
@media(max-width:640px){.top .wrap{height:72px;gap:10px}.logo{height:48px}.bs-home .hero{padding:32px 0}.bs-home .hero h1{font-size:clamp(28px,7vw,42px)}.bs-home .hero .wrap{gap:28px}.bs-home .hero .actions .btn{flex:1;text-align:center}.bs-proof .wrap>div{gap:14px}.bs-proof b{font-size:12px}.bs-home .grid{grid-auto-rows:auto}.bs-home .services,.bs-home .works,.bs-home .reviews,.bs-home .awards{padding:42px 0}.bs-home .svc{min-height:330px}.bs-home .svc.big{min-height:390px}.bs-mobile-actions{display:flex;gap:8px;position:fixed;z-index:19;bottom:0;left:0;right:0;background:#0d141c;padding:10px 16px calc(10px + env(safe-area-inset-bottom));box-shadow:0 -3px 16px #0002}.bs-mobile-actions .btn{flex:1;padding:13px 10px;font-size:14px}.bs-mobile-actions .btn-line{color:white;border-color:#8396a4}body.bs-has-mobile{padding-bottom:calc(66px + env(safe-area-inset-bottom))}}
</style>${metrika()}</head>
<body class="${page === 'home' ? 'bs-home ' : ''}${page !== 'contacts' ? 'bs-has-mobile' : ''}">
<header class="top"><div class="wrap">
  <a href="/" class="home" aria-label="Бумсистем — на главную">${LOGO}</a>
  <nav aria-label="Разделы" id="mainNav">${NAV_HTML}</nav>
  ${phone ? `<a class="tel" href="tel:${esc(tel)}" aria-label="Позвонить ${esc(phones[0] || phone)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg><span>${esc(phones[0] || phone)}</span></a>${phones.slice(1).map((x) => `<a class="tel tel2" href="tel:${esc(telOf(x))}">${esc(x)}</a>`).join('')}` : ''}
  <button type="button" class="burger" aria-label="Меню" aria-expanded="false" aria-controls="mainNav"><i></i><i></i><i></i></button>
</div></header>

<main>
${MAIN}${hasForm ? ORDER : page === 'harmonix' ? '' : CTA}
</main>
${page !== 'contacts' ? `<div class="bs-mobile-actions"><a class="btn btn-gold" href="${isHome ? '#order' : '/kontakty' + (page === 'harmonix' ? '?product=bs-harmonix' : '')}" data-lead-open>Оставить заявку</a>${tel ? `<a class="btn btn-line" href="tel:${esc(tel)}">Позвонить</a>` : ''}</div>` : ''}
<footer><div class="wrap"><span>© ${year} Бумсистем — тюнинг-ателье с сибирским характером<small>Фото: ${[HERO, ICE, ...GROUPS].map((g) => g.by && esc(g.by)).filter((v, i, a) => v && a.indexOf(v) === i).join(', ')} / <a href="https://unsplash.com" target="_blank" rel="noopener" style="color:inherit">Unsplash</a></small></span><span class="foot-soc">${socials.map(([k, n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${n}">${SOC_ICON[k]}</a>`).join('')}<a href="/crm">Вход для сотрудников</a></span></div></footer>

<script>
(function () { // меню на телефоне
  var top = document.querySelector('.top'), btn = top && top.querySelector('.burger'); if (!btn) return;
  var hh = function () { document.documentElement.style.setProperty('--hh', top.getBoundingClientRect().height + 'px'); }; hh(); addEventListener('resize', hh);
  btn.addEventListener('click', function () { var o = top.classList.toggle('open'); btn.setAttribute('aria-expanded', o); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && top.classList.contains('open')) { top.classList.remove('open'); btn.setAttribute('aria-expanded', false); } });
  document.addEventListener('click', function (e) { if (top.classList.contains('open') && !top.contains(e.target)) { top.classList.remove('open'); btn.setAttribute('aria-expanded', false); } });
})();
(function () { // старые ссылки вида /#services ведут на новые страницы
  if (location.pathname !== '/') return;
  var map = { '#services': '/uslugi', '#steps': '/uslugi#steps', '#alarms': '/signalizacii', '#works': '/raboty', '#reviews': '/otzyvy' };
  var to = map[location.hash]; if (to) { var p = to.split('#'); location.replace(p[0] + location.search + (p[1] ? '#' + p[1] : '')); }
})();
document.querySelectorAll('.al-tabs [data-tab]').forEach(function (b, _, all) {
  b.addEventListener('click', function () {
    all.forEach(function (x) { var on = x === b; x.setAttribute('aria-selected', on ? 'true' : 'false'); var p = document.getElementById('alp-' + x.getAttribute('data-tab')); if (on) p.removeAttribute('data-off'); else p.setAttribute('data-off', ''); });
  });
});
document.querySelectorAll('.rv .more').forEach(function (b) { b.addEventListener('click', function () { b.parentNode.classList.remove('clamp'); b.remove(); }); });
(function () {
  var f = document.getElementById('leadForm'), context = document.getElementById('leadContext'), msg = document.getElementById('msg'), btn = document.getElementById('sendBtn');
  // метка рекламного канала: из ссылки (?utm_source=vk) — запоминаем на 30 дней, чтобы заявка с повторного визита тоже засчиталась
  var utm = function (k) { try { var v = new URLSearchParams(location.search).get(k); if (v) localStorage.setItem(k, JSON.stringify({ v: v, t: Date.now() })); var s = JSON.parse(localStorage.getItem(k) || 'null'); return s && Date.now() - s.t < 2592e6 ? s.v : ''; } catch (e) { return ''; } };
  utm('utm_source'); utm('utm_campaign');
  // «Записаться» на любой странице — открываем страницу заявки с выбранной услугой (и моделью)
  function goal(name) { if (window.ymGoal) window.ymGoal(name); }
  function showContext(text) {
    context.textContent = text;
    context.hidden = !text;
  }
  document.querySelectorAll('[data-lead-open]').forEach(function (link) {
    link.addEventListener('click', function () { goal('lead_open'); });
  });
  function selectedServices() {
    return Array.from(f.querySelectorAll('input[name=svc]:checked'), function (c) { return c.value; });
  }
  function pick(v, m) {
    if (!f) { location.href = '/kontakty?svc=' + encodeURIComponent(v || '') + (m ? '&model=' + encodeURIComponent(m) : ''); return; }
    f.querySelectorAll('input[name=svc]').forEach(function (c) { if (c.value === v) c.checked = true; });
    showContext(m || selectedServices().join(', '));
    var t = f.elements.message;
    if (m && t.value.indexOf(m) < 0) t.value = (t.value ? t.value.replace(/\\s+$/, '') + '\\n' : '') + 'Интересует установка: ' + m;
    document.getElementById('order').scrollIntoView({ behavior: 'smooth' });
    setTimeout(function () { f.elements.name.focus({ preventScroll: true }); }, 500);
  }
  document.querySelectorAll('[data-pick]').forEach(function (b) { b.addEventListener('click', function () { goal('lead_open'); pick(b.getAttribute('data-pick'), b.getAttribute('data-model')); }); });
  if (!f) return;
  (function () { var q = new URLSearchParams(location.search); if (q.get('product') === 'bs-harmonix') { var l = q.get('license'); f.elements.message.value = 'Интересует BS HarmoniX' + (l === 'trial' ? ': пробная лицензия' : l === 'full' ? ': полная лицензия' : ': консультация'); showContext(f.elements.message.value); } else if (q.get('svc') || q.get('model')) pick(q.get('svc'), q.get('model')); })();
  f.addEventListener('input', function () { goal('lead_start'); }, { once: true });
  f.addEventListener('change', function (e) {
    if (e.target.name === 'svc') showContext(selectedServices().join(', '));
  });
  f.addEventListener('submit', function (e) {
    e.preventDefault(); msg.className = 'msg'; msg.textContent = '';
    var phone = f.elements.phone.value.replace(/[^\\d]/g, '');
    if (!f.elements.name.value.trim()) { msg.className = 'msg err'; msg.textContent = 'Напишите, как к вам обращаться.'; f.elements.name.focus(); return; }
    if (phone.length < 10) { msg.className = 'msg err'; msg.textContent = 'Проверьте номер телефона — нужно 10–11 цифр.'; f.elements.phone.focus(); return; }
    if (!f.elements.agree.checked) { msg.className = 'msg err'; msg.textContent = 'Отметьте согласие на обработку данных, иначе мы не сможем принять заявку.'; return; }
    var svc = selectedServices();
    btn.disabled = true; btn.textContent = 'Отправляем…';
    fetch('/api/public/site-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: f.elements.name.value, phone: f.elements.phone.value, car: f.elements.car.value, services: svc, message: f.elements.message.value, website: f.elements.website.value, agree: true, utm_source: utm('utm_source'), utm_campaign: utm('utm_campaign') }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Ошибка'); return j; }); })
      .then(function () {
        if (window.ymGoal) window.ymGoal('lead');
        document.getElementById('formBox').innerHTML = '<div class="done" tabindex="-1" id="done"><h3>Заявка отправлена</h3><p>Перезвоним в рабочее время${phones.length ? ` с номера ${esc(phones.join(' или '))}` : ''}. Если вопрос срочный — позвоните нам сами.</p></div>';
        document.getElementById('done').focus();
      })
      .catch(function (err) { msg.className = 'msg err'; msg.textContent = 'Заявка не отправилась: ' + err.message + '. Попробуйте ещё раз или позвоните нам.'; btn.disabled = false; btn.textContent = 'Отправить заявку'; });
  });
})();
</script>
</body></html>`;
}

module.exports = { render, GROUPS };
