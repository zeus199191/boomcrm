'use strict';
// Сайт-лендинг тюнинг-ателье: главная страница сервера. Контакты и цены берутся из CRM.
const { all, getSetting } = require('./db');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = (n) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ') + ' ₽';

// Основные направления: какие категории прайса CRM в них входят
const GROUPS = [
  { key: 'sound', title: 'Автозвук', text: 'Акустика, усилители, сабвуферы, процессоры. Подбираем систему под машину и музыку, которую вы слушаете, и настраиваем на месте.', match: /акустик|усилит|сабвуф|настройка$|процессор|звук/i },
  { key: 'noise', title: 'Шумоизоляция', text: 'Двери, пол, арки, багажник, потолок. В салоне тише на трассе и на шипах, музыка звучит чище.', match: /шумо/i },
  { key: 'alarm', title: 'Сигнализации и автозапуск', text: 'StarLine и Pandora: автозапуск по времени и температуре, управление с телефона, GPS, защита от угона.', match: /сигнал|охран|автозапуск/i },
  { key: 'media', title: 'Магнитолы и мультимедиа', text: 'Android-магнитолы, рамки и проводка под вашу машину, CarPlay и Android Auto, сохранение штатных кнопок.', match: /магнитол|мультимед/i },
  { key: 'cam', title: 'Камеры и регистраторы', text: 'Камеры заднего и переднего вида, парктроники, видеорегистраторы со скрытой проводкой.', match: /камер|регистр|парктрон/i },
  { key: 'print3d', title: '3D-печать', text: 'Подиумы под динамики, рамки магнитол, крепления, заглушки и накладки салона — моделируем и печатаем под вашу машину.', match: /3d|3д|печат/i },
  { key: 'diag', title: 'Диагностика и доработки', text: 'Поиск неисправностей электрики, установка дополнительного оборудования, доработка проводки.', match: /диагност|установк|электр/i },
];

function groupPrices() {
  const rows = all('SELECT category, MIN(price) mn FROM services WHERE active=1 AND price>0 GROUP BY category');
  return GROUPS.map((g) => {
    const p = rows.filter((r) => g.match.test(r.category || '')).map((r) => r.mn);
    return { ...g, from: p.length ? Math.min(...p) : null };
  });
}

const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
function hoursText() {
  const off = getSetting('days_off', '0').split(',').filter((x) => x !== '').map(Number);
  const order = [1, 2, 3, 4, 5, 6, 0]; const work = order.filter((d) => !off.includes(d));
  let days;
  const idx = work.map((d) => order.indexOf(d));
  if (work.length && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)) days = work.length === 1 ? cap(DOW[work[0]]) : `${cap(DOW[work[0]])}–${DOW[work[work.length - 1]]}`;
  else days = work.map((d) => DOW[d]).join(', ');
  const t = `${getSetting('work_start', '09:00')}–${getSetting('work_end', '21:00')}`;
  return { days, time: t, off: off.length ? order.filter((d) => off.includes(d)).map((d) => DOW[d]).join(', ') : '' };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const EMBLEM = `<g><circle cx="110" cy="110" r="104" fill="none" stroke="currentColor" stroke-width="8"/>
<g fill="currentColor"><circle cx="110" cy="22" r="5"/><circle cx="198" cy="110" r="5"/><circle cx="110" cy="198" r="5"/><circle cx="22" cy="110" r="5"/><circle cx="172.2" cy="47.8" r="5"/><circle cx="172.2" cy="172.2" r="5"/><circle cx="47.8" cy="172.2" r="5"/><circle cx="47.8" cy="47.8" r="5"/></g>
<g class="cone"><circle cx="110" cy="110" r="78" fill="currentColor"/><circle cx="110" cy="110" r="62" fill="var(--paper)"/><circle cx="110" cy="110" r="50" fill="none" stroke="currentColor" stroke-width="4"/>
<circle cx="110" cy="110" r="38" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="110" cy="110" r="24" fill="currentColor"/><circle cx="102" cy="102" r="6" fill="var(--paper)"/></g></g>`;

const LOGO = `<svg class="logo" viewBox="100 160 970 240" role="img" aria-label="Бумсистем — тюнинг-ателье с сибирским характером">
<g transform="translate(110,170)">${EMBLEM}</g>
<text class="lw" x="370" y="300" textLength="690" lengthAdjust="spacingAndGlyphs">БУМСИСТЕМ</text><rect x="372" y="336" width="48" height="6" fill="currentColor"/>
<text class="lt" x="436" y="345" textLength="560" lengthAdjust="spacing">ТЮНИНГ-АТЕЛЬЕ С СИБИРСКИМ ХАРАКТЕРОМ</text><rect x="1012" y="336" width="48" height="6" fill="currentColor"/></svg>`;

function render({ loggedIn = false } = {}) {
  const phone = getSetting('company_phone') || '';
  const tel = phone.replace(/[^\d+]/g, '');
  const address = getSetting('company_address') || '';
  const h = hoursText();
  const groups = groupPrices();
  const map = address ? `https://yandex.ru/maps/?text=${encodeURIComponent(address)}` : '';
  const year = new Date().getFullYear();

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Бумсистем — тюнинг-ателье: автозвук, шумоизоляция, сигнализации с автозапуском, 3D-печать</title>
<meta name="description" content="Автозвук, шумоизоляция, сигнализации StarLine и Pandora с автозапуском, магнитолы, камеры и 3D-печать деталей. Оставьте заявку — перезвоним и подберём решение под вашу машину.">
<meta name="theme-color" content="#EEF2F4">
<link rel="icon" type="image/png" href="/favicon-64.png"><link rel="apple-touch-icon" href="/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=Unbounded:wght@500;700;900&display=swap">
<script>if (/^#\\//.test(location.hash)) location.replace('/crm' + location.hash);</script>
<style>:root{--paper:#EEF2F4;--ink:#000;--text:#1d2329;--muted:#55606b;--baikal:#1C5D7A;--frost:#CBD7DD;--amber:#F2A900;--amber-ink:#2a1d00;--white:#fff;
  --display:'Unbounded','Arial Black',Arial,sans-serif;--body:'Golos Text',system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;--wrap:1160px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--text);font:17px/1.6 var(--body);-webkit-font-smoothing:antialiased}
a{color:var(--baikal)}a:hover{color:var(--ink)}
:focus-visible{outline:3px solid var(--amber);outline-offset:3px;border-radius:4px}
.wrap{max-width:var(--wrap);margin:0 auto;padding:0 24px}
h1,h2,h3{font-family:var(--display);color:var(--ink);margin:0;font-weight:700;letter-spacing:-.01em}
h1{font-size:clamp(32px,5vw,64px);line-height:1.06;font-weight:900;letter-spacing:-.025em}
h2{font-size:clamp(26px,3.2vw,40px);line-height:1.1}
h3{font-size:19px;line-height:1.25;font-weight:700}
p{margin:0 0 1em;max-width:62ch}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;font:600 16px/1 var(--body);border-radius:999px;padding:16px 26px;text-decoration:none;cursor:pointer;border:2px solid var(--ink);transition:background .15s,color .15s}
.btn-gold{background:var(--amber);color:var(--amber-ink);border-color:var(--amber)}.btn-gold:hover{background:#ffbc1f;color:var(--amber-ink)}
.btn-line{background:transparent;color:var(--ink)}.btn-line:hover{background:var(--ink);color:var(--white)}

/* шапка */
.top{position:sticky;top:0;z-index:20;background:rgba(238,242,244,.9);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-bottom:1px solid var(--frost)}
.top .wrap{display:flex;align-items:center;gap:28px;height:76px}
.home{display:block;color:var(--ink);text-decoration:none}
.logo{height:46px;width:auto;color:var(--ink);display:block}
.logo .lw{font-family:var(--display);font-weight:900;font-size:80px}.logo .lt{font-family:var(--display);font-weight:500;font-size:16px;letter-spacing:3px}
.top nav{display:flex;gap:24px;margin-left:auto}.top nav a{color:var(--text);text-decoration:none;font-weight:500}.top nav a:hover{color:var(--baikal)}
.top .tel{font-weight:600;color:var(--ink);text-decoration:none;white-space:nowrap}
.login{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border:1.5px solid var(--ink);border-radius:999px;color:var(--ink);text-decoration:none;font-weight:600;font-size:15px;white-space:nowrap}
.login:hover{background:var(--ink);color:var(--white)}.login svg{width:16px;height:16px}

/* первый экран */
.hero{padding:72px 0 88px;overflow:hidden}
.hero .wrap{display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:center}
.lead{font-size:20px;color:var(--muted);margin:26px 0 34px;max-width:46ch}
.hero .actions{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.facts{display:flex;gap:30px;flex-wrap:wrap;margin-top:44px;padding-top:24px;border-top:1px solid var(--frost)}
.facts div{font-size:15px;color:var(--muted);max-width:21ch}.facts b{display:block;color:var(--ink);font:700 18px/1.3 var(--display);margin-bottom:4px}
.speaker{position:relative;aspect-ratio:1;max-width:460px;width:100%;justify-self:end;color:var(--ink)}
.speaker svg{position:relative;width:100%;height:auto;z-index:1}
.ring{position:absolute;inset:6%;border-radius:50%;border:2px solid var(--baikal);opacity:0}
@media (prefers-reduced-motion:no-preference){
  .ring{animation:wave 1.6s cubic-bezier(.2,.6,.3,1) .5s 3 both}.ring:nth-child(2){animation-delay:.75s}.ring:nth-child(3){animation-delay:1s}
  .cone{transform-origin:110px 110px;animation:thump 1.6s ease-out .5s 3}
}
@keyframes wave{0%{transform:scale(.7);opacity:.55}100%{transform:scale(1.5);opacity:0}}
@keyframes thump{0%{transform:scale(1)}8%{transform:scale(1.06)}22%{transform:scale(.985)}40%,100%{transform:scale(1)}}

/* услуги — как прайс */
.services{padding:88px 0;background:var(--white);border-top:1px solid var(--frost);border-bottom:1px solid var(--frost)}
.sec-head{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:36px;flex-wrap:wrap}
.sec-head p{color:var(--muted);margin:0;max-width:44ch}
.price{list-style:none;margin:0;padding:0;border-top:2px solid var(--ink)}
.price li{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.6fr) auto auto;gap:28px;align-items:center;padding:26px 0;border-bottom:1px solid var(--frost)}
.price p{margin:0;color:var(--muted);font-size:16px}
.price .from{font:700 20px/1.2 var(--display);color:var(--ink);white-space:nowrap;text-align:right}
.price .from small{display:block;font:400 13px var(--body);color:var(--muted)}
.price button{background:none;border:1.5px solid var(--ink);border-radius:999px;padding:10px 16px;font:600 14px var(--body);cursor:pointer;color:var(--ink);white-space:nowrap}
.price button:hover{background:var(--ink);color:var(--white)}

/* как работаем */
.steps{padding:88px 0}
.steps ol{list-style:none;counter-reset:s;margin:40px 0 0;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:26px}
.steps li{counter-increment:s;padding-top:18px;border-top:2px solid var(--ink)}
.steps li::before{content:counter(s);display:block;font:900 34px/1 var(--display);color:var(--baikal);margin-bottom:14px}
.steps li b{display:block;color:var(--ink);font-weight:600;margin-bottom:6px}.steps li span{font-size:15px;color:var(--muted)}

/* заявка */
.order{background:var(--ink);color:#d7dee3;padding:96px 0}
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

@media (max-width:980px){
  .top nav{display:none}.top .login{margin-left:auto}.hero .wrap,.order .wrap{grid-template-columns:1fr}
  .speaker{max-width:300px;justify-self:start;order:-1}
  .steps ol{grid-template-columns:1fr 1fr}
  .price li{grid-template-columns:1fr auto;gap:10px 18px}.price li p{grid-column:1/-1;grid-row:2}.price li .from{grid-row:1;grid-column:2}.price li button{grid-column:1/-1;justify-self:start}
}
@media (max-width:600px){
  .wrap{padding:0 16px}.top .wrap{height:64px;gap:12px}.logo{height:34px}.top .tel{display:none}
  .hero{padding:36px 0 56px}.lead{font-size:18px}.facts{gap:18px}
  .services,.steps{padding:60px 0}.order{padding:64px 0}
  .f2,.steps ol{grid-template-columns:1fr}
  .hero .btn{width:100%}
  .speaker{max-width:170px}
}
</style></head>
<body>
<header class="top"><div class="wrap">
  <a href="/" class="home" aria-label="Бумсистем — на главную" style="text-decoration:none">${LOGO}</a>
  <nav aria-label="Разделы"><a href="#services">Услуги</a><a href="#steps">Как работаем</a><a href="#order">Контакты</a></nav>
  ${phone ? `<a class="tel" href="tel:${esc(tel)}">${esc(phone)}</a>` : ''}
  <a class="login" href="/crm" ${phone ? '' : 'style="margin-left:auto"'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>${loggedIn ? 'Открыть CRM' : 'Вход'}</a>
</div></header>

<main>
<section class="hero"><div class="wrap">
  <div>
    <h1>Звук, который слышно. Мотор, который заводится в&nbsp;мороз.</h1>
    <p class="lead">Автозвук и шумоизоляция, сигнализации с автозапуском, магнитолы и камеры. Печатаем на 3D-принтере подиумы, рамки и детали под вашу машину. Подберём решение под бюджет, сделаем аккуратно и дадим гарантию.</p>
    <div class="actions"><a class="btn btn-gold" href="#order">Оставить заявку</a>${phone ? `<a class="btn btn-line" href="tel:${esc(tel)}">Позвонить</a>` : ''}</div>
    <div class="facts">
      <div><b>6 постов</b>машина не ждёт очереди неделями</div>
      <div><b>Гарантия</b>на работы и установленное оборудование</div>
      <div><b>Фотоотчёт</b>фиксируем состояние машины при приёмке</div>
    </div>
  </div>
  <div class="speaker" aria-hidden="true"><i class="ring"></i><i class="ring"></i><i class="ring"></i><svg viewBox="0 0 220 220">${EMBLEM}</svg></div>
</div></section>

<section class="services" id="services"><div class="wrap">
  <div class="sec-head"><h2>Что мы делаем</h2><p>Цены — за работу, без стоимости оборудования. Точную сумму назовём после осмотра машины.</p></div>
  <ul class="price">
  ${groups.map((g) => `<li><h3>${esc(g.title)}</h3><p>${esc(g.text)}</p><div class="from">${g.from ? `<small>работа</small>от ${rub(g.from)}` : '<small>стоимость</small>по запросу'}</div><button type="button" data-pick="${esc(g.title)}">Заявка на это</button></li>`).join('\n  ')}
  </ul>
</div></section>

<section class="steps" id="steps"><div class="wrap">
  <h2>Как проходит работа</h2>
  <ol>
    <li><b>Заявка</b><span>Оставляете заявку на сайте или звоните.</span></li>
    <li><b>Подбор</b><span>Перезваниваем, уточняем задачу, предлагаем варианты по бюджету.</span></li>
    <li><b>Запись</b><span>Назначаем день и пост, чтобы вы не ждали в очереди.</span></li>
    <li><b>Работа</b><span>Принимаем машину по акту с фото, делаем работу по заказ-наряду.</span></li>
    <li><b>Выдача</b><span>Показываем результат, выдаём документы и гарантийный талон.</span></li>
  </ol>
</div></section>

<section class="order" id="order"><div class="wrap">
  <div>
    <h2>Оставьте заявку</h2>
    <p>Напишите, что хотите сделать, — перезвоним в рабочее время и подскажем по срокам и цене.</p>
    <div class="contacts">
      ${phone ? `<div><span>Телефон</span><a href="tel:${esc(tel)}">${esc(phone)}</a></div>` : ''}
      ${address ? `<div><span>Адрес</span>${map ? `<a href="${esc(map)}" target="_blank" rel="noopener">${esc(address)}</a>` : esc(address)}</div>` : ''}
      <div><span>Режим работы</span>${esc(h.days)}, ${esc(h.time)}${h.off ? ` · выходной: ${esc(h.off)}` : ''}</div>
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
      <div class="chips" role="group" aria-labelledby="svcLbl">${groups.map((g) => `<label><input type="checkbox" name="svc" value="${esc(g.title)}"><span>${esc(g.title)}</span></label>`).join('')}</div></div>
    <label>Комментарий<textarea name="message" maxlength="2000" placeholder="Что важно учесть: бюджет, сроки, какое оборудование уже есть"></textarea></label>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <label class="agree"><input type="checkbox" name="agree" required><span>Согласен на обработку персональных данных — только чтобы связаться со мной по этой заявке.</span></label>
    <div><button class="btn btn-gold" type="submit" id="sendBtn">Отправить заявку</button></div>
    <div class="msg" id="msg" role="status" aria-live="polite"></div>
  </form>
  </div>
</div></section>
</main>

<footer><div class="wrap"><span>© ${year} Бумсистем — тюнинг-ателье с сибирским характером</span><a href="/crm">Вход для сотрудников</a></div></footer>

<script>
(function () {
  var f = document.getElementById('leadForm'), msg = document.getElementById('msg'), btn = document.getElementById('sendBtn');
  document.querySelectorAll('[data-pick]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-pick');
      f.querySelectorAll('input[name=svc]').forEach(function (c) { if (c.value === v) c.checked = true; });
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
