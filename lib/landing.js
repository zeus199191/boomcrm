'use strict';
// Сайт-лендинг тюнинг-ателье: главная страница сервера. Контакты и режим работы берутся из Настроек CRM.
// Фото — бесплатные, по лицензии Unsplash (коммерческое использование разрешено).
const { getSetting, all } = require('./db');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMG = (id, w) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=72`;
const srcset = (id) => [640, 960, 1400].map((w) => `${IMG(id, w)} ${w}w`).join(', ');

// Основные направления (карточки и выбор в форме заявки)
const GROUPS = [
  { key: 'sound', title: 'Автозвук', text: 'Акустика, усилители, сабвуферы и процессоры. Собираем систему под вашу машину и музыку и настраиваем по замерам — чтобы сцена была перед вами, а бас не гудел.',
    img: '1758411898478-4f7e70d533d9', alt: 'Решётка динамика в двери автомобиля', by: 'Erik Mclean' },
  { key: 'noise', title: 'Шумоизоляция', text: 'Двери, пол, арки, багажник, потолок. Тишина на трассе и на шипах, музыка звучит чище.',
    img: '1780963991450-1a80d64d29c1', alt: 'Дверь автомобиля с контурной подсветкой', by: 'Prend' },
  { key: 'alarm', title: 'Сигнализации и автозапуск', text: 'StarLine и Pandora: автозапуск по времени и температуре, управление с телефона, защита от угона.',
    img: '1710006548781-eff5670376fa', alt: 'Ключ автомобиля с брелоком', by: 'Barry A' },
  { key: 'media', title: 'Магнитолы и мультимедиа', text: 'Android-магнитолы, CarPlay и Android Auto, сохранение штатных кнопок и камер.',
    img: '1652509059638-1784b02c40b4', alt: 'Экран мультимедиа на приборной панели', by: 'Ivan Kazlouskij' },
  { key: 'cam', title: 'Камеры и регистраторы', text: 'Камеры переднего и заднего вида, парктроники, регистраторы со скрытой проводкой.',
    img: '1765959106936-851735565c12', alt: 'Камера на лобовом стекле автомобиля', by: 'leoon liang' },
  { key: 'print3d', title: '3D-печать', text: 'Подиумы под динамики, рамки магнитол, крепления и накладки — моделируем и печатаем под вашу машину.',
    img: '1761454165168-cfdf007c6a31', alt: '3D-принтер печатает деталь', by: 'Kenneth Li' },
  { key: 'diag', title: 'Диагностика и доработки', text: 'Ищем неисправности электрики, ставим дополнительное оборудование, приводим в порядок проводку после чужих установок.',
    img: '1758411897965-e4ad12ccd8fa', alt: 'Панель управления светом в салоне', by: 'Erik Mclean' },
];
const HERO = { img: '1780296269515-0c8c068d0767', alt: 'Салон премиального автомобиля с динамиком в двери', by: 'Александр Бендус' };

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
    <img src="${IMG(g.img, 960)}" srcset="${srcset(g.img)}" sizes="${sizes}" alt="${esc(g.alt)}" loading="lazy" decoding="async" onerror="this.remove()">
    <div class="svc-body"><h3>${esc(g.title)}</h3><p>${esc(g.text)}</p>
    <button type="button" data-pick="${esc(g.title)}">Записаться</button></div></article>`;
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
    <p><b>Цены на оборудование актуальны на ${today}.</b> Стоимость установки зависит от автомобиля и комплектации — назовём после осмотра.</p>
    <dl><div><dt>GSM / LTE</dt><dd>управление со смартфона из любой точки</dd></div><div><dt>GPS</dt><dd>местоположение машины на карте</dd></div><div><dt>Bluetooth</dt><dd>смартфон или метка вместо ключа</dd></div><div><dt>LoRa</dt><dd>брелок, который «достаёт» далеко</dd></div></dl>
  </div>
</div></section>`;
}

function render({ loggedIn = false } = {}) {
  const phone = getSetting('company_phone') || '';
  const tel = phone.replace(/[^\d+]/g, '');
  const address = getSetting('company_address') || '';
  const h = hoursText();
  const map = address ? `https://yandex.ru/maps/?text=${encodeURIComponent(address)}` : '';
  const year = new Date().getFullYear();
  const [sound, noise, alarm, media, cam, print3d, diag] = GROUPS;
  const alarms = alarmsBlock();
  const rvOn = !!(getSetting('twogis_url') || all('SELECT 1 FROM site_reviews WHERE visible=1 LIMIT 1').length);

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Бумсистем — премиальный автозвук, сигнализации с автозапуском, шумоизоляция</title>
<meta name="description" content="Тюнинг-ателье Бумсистем: премиальный автозвук, шумоизоляция, сигнализации StarLine и Pandora с автозапуском, мультимедиа, камеры и 3D-печать деталей. Оставьте заявку — перезвоним.">
<meta name="theme-color" content="#EEF2F4">
<link rel="icon" type="image/png" href="/favicon-64.png"><link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://images.unsplash.com">
<link rel="preload" as="image" href="${IMG(HERO.img, 1400)}" imagesrcset="${srcset(HERO.img)}" imagesizes="(max-width:980px) 100vw, 46vw">
<link rel="preload" as="font" type="font/woff2" href="/fonts/unbounded-cyrillic-800-normal.woff2" crossorigin><link rel="stylesheet" href="/fonts/fonts.css">
<script>if (/^#\\//.test(location.hash)) location.replace('/crm' + location.hash);</script>
<style>
:root{--paper:#EEF2F4;--ice:#E3EAEE;--ink:#000;--text:#1d2329;--muted:#56616c;--baikal:#1C5D7A;--frost:#CBD7DD;--amber:#F2A900;--amber-ink:#2a1d00;--white:#fff;--night:#0a1218;
  --display:'Unbounded','Arial Black',Arial,sans-serif;--body:'Golos Text',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;--wrap:1320px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--text);font:17px/1.6 var(--body);-webkit-font-smoothing:antialiased}
a{color:var(--baikal)}a:hover{color:var(--ink)}
:focus-visible{outline:3px solid var(--amber);outline-offset:3px;border-radius:4px}
.wrap{max-width:var(--wrap);margin:0 auto;padding:0 clamp(16px,3vw,40px)}
section[id]{scroll-margin-top:96px}
h1,h2,h3{font-family:var(--display);color:var(--ink);margin:0;letter-spacing:-.015em}
h1{font-size:clamp(26px,3.1vw,46px);line-height:1.1;font-weight:800}
h2{font-size:clamp(28px,3.4vw,44px);line-height:1.1;font-weight:800}
h3{font-size:21px;line-height:1.2;font-weight:600}
p{margin:0 0 1em;max-width:62ch}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;font:600 16px/1 var(--body);border-radius:999px;padding:17px 30px;text-decoration:none;cursor:pointer;border:2px solid var(--ink);transition:background .15s,color .15s}
.btn-gold{background:var(--amber);color:var(--amber-ink);border-color:var(--amber)}.btn-gold:hover{background:#ffbc1f;color:var(--amber-ink)}
.btn-line{background:transparent;color:var(--ink)}.btn-line:hover{background:var(--ink);color:var(--white)}

/* шапка */
.top{position:sticky;top:0;z-index:20;background:rgba(238,242,244,.88);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid var(--frost)}
.top .wrap{display:flex;align-items:center;gap:28px;height:92px}
.home{display:block;color:var(--ink);text-decoration:none}
.logo{height:66px;width:auto;color:var(--ink);display:block}
.logo .lw{font-family:var(--display);font-weight:800;font-size:80px}.logo .lt{font-family:var(--display);font-weight:400;font-size:16px;letter-spacing:3px}
.top nav{display:flex;gap:clamp(16px,1.6vw,26px);margin-left:auto}.top nav a{color:var(--text);text-decoration:none;font-weight:500;white-space:nowrap}.top nav a:hover{color:var(--baikal)}
.top .tel{font-weight:600;color:var(--ink);text-decoration:none;white-space:nowrap}

/* первый экран */
.hero{padding:56px 0 96px;overflow:hidden}
.hero .wrap{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);gap:56px;align-items:center}
.hero h1 span{display:block}
.hero h1 span+span{color:var(--baikal)}
.lead{font-size:20px;color:var(--muted);margin:28px 0 36px;max-width:44ch}
.hero .actions{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.promise{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-top:48px;padding-top:26px;border-top:1px solid var(--frost)}
.promise b{display:block;color:var(--ink);font:600 16px/1.3 var(--display);margin-bottom:6px}.promise span{font-size:15px;color:var(--muted)}
.shot{position:relative;margin:0}
.shot .ph{position:relative;aspect-ratio:4/5;border-radius:28px 28px 28px 120px;overflow:hidden;background:linear-gradient(160deg,#25343e,#0a1218);box-shadow:0 40px 80px -30px rgba(10,18,24,.55)}
.shot .ph img{width:100%;height:100%;object-fit:cover;display:block}
.shot .ph::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 55%,rgba(10,18,24,.35))}
.seal{position:absolute;left:-34px;bottom:46px;width:136px;height:136px;border-radius:50%;background:var(--paper);display:grid;place-items:center;color:var(--ink);box-shadow:0 18px 40px -16px rgba(10,18,24,.5);--bg-e:var(--paper)}
.seal svg{width:104px;height:104px;position:relative;z-index:1}
.ring{position:absolute;inset:8px;border-radius:50%;border:2px solid var(--baikal);opacity:0}
@media (prefers-reduced-motion:no-preference){
  .ring{animation:wave 1.6s cubic-bezier(.2,.6,.3,1) .7s 3 both}.ring:nth-child(2){animation-delay:.95s}.ring:nth-child(3){animation-delay:1.2s}
  .cone{transform-origin:110px 110px;animation:thump 1.6s ease-out .7s 3}
}
@keyframes wave{0%{transform:scale(.8);opacity:.6}100%{transform:scale(1.9);opacity:0}}
@keyframes thump{0%{transform:scale(1)}8%{transform:scale(1.07)}22%{transform:scale(.985)}40%,100%{transform:scale(1)}}

/* витрина сигнализаций */
.alarms{padding:104px 0}
.al-tabs{display:inline-flex;gap:6px;padding:6px;background:var(--white);border:1px solid var(--frost);border-radius:999px;margin-bottom:28px}
.al-tabs button{font:600 16px/1 var(--body);border:0;background:none;color:var(--muted);padding:13px 22px;border-radius:999px;cursor:pointer;display:inline-flex;gap:10px;align-items:center}
.al-tabs button span{font-size:12px;font-weight:600;background:var(--ice);color:var(--muted);border-radius:999px;padding:4px 8px}
.al-tabs button[aria-selected=true]{background:var(--ink);color:var(--white)}.al-tabs button[aria-selected=true] span{background:#2a3138;color:#cfd8de}
.al-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.al-grid[data-off]{display:none}
.al{background:var(--white);border:1px solid var(--frost);border-radius:20px;padding:22px 22px 20px;display:flex;flex-direction:column;gap:12px;transition:border-color .15s,box-shadow .15s,transform .15s}
.al:hover{border-color:#a9bcc6;box-shadow:0 22px 40px -28px rgba(10,18,24,.45);transform:translateY(-2px)}
.al-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
.al-brand{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--baikal)}
.al-stock{font-size:12px;font-weight:600;color:#1f6b3d;background:#e3f2e8;border-radius:999px;padding:4px 10px}
.al h3{font-size:20px;overflow-wrap:anywhere}
.al-f{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.al-f li{font-size:13px;font-weight:500;color:var(--text);background:var(--ice);border-radius:8px;padding:5px 9px}
.al-bot{margin-top:auto;padding-top:14px;border-top:1px solid var(--ice);display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.al-price b{display:block;font:800 24px/1.1 var(--display);color:var(--ink);white-space:nowrap}.al-price span{font-size:13px;color:var(--muted)}
.al-go{font:600 15px/1 var(--body);background:var(--amber);color:var(--amber-ink);border:0;border-radius:999px;padding:12px 18px;cursor:pointer}.al-go:hover{background:#ffbc1f}
.al-note{margin-top:28px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:32px;align-items:start;padding:24px 26px;border-radius:20px;background:var(--ice)}
.al-note p{margin:0;font-size:15px;color:var(--muted)}.al-note p b{color:var(--ink);font-weight:600}
.al-note dl{margin:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;font-size:14px}
.al-note dt{font-weight:600;color:var(--ink)}.al-note dd{margin:0;color:var(--muted)}
@media (max-width:980px){.al-note{grid-template-columns:1fr;gap:18px}}
@media (max-width:640px){.alarms{padding:64px 0}.al-tabs{display:flex}.al-tabs button{flex:1;justify-content:center;padding:12px 10px}.al-note dl{grid-template-columns:1fr}.al-grid{grid-template-columns:1fr}}

/* услуги — журнальная сетка фото */
.services{padding:104px 0;background:var(--white);border-top:1px solid var(--frost);border-bottom:1px solid var(--frost)}
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
.svc button:hover{background:var(--amber);border-color:var(--amber);color:var(--amber-ink)}
.svc.big{grid-column:span 2;grid-row:span 2}.svc.big h3{font-size:clamp(26px,2.6vw,36px);font-weight:800}.svc.big p{font-size:17px}
.svc.wide{grid-column:span 3;grid-row:span 1}
.svc.wide::before{background:linear-gradient(90deg,rgba(10,18,24,.92) 0%,rgba(10,18,24,.7) 42%,rgba(10,18,24,.05) 75%)}
.svc.wide .svc-body{top:0;right:auto;width:min(560px,60%);display:flex;flex-direction:column;justify-content:center;align-items:flex-start}

/* надёжность — тёмная полоса */
.trust{background:var(--night);color:#c9d4da;padding:84px 0}
.trust .wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:56px;align-items:start}
.trust h2{color:var(--white)}
.trust dl{display:grid;grid-template-columns:1fr 1fr;gap:30px 40px;margin:0}
.trust dt{font:600 18px/1.3 var(--display);color:var(--white);margin-bottom:6px}
.trust dd{margin:0;font-size:15px;color:#9fb0ba}

/* отзывы */
.reviews{padding:96px 0;background:var(--white);border-top:1px solid var(--frost)}
.rv-head{display:flex;justify-content:space-between;align-items:end;gap:28px;flex-wrap:wrap;margin-bottom:40px}
.rv-score{display:flex;align-items:center;gap:18px;text-decoration:none;color:var(--ink);border:1.5px solid var(--frost);border-radius:20px;padding:14px 20px 14px 16px;background:var(--paper)}
.rv-score:hover{border-color:var(--ink);color:var(--ink)}
.rv-score .num{font:800 40px/1 var(--display)}
.rv-score .meta{font-size:14px;color:var(--muted);line-height:1.35}.rv-score .meta b{display:block;color:var(--ink);font-size:15px}
.gis{display:inline-grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#19aa1e;color:#fff;font:800 15px/1 var(--body);letter-spacing:-.02em}
.stars{color:#f2a900;letter-spacing:2px;font-size:16px;white-space:nowrap}.rv .stars{display:block;margin-bottom:10px}.stars i{color:var(--frost);font-style:normal}
.rv-list{columns:3 300px;column-gap:18px}
.rv{break-inside:avoid;margin:0 0 18px;background:var(--paper);border-radius:20px;padding:24px 24px 20px;border:1px solid var(--frost)}
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
.order{background:var(--ink);color:#d7dee3;padding:100px 0}
.order .wrap{display:grid;grid-template-columns:.9fr 1.1fr;gap:64px;align-items:start}
.order h2{color:var(--white)}.order p{color:#aeb9c1}
.order .contacts{margin-top:30px;display:grid;gap:14px;font-size:16px}
.order .contacts a{color:var(--white)}.order .contacts span{color:#8c98a1;display:block;font-size:14px}
form{display:grid;gap:16px}
.f2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
label{display:grid;gap:6px;font-size:14px;color:#aeb9c1}
input,textarea,select{font:16px var(--body);color:var(--white);background:#14181c;border:1.5px solid #333b42;border-radius:12px;padding:14px 16px;width:100%}
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

footer{padding:34px 0 calc(34px + env(safe-area-inset-bottom));font-size:14px;color:var(--muted)}
footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
footer small{display:block;font-size:12px;margin-top:4px}

@media (max-width:1240px){
  .top nav{display:none}.top .tel{margin-left:auto}.top .wrap{height:84px}.logo{height:58px}
  section[id]{scroll-margin-top:84px}
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
  .wrap{padding:0 16px}.top .wrap{height:72px;gap:12px}.logo{height:46px}.top .tel{font-size:15px}
  section[id]{scroll-margin-top:72px}
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
@media (max-width:400px){.logo{height:40px}.top .tel{font-size:14px}h2{font-size:clamp(22px,7vw,28px)}}
@media (prefers-reduced-motion:reduce){.svc img{transition:none}html{scroll-behavior:auto}}
</style></head>
<body>
<header class="top"><div class="wrap">
  <a href="/" class="home" aria-label="Бумсистем — на главную">${LOGO}</a>
  <nav aria-label="Разделы"><a href="#services">Услуги</a>${alarms ? '<a href="#alarms">Сигнализации</a>' : ''}${rvOn ? '<a href="#reviews">Отзывы</a>' : ''}<a href="#steps">Как работаем</a><a href="#order">Контакты</a></nav>
  ${phone ? `<a class="tel" href="tel:${esc(tel)}">${esc(phone)}</a>` : ''}
</div></header>

<main>
<section class="hero"><div class="wrap">
  <div>
    <h1><span>Премиальный звук.</span><span>Бескомпромиссная надёжность.</span></h1>
    <p class="lead">Высочайшее качество работ и уровень сервиса, который вас не разочарует. Автозвук, шумоизоляция, сигнализации с автозапуском, мультимедиа и 3D-печать — под вашу машину.</p>
    <div class="actions"><a class="btn btn-gold" href="#order">Оставить заявку</a>${phone ? `<a class="btn btn-line" href="tel:${esc(tel)}">Позвонить</a>` : ''}</div>
    <div class="promise">
      <div><b>Гарантия</b><span>на работы и установленное оборудование</span></div>
      <div><b>Фотоотчёт</b><span>фиксируем состояние машины при приёмке</span></div>
      <div><b>Шесть постов</b><span>запись без долгого ожидания</span></div>
    </div>
  </div>
  <figure class="shot">
    <div class="ph"><img src="${IMG(HERO.img, 1400)}" srcset="${srcset(HERO.img)}" sizes="(max-width:980px) 100vw, 46vw" alt="${esc(HERO.alt)}" fetchpriority="high" onerror="this.remove()"></div>
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
    <li><b>Запись</b><span>Назначаем день и пост, чтобы вы не ждали в очереди.</span></li>
    <li><b>Работа</b><span>Принимаем машину по акту с фото, работаем по заказ-наряду.</span></li>
    <li><b>Выдача</b><span>Показываем результат, выдаём документы и гарантийный талон.</span></li>
  </ol>
</div></section>

<section class="order" id="order"><div class="wrap">
  <div>
    <h2>Оставьте заявку</h2>
    <p>Напишите, что хотите сделать, — перезвоним в рабочее время и подскажем по срокам и решению.</p>
    <div class="contacts">
      ${phone ? `<div><span>Телефон</span><a href="tel:${esc(tel)}">${esc(phone)}</a></div>` : ''}
      ${address ? `<div><span>Адрес</span>${map ? `<a href="${esc(map)}" target="_blank" rel="noopener">${esc(address)}</a>` : esc(address)}</div>` : ''}
      <div><span>Режим работы</span>${esc(h.days)}, ${esc(h.time)}${h.off ? `, выходной: ${esc(h.off)}` : ''}</div>
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
      <div class="chips" role="group" aria-labelledby="svcLbl">${GROUPS.map((g) => `<label><input type="checkbox" name="svc" value="${esc(g.title)}"><span>${esc(g.title)}</span></label>`).join('')}</div></div>
    <label>Комментарий<textarea name="message" maxlength="2000" placeholder="Что важно учесть: бюджет, сроки, какое оборудование уже есть"></textarea></label>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <label class="agree"><input type="checkbox" name="agree" required><span>Согласен на обработку персональных данных — только чтобы связаться со мной по этой заявке.</span></label>
    <div><button class="btn btn-gold" type="submit" id="sendBtn">Отправить заявку</button></div>
    <div class="msg" id="msg" role="status" aria-live="polite"></div>
  </form>
  </div>
</div></section>
</main>

<footer><div class="wrap"><span>© ${year} Бумсистем — тюнинг-ателье с сибирским характером<small>Фото: ${[HERO, ...GROUPS].map((g) => esc(g.by)).filter((v, i, a) => a.indexOf(v) === i).join(', ')} / <a href="https://unsplash.com" target="_blank" rel="noopener" style="color:inherit">Unsplash</a></small></span><a href="/crm">Вход для сотрудников</a></div></footer>

<script>
document.querySelectorAll('.al-tabs [data-tab]').forEach(function (b, _, all) {
  b.addEventListener('click', function () {
    all.forEach(function (x) { var on = x === b; x.setAttribute('aria-selected', on ? 'true' : 'false'); var p = document.getElementById('alp-' + x.getAttribute('data-tab')); if (on) p.removeAttribute('data-off'); else p.setAttribute('data-off', ''); });
  });
});
document.querySelectorAll('.rv .more').forEach(function (b) { b.addEventListener('click', function () { b.parentNode.classList.remove('clamp'); b.remove(); }); });
(function () {
  var f = document.getElementById('leadForm'), msg = document.getElementById('msg'), btn = document.getElementById('sendBtn');
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
      body: JSON.stringify({ name: f.elements.name.value, phone: f.elements.phone.value, car: f.elements.car.value, services: svc, message: f.elements.message.value, website: f.elements.website.value, agree: true }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Ошибка'); return j; }); })
      .then(function () {
        document.getElementById('formBox').innerHTML = '<div class="done" tabindex="-1" id="done"><h3>Заявка отправлена</h3><p>Перезвоним в рабочее время${phone ? ` с номера ${esc(phone)}` : ''}. Если вопрос срочный — позвоните нам сами.</p></div>';
        document.getElementById('done').focus();
      })
      .catch(function (err) { msg.className = 'msg err'; msg.textContent = 'Заявка не отправилась: ' + err.message + '. Попробуйте ещё раз или позвоните нам.'; btn.disabled = false; btn.textContent = 'Отправить заявку'; });
  });
})();
</script>
</body></html>`;
}

module.exports = { render, GROUPS };
