'use strict';
// Сторож: если сервер «завис» (не отвечает 20 секунд) — записывает, какой запрос это сделал (кто, с какого устройства,
// какое действие) и перезапускает CRM (systemd поднимает её за 3 секунды). Вместо «висит до перезагрузки сервера» —
// короткая пауза и запись в журнал «Настройки → Диагностика».
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { DATA_DIR } = require('./db');

const LOG = path.join(DATA_DIR, 'diag.log');
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
  setInterval(() => {
    const now = Date.now(); const lag = now - last - 1000;
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

function read() { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-200).reverse().join('\n'); } catch { return ''; } }
function clear() { try { fs.writeFileSync(LOG, ''); } catch {} }

module.exports = { start, track, log, read, clear, device };
