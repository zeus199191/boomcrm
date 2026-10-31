'use strict';
// Сторож: если сервер «завис» (не отвечает 20 секунд) — записывает, какой запрос это сделал (кто, с какого устройства,
// какое действие) и перезапускает CRM (systemd поднимает её за 3 секунды). Вместо «висит до перезагрузки сервера» —
// короткая пауза и запись в журнал «Настройки → Диагностика».
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { DATA_DIR } = require('./db');

const LOG = path.join(DATA_DIR, 'diag.log');
const HB = path.join(DATA_DIR, 'heartbeat');
const STARTED = Date.now();
const lags = []; // [{t, sec}] — когда цикл CRM был занят
const hm = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const HANG_MS = +process.env.WATCHDOG_MS || 20000;
const sab = new SharedArrayBuffer(8 + 8192);
const beat = new Float64Array(sab, 0, 1);
const buf = new Uint8Array(sab, 8);
const inflight = new Map();
let seq = 0;

const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
function log(line) {
  try {
    fs.appendFileSync(LOG, `${stamp()} ${line}\n`);
    const st = fs.statSync(LOG); if (st.size > 300000) { const t = fs.readFileSync(LOG, 'utf8'); fs.writeFileSync(LOG, t.slice(-150000)); }
  } catch {}
}
// устройство коротко: iPhone iOS 17 Safari / Android Chrome / Windows Chrome …
function device(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? (ua.match(/(iPhone|iPad)[^)]*OS (\d+)/) || []).slice(1, 3).join(' iOS ') || 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /YaBrowser/.test(ua) ? 'Яндекс' : /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : ua.slice(0, 30);
  return [os, br].filter(Boolean).join(' ');
}
const desc = (e) => `${e.u || 'гость'} · ${e.d} · ${e.m} ${e.p}${e.b ? ' · ' + e.b : ''}`;
function sync() {
  const s = Buffer.from(JSON.stringify([...inflight.values()].slice(-20)));
  buf.fill(0); buf.set(s.subarray(0, buf.length - 1));
}

// начало запроса: возвращает объект, в который можно дописать пользователя и кратко тело запроса
function track(req, pathname) {
  const id = ++seq;
  const e = { m: req.method, p: pathname.slice(0, 120), d: device(req.headers['user-agent']), u: '', b: '', t: Date.now() };
  inflight.set(id, e); sync();
  let done = false;
  const end = () => {
    if (done) return; done = true;
    inflight.delete(id); sync();
    const ms = Date.now() - e.t;
    if (ms > 8000 && !/\/media|works-media|update|publish|\/ai/.test(e.p)) log(`Долгий запрос ${Math.round(ms / 1000)} с: ${desc(e)}`);
  };
  const set = (k, v) => { e[k] = v; sync(); };
  return { e, end, set };
}

let started = false;
function start() {
  if (started) return; started = true;
  let last = Date.now(); beat[0] = last;
  // запуск: сколько CRM не работала перед этим и не перезагружался ли сервер
  try {
    const prev = +fs.readFileSync(HB, 'utf8') || 0; const gap = prev ? Math.round((STARTED - prev) / 1000) : 0;
    const up = Math.round(os.uptime());
    let extra = '';
    try { const sh = execFileSync('systemctl', ['show', 'boomcrm', '-p', 'NRestarts', '-p', 'Result'], { encoding: 'utf8', timeout: 3000 }); const n = /NRestarts=(\d+)/.exec(sh); const r = /Result=(\S+)/.exec(sh); extra = ` Перезапусков службы с загрузки сервера: ${n ? n[1] : '?'}${r && r[1] !== 'success' ? ', причина последнего: ' + r[1] : ''}.`; } catch {}
    log(`CRM запущена (v${require('../package.json').version}).${prev ? ` До этого работала до ${hm(prev)} — перерыв ${gap > 90 ? Math.round(gap / 60) + ' мин' : gap + ' с'}.` : ''}${up < gap + 120 ? ` Сервер был перезагружен ${Math.round(up / 60)} мин назад.` : ''}${extra}`);
  } catch {}
  // причина прошлого падения — из системного журнала (ошибка с местом в коде, нехватка памяти, убит системой)
  try {
    const prevT = +fs.readFileSync(HB, 'utf8') || 0;
    if (prevT && STARTED - prevT > 4000) {
      const j = execFileSync('journalctl', ['-u', 'boomcrm', '--since', '@' + Math.floor((prevT - 120000) / 1000), '--until', '@' + Math.floor(STARTED / 1000), '--no-pager', '-o', 'cat', '-q'], { encoding: 'utf8', timeout: 5000, maxBuffer: 4e6 });
      const lines = j.split('\n').filter((l) => /Error|error|FATAL|heap|memory|Killed|killed|oom|SIGKILL|SIGABRT|exception|Exception|\s+at\s|status=|Main process exited|Failed/.test(l) && !/CRM запущена/.test(l));
      if (lines.length) log('ПРИЧИНА ПРОШЛОЙ ОСТАНОВКИ (из системного журнала):\n    ' + [...new Set(lines)].slice(-25).join('\n    '));
    }
  } catch {}
  // падение из-за ошибки в коде: записываем, кто и что делал, со стеком
  const stack = (e) => String((e && e.stack) || e).split('\n').slice(0, 8).join('\n    ');
  process.on('uncaughtException', (e) => {
    log(`ПАДЕНИЕ CRM: ${stack(e)}\n    Выполнялись: ${[...inflight.values()].map(desc).join(' | ') || '—'}`);
    console.error(e); process.exit(1);
  });
  process.on('unhandledRejection', (e) => { // не роняем CRM, но записываем
    log(`Необработанная ошибка (CRM продолжает работу): ${stack(e)}\n    Выполнялись: ${[...inflight.values()].map(desc).join(' | ') || '—'}`);
    console.error(e);
  });
  const hb = () => { try { fs.writeFileSync(HB, String(Date.now())); } catch {} };
  hb(); setInterval(() => {
    hb();
    for (const e of inflight.values()) if (!e.warned && Date.now() - e.t > 60000 && !/update|publish/.test(e.p)) { e.warned = 1; log(`Запрос висит больше минуты (ждём данные от устройства?): ${desc(e)}`); }
  }, 15000).unref();
  setInterval(() => {
    const now = Date.now(); const lag = now - last - 1000;
    if (lag > 3000) { lags.push({ t: now, sec: Math.round(lag / 1000) }); if (lags.length > 200) lags.shift(); }
    if (lag > 3000) log(`Сервер был занят ${Math.round(lag / 1000)} с. В это время выполнялись: ${[...inflight.values()].map(desc).join(' | ') || '—'}`);
    last = now; beat[0] = now;
  }, 1000).unref();
  const code = `
    const { workerData: { sab, LOG, HANG_MS, pid } } = require('node:worker_threads'); const fs = require('node:fs');
    const beat = new Float64Array(sab, 0, 1); const buf = new Uint8Array(sab, 8);
    setInterval(() => {
      const idle = Date.now() - beat[0]; if (idle < HANG_MS) return;
      let list = []; try { const n = buf.indexOf(0); list = JSON.parse(Buffer.from(buf.subarray(0, n < 0 ? buf.length : n)).toString()); } catch {}
      const d = new Date(); const p = (n) => String(n).padStart(2, '0');
      const st = p(d.getDate()) + '.' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      const what = list.map((e) => (e.u || 'гость') + ' · ' + e.d + ' · ' + e.m + ' ' + e.p + (e.b ? ' · ' + e.b : '') + ' (идёт ' + Math.round((Date.now() - e.t) / 1000) + ' с)').join(' | ') || 'запросов не было — завис фоновый процесс';
      try { fs.appendFileSync(LOG, st + ' ЗАВИСАНИЕ: сервер не отвечал ' + Math.round(idle / 1000) + ' с, CRM перезапущена. Выполнялось: ' + what + '\\n'); } catch {}
      process.kill(pid, 'SIGKILL');
    }, 2000);`;
  try { new Worker(code, { eval: true, workerData: { sab, LOG, HANG_MS, pid: process.pid } }).unref(); } catch (e) { log('Сторож не запустился: ' + e.message); }
}

// отчёт браузера сотрудника: запросы не проходили с from по to
function clientReport(user, ua, r) {
  const from = +r.from || 0, to = +r.to || Date.now(); if (!from) return;
  const srv = from < STARTED && to > STARTED - 5000 ? `CRM в это время перезапускалась (снова работает с ${hm(STARTED)})`
    : lags.some((l) => l.t >= from - 5000 && l.t <= to + 60000) ? 'CRM в это время была занята/подвисала' : 'CRM в это время работала нормально — запросы до неё не доходили (связь, интернет, nginx или хостинг)';
  const kinds = Object.entries(r.kinds || {}).map(([k, n]) => `${k} ×${n}`).join(', ');
  log(`НЕТ СВЯЗИ у ${user ? user.name : 'гость'} · ${device(ua)}${r.net ? ' · сеть ' + String(r.net).slice(0, 20) : ''}: с ${hm(from)} по ${hm(to)} (${Math.max(1, Math.round((to - from) / 1000))} с), неудачных запросов ${+r.count || 0}${kinds ? ' (' + kinds + ')' : ''}${r.url ? ', последний ' + String(r.url).slice(0, 80) : ''}. ${srv}.`);
}
// состояние сервера и системные журналы (если CRM разрешено их читать)
function sysinfo() {
  const mb = (b) => Math.round(b / 1048576);
  let avail = os.freemem(); try { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) avail = +m[1] * 1024; } catch {}
  let disk = ''; try { const st = fs.statfsSync(DATA_DIR); disk = `${(st.bavail * st.bsize / 1073741824).toFixed(1)} из ${(st.blocks * st.bsize / 1073741824).toFixed(1)} ГБ свободно`; } catch {}
  const up = os.uptime();
  const info = [`Версия CRM ${require('../package.json').version}, работает с ${hm(STARTED)}`,
    `Сервер включён ${up > 86400 ? Math.floor(up / 86400) + ' дн ' : ''}${Math.floor(up % 86400 / 3600)} ч ${Math.floor(up % 3600 / 60)} мин; нагрузка ${os.loadavg().map((x) => x.toFixed(2)).join(' / ')} (ядер ${os.cpus().length})`,
    `Память: доступно ${mb(avail)} из ${mb(os.totalmem())} МБ; CRM занимает ${mb(process.memoryUsage().rss)} МБ`, disk ? 'Диск: ' + disk : ''].filter(Boolean).join('\n');
  const sh = (args) => { try { return execFileSync('journalctl', [...args, '--no-pager', '-o', 'short', '-q'], { encoding: 'utf8', timeout: 5000, maxBuffer: 2e6 }).trim(); } catch { return ''; } };
  // ошибки за 2 дня (вывод Node идёт в журнал без уровня — фильтруем по тексту) + последние строки
  const errs = sh(['-u', 'boomcrm', '--since', '-2d', '-n', '3000']).split('\n').filter((l) => /Error|FATAL|heap|memory|Killed|killed|oom|SIGKILL|SIGABRT|xception|\s+at\s|status=|exited|Failed|Started|Stopped/.test(l)).slice(-80).join('\n');
  const journal = [errs && '(ошибки, запуски и остановки за 2 дня)\n' + errs, '(последние строки)\n' + sh(['-u', 'boomcrm', '-u', 'nginx', '-n', '40'])].filter(Boolean).join('\n\n');
  const kernel = sh(['-k', '-p', 'warning', '-n', '30']);
  let nginx = ''; try { nginx = fs.readFileSync('/var/log/nginx/error.log', 'utf8').trim().split('\n').slice(-30).join('\n'); } catch {}
  return { info, journal, kernel, nginx };
}

function read() { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-200).reverse().join('\n'); } catch { return ''; } }
function clear() { try { fs.writeFileSync(LOG, ''); } catch {} }

module.exports = { start, track, log, read, clear, device, clientReport, sysinfo };
