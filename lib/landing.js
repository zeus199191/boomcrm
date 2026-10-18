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
    img: '/img/noise', sizesLocal: [400], alt: 'Виброизоляция Aerocell QP Intrigo — листы материала', pos: 'left top' },
  { key: 'alarm', title: 'Сигнализации и автозапуск', text: 'StarLine и Pandora: автозапуск по времени и температуре, управление с телефона, защита от угона.',
    img: '/img/alarm3', sizesLocal: [880], alt: 'Брелок Pandora с экраном и приложение на телефоне', pos: 'center top' },
  { key: 'media', title: 'Магнитолы и мультимедиа', text: 'Android-магнитолы, CarPlay и Android Auto, сохранение штатных кнопок и камер.',
    img: '/img/media3', sizesLocal: [860], alt: 'Мастер устанавливает мультимедиа с навигацией и CarPlay', pos: 'center top' },
  { key: 'cam', title: 'Камеры и регистраторы', text: 'Камеры переднего и заднего вида, парктроники, регистраторы со скрытой проводкой.',
    img: '/img/camdvr', sizesLocal: [815], alt: 'Камера заднего вида с разметкой на экране и видеорегистратор', pos: 'center 40%' },
  { key: 'print3d', title: '3D-печать', text: 'Подиумы под динамики, рамки магнитол, крепления и накладки — моделируем и печатаем под вашу машину.',
    img: '/img/print3d', sizesLocal: [421], alt: '3D-принтер печатает деталь для автомобиля', pos: 'center 30%' },
  { key: 'diag', title: 'Диагностика и доработки', text: 'Ищем неисправности электрики, ставим дополнительное оборудование, приводим в порядок проводку после чужих установок.',
    img: '1758411897965-e4ad12ccd8fa', alt: 'Панель управления светом в салоне', by: 'Erik Mclean' },
];
// Фон: лёд Байкала (Sergey Pesterev / Unsplash), полупрозрачно под стальной вуалью
const ICE = { img: '1552575358-c91311522b16', by: 'Sergey Pesterev' };
const HERO = { img: '/img/hero', sizesLocal: [480, 694], alt: 'Сабвуфер JL Audio в багажнике — подиум ручной работы Бумсистем' };

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

function card(g, cls, sizes) {
  return `<article class="svc ${cls}">
    <img src="${g.sizesLocal ? `${g.img}-${g.sizesLocal.at(-1)}.webp` : IMG(g.img, 960)}" srcset="${srcset(g.img, g.sizesLocal)}" sizes="${sizes}"${g.pos ? ` style="object-position:${g.pos}"` : ''} alt="${esc(g.alt)}" loading="lazy" decoding="async" onerror="this.remove()">
    <div class="svc-body"><h3>${esc(g.title)}</h3><p>${esc(g.text)}</p>
    <div class="svc-btns"><button type="button" data-pick="${esc(g.title)}">Записаться</button>${g.more ? `<a class="svc-more" href="${g.more}">Подробнее →</a>` : ''}</div></div></article>`;
}

const stars = (n) => `<span class="stars" aria-label="Оценка ${n} из 5">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dLong = (s) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${+d} ${MONTHS_GEN[+m - 1]} ${y}`; };
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
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
    groups.get(brand).push({ brand, model, feats: f, eco: /\bECO\b/i.test(p.name), price: p.price, stock: p.stock > 0 });
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
    ${list.map((m) => `<article class="al">
      <div class="al-top"><span class="al-brand">${esc(m.brand)}</span>${m.stock ? '<span class="al-stock">В наличии</span>' : ''}</div>
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
    <div class="actions"><a class="btn btn-gold" href="#order">Записаться на подбор</a>${phone ? `<a class="btn btn-line" href="tel:${esc(tel)}">Позвонить</a>` : ''}</div>
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

function render({ loggedIn = false, page = 'home' } = {}) {
  const isSnd = page === 'sound';
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
  const socials = [['tg', 'Telegram', getSetting('social_tg')], ['vk', 'ВКонтакте', getSetting('social_vk')], ['max', 'MAX', getSetting('social_max')], ['avito', 'Авито', getSetting('social_avito')]].filter((x) => /^https:\/\//.test(x[2] || ''));
  const rvOn = !!(getSetting('twogis_url') || all('SELECT 1 FROM site_reviews WHERE visible=1 LIMIT 1').length);

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${isSnd ? 'Автозвук в Ангарске — системы уровня SQ: Brax, Helix, Audison, Focal, Morel, JL Audio | Бумсистем' : 'Бумсистем — премиальный автозвук, сигнализации с автозапуском, шумоизоляция'}</title>
<meta name="description" content="${isSnd ? 'Автозвук уровня соревнований: компоненты Brax, Helix, Match, Audison, Hertz, Focal, Morel, JL Audio, Recoil Audio, процессоры DSP и настройка по замерам. Опыт соревнований в классе SQ. Бумсистем.' : 'Тюнинг-ателье Бумсистем: премиальный автозвук, шумоизоляция, сигнализации StarLine и Pandora с автозапуском, мультимедиа, камеры и 3D-печать деталей. Оставьте заявку — перезвоним.'}">
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
  .top nav{display:none}.top .tel{margin-left:auto}.top .wrap{height:100px}.logo{height:76px}
  section[id]{scroll-margin-top:100px}
}
@media (max-width:1060px){
  .grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .svc.big{grid-column:span 2;grid-row:span 2}.svc.wide{grid-column:span 2}
}
@media (max-width:980px){
  .top nav{display:none}
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
</style></head>
<body>
<header class="top"><div class="wrap">
  <a href="/" class="home" aria-label="Бумсистем — на главную">${LOGO}</a>
  <nav aria-label="Разделы">${isSnd ? '<a href="/">Главная</a><a href="#comp">Опыт</a><a href="#awards">Награды</a><a href="#parts">Компоненты</a><a href="#brands">Бренды</a><a href="#order">Заявка</a>' : `<a href="#services">Услуги</a><a href="/avtozvuk">Автозвук</a>${alarms ? '<a href="#alarms">Сигнализации</a>' : ''}${rvOn ? '<a href="#reviews">Отзывы</a>' : ''}<a href="#steps">Как работаем</a><a href="#order">Контакты</a>`}</nav>
  ${phone ? `<a class="tel" href="tel:${esc(tel)}" aria-label="Позвонить ${esc(phones[0] || phone)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg><span>${esc(phones[0] || phone)}</span></a>${phones.slice(1).map((x) => `<a class="tel tel2" href="tel:${esc(telOf(x))}">${esc(x)}</a>`).join('')}` : ''}
</div></header>

<main>
${isSnd ? soundMain(phone, tel) : `<section class="hero"><div class="wrap">
  <div>
    <h1><span>Премиальный звук.</span><span>Бескомпромиссная надёжность.</span></h1>
    <p class="lead">Высочайшее качество работ и уровень сервиса, который вас не разочарует. Автозвук, шумоизоляция, сигнализации с автозапуском, мультимедиа и 3D-печать — под вашу машину.</p>
    <div class="actions"><a class="btn btn-gold" href="#order">Оставить заявку</a>${phone ? `<a class="btn btn-line" href="tel:${esc(tel)}">Позвонить</a>` : ''}</div>
    <div class="promise">
      <div><b>Гарантия</b><span>на работы и установленное оборудование</span></div>
      <div><b>Фотоотчёт</b><span>фиксируем состояние машины при приёмке</span></div>
    </div>
  </div>
  <figure class="shot">
    <div class="ph"><img src="${HERO.img}-${HERO.sizesLocal.at(-1)}.webp" srcset="${srcset(HERO.img, HERO.sizesLocal)}" sizes="(max-width:980px) 100vw, 46vw" alt="${esc(HERO.alt)}" fetchpriority="high" onerror="this.remove()"></div>
    <div class="seal" aria-hidden="true"><i class="ring"></i><i class="ring"></i><i class="ring"></i><svg viewBox="0 0 220 220">${EMBLEM}</svg></div>
  </figure>
</div></section>

<section class="services" id="services"><div class="wrap">
  <div class="sec-head"><h2>Что мы делаем</h2><p>Подбираем решение под машину и задачу. Стоимость назовём после осмотра — без навязанных опций.</p></div>
  <div class="grid">
    ${card(sound, 'big', '(max-width:640px) 100vw, (max-width:1060px) 100vw, 66vw')}
    ${card(noise, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw')}
    ${card(alarm, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw')}
    ${card(media, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw')}
    ${card(cam, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw')}
    ${card(print3d, '', '(max-width:640px) 100vw, (max-width:1060px) 50vw, 33vw')}
    ${card(diag, 'wide', '100vw')}
  </div>
</div></section>

${alarms}

<section class="trust"><div class="wrap">
  <h2>Сделано так, чтобы не возвращаться</h2>
  <dl>
    <div><dt>Звук по замерам</dt><dd>Настраиваем процессор по микрофону, а не на слух «как получится».</dd></div>
    <div><dt>Проводка как с завода</dt><dd>Штатные разъёмы, гофра и изоляция — без скруток и свисающих проводов.</dd></div>
    <div><dt>Автозапуск в мороз</dt><dd>Настраиваем запуск по температуре и времени, проверяем на вашей машине.</dd></div>
    <div><dt>Документы на всё</dt><dd>Акт приёма с фото, заказ-наряд и гарантийный талон на каждую работу.</dd></div>
  </dl>
</div></section>

${reviewsBlock()}

<section class="steps" id="steps"><div class="wrap">
  <h2>Как проходит работа</h2>
  <ol>
    <li><b>Заявка</b><span>Оставляете заявку на сайте или звоните.</span></li>
    <li><b>Подбор</b><span>Перезваниваем, уточняем задачу, предлагаем варианты.</span></li>
    <li><b>Запись</b><span>Назначаем удобный день и время, чтобы вы не ждали в очереди.</span></li>
    <li><b>Работа</b><span>Принимаем машину по акту с фото, работаем по заказ-наряду.</span></li>
    <li><b>Выдача</b><span>Показываем результат, выдаём документы и гарантийный талон.</span></li>
  </ol>
</div></section>

`}
<section class="order" id="order"><div class="wrap">
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
    <label>Автомобиль<input name="car" placeholder="Например: Toyota Camry 2019" maxlength="120"></label>
    <div><div style="font-size:14px;color:#aeb9c1;margin-bottom:8px" id="svcLbl">Что нужно сделать</div>
      <div class="chips" role="group" aria-labelledby="svcLbl">${GROUPS.map((g) => `<label><input type="checkbox" name="svc" value="${esc(g.title)}"${isSnd && g.key === 'sound' ? ' checked' : ''}><span>${esc(g.title)}</span></label>`).join('')}</div></div>
    <label>Комментарий<textarea name="message" maxlength="2000" placeholder="Что важно учесть: бюджет, сроки, какое оборудование уже есть"></textarea></label>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <label class="agree"><input type="checkbox" name="agree" required><span>Согласен на обработку персональных данных — только чтобы связаться со мной по этой заявке.</span></label>
    <div><button class="btn btn-gold" type="submit" id="sendBtn">Отправить заявку</button></div>
    <div class="msg" id="msg" role="status" aria-live="polite"></div>
  </form>
  </div>
</div></section>
</main>

<footer><div class="wrap"><span>© ${year} Бумсистем — тюнинг-ателье с сибирским характером<small>Фото: ${[HERO, ICE, ...GROUPS].map((g) => g.by && esc(g.by)).filter((v, i, a) => v && a.indexOf(v) === i).join(', ')} / <a href="https://unsplash.com" target="_blank" rel="noopener" style="color:inherit">Unsplash</a></small></span><span class="foot-soc">${socials.map(([k, n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${n}">${SOC_ICON[k]}</a>`).join('')}<a href="/crm">Вход для сотрудников</a></span></div></footer>

<script>
document.querySelectorAll('.al-tabs [data-tab]').forEach(function (b, _, all) {
  b.addEventListener('click', function () {
    all.forEach(function (x) { var on = x === b; x.setAttribute('aria-selected', on ? 'true' : 'false'); var p = document.getElementById('alp-' + x.getAttribute('data-tab')); if (on) p.removeAttribute('data-off'); else p.setAttribute('data-off', ''); });
  });
});
document.querySelectorAll('.rv .more').forEach(function (b) { b.addEventListener('click', function () { b.parentNode.classList.remove('clamp'); b.remove(); }); });
(function () {
  var f = document.getElementById('leadForm'), msg = document.getElementById('msg'), btn = document.getElementById('sendBtn');
  // метка рекламного канала: из ссылки (?utm_source=vk) — запоминаем на 30 дней, чтобы заявка с повторного визита тоже засчиталась
  var utm = function (k) { try { var v = new URLSearchParams(location.search).get(k); if (v) localStorage.setItem(k, JSON.stringify({ v: v, t: Date.now() })); var s = JSON.parse(localStorage.getItem(k) || 'null'); return s && Date.now() - s.t < 2592e6 ? s.v : ''; } catch (e) { return ''; } };
  utm('utm_source'); utm('utm_campaign');
  document.querySelectorAll('[data-pick]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-pick');
      f.querySelectorAll('input[name=svc]').forEach(function (c) { if (c.value === v) c.checked = true; });
      var m = b.getAttribute('data-model'), t = f.elements.message;
      if (m && t.value.indexOf(m) < 0) t.value = (t.value ? t.value.replace(/\\s+$/, '') + '\\n' : '') + 'Интересует установка: ' + m;
      document.getElementById('order').scrollIntoView({ behavior: 'smooth' });
      setTimeout(function () { f.elements.name.focus({ preventScroll: true }); }, 500);
    });
  });
  f.addEventListener('submit', function (e) {
    e.preventDefault(); msg.className = 'msg'; msg.textContent = '';
    var phone = f.elements.phone.value.replace(/[^\\d]/g, '');
    if (!f.elements.name.value.trim()) { msg.className = 'msg err'; msg.textContent = 'Напишите, как к вам обращаться.'; f.elements.name.focus(); return; }
    if (phone.length < 10) { msg.className = 'msg err'; msg.textContent = 'Проверьте номер телефона — нужно 10–11 цифр.'; f.elements.phone.focus(); return; }
    if (!f.elements.agree.checked) { msg.className = 'msg err'; msg.textContent = 'Отметьте согласие на обработку данных, иначе мы не сможем принять заявку.'; return; }
    var svc = Array.prototype.map.call(f.querySelectorAll('input[name=svc]:checked'), function (c) { return c.value; });
    btn.disabled = true; btn.textContent = 'Отправляем…';
    fetch('/api/public/site-lead', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: f.elements.name.value, phone: f.elements.phone.value, car: f.elements.car.value, services: svc, message: f.elements.message.value, website: f.elements.website.value, agree: true, utm_source: utm('utm_source'), utm_campaign: utm('utm_campaign') }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Ошибка'); return j; }); })
      .then(function () {
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
