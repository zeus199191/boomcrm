'use strict';
// CRM «Бумсистем» — сервер. Запуск: node server.js
const http = require('node:http');
const path = require('node:path');
const { readBody, parseCookies, send, serveStatic, HttpError } = require('./lib/http');
// Часовой пояс студии — Иркутск (влияет на даты в базе, сводки и печать)
process.env.TZ = process.env.CRM_TZ || 'Asia/Irkutsk';
const { get } = require('./lib/db');
const auth = require('./lib/auth');
const { router, loadOrder, contractorLedger, botHandlers } = require('./lib/api');
const print = require('./lib/print');
const tg = require('./lib/telegram');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const staticHandler = serveStatic(path.join(__dirname, 'public'));

// Первый запуск: создаём администратора
if (get('SELECT COUNT(*) n FROM users').n === 0) {
  const pw = process.env.ADMIN_PASSWORD || require('node:crypto').randomBytes(6).toString('base64url');
  require('./lib/db').run("INSERT INTO users(login,name,role,pass_hash) VALUES('admin','Администратор','admin',?)", auth.hashPassword(pw));
  console.log('==============================================');
  console.log(' Создан администратор:  логин admin');
  console.log(' Пароль:               ' + pw);
  console.log('==============================================');
  require('node:fs').writeFileSync(path.join(require('./lib/db').DATA_DIR, 'FIRST_ADMIN_PASSWORD.txt'), `login: admin\npassword: ${pw}\n`, { mode: 0o600 });
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-API-Key' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  const isPublic = pathname.startsWith('/api/public/');
  try {
    if (isPublic) for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    if (req.method === 'OPTIONS') return send(res, 204, '');

    const cookies = parseCookies(req);
    const user = auth.userFromToken(cookies.sid);

    // Печатные формы
    const pm = /^\/print\/order\/(\d+)\/(naryad|act|warranty|accept)$/.exec(pathname);
    if (pm) {
      if (!user) { res.writeHead(302, { Location: '/' }); return res.end(); }
      if (user.role === 'master') throw new HttpError(403, 'Недостаточно прав');
      const o = loadOrder(+pm[1]);
      return send(res, 200, print.render(o, pm[2]), { 'Content-Type': 'text/html; charset=utf-8' });
    }

    const wp = /^\/print\/warranty\/(\d+)\/(accept|supplier)$/.exec(pathname);
    if (wp) {
      if (!user) { res.writeHead(302, { Location: '/' }); return res.end(); }
      if (user.role === 'master') throw new HttpError(403, 'Недостаточно прав');
      return send(res, 200, print.warrantyClaim(require('./lib/warranty').load(+wp[1]), wp[2]), { 'Content-Type': 'text/html; charset=utf-8' });
    }

    const sv = /^\/print\/contractor\/(\d+)\/sverka$/.exec(pathname);
    if (sv) {
      if (!user) { res.writeHead(302, { Location: '/' }); return res.end(); }
      if (user.role === 'master') throw new HttpError(403, 'Недостаточно прав');
      const c = get('SELECT * FROM contractors WHERE id=?', +sv[1]);
      if (!c) throw new HttpError(404, 'Контрагент не найден');
      const n = new Date(); const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
      const from = url.searchParams.get('from') || today.slice(0, 8) + '01', to = url.searchParams.get('to') || today;
      const prev = new Date(from + 'T12:00:00'); prev.setDate(prev.getDate() - 1);
      const before = from > '0001' ? contractorLedger(c.id, '0000-01-01', prev.toISOString().slice(0, 10)) : [];
      return send(res, 200, print.sverka(c, before, contractorLedger(c.id, from, to), from, to), { 'Content-Type': 'text/html; charset=utf-8' });
    }

    if (pathname.startsWith('/api/')) {
      const m = router.match(req.method, pathname);
      if (!m) throw new HttpError(404, 'Не найдено');
      const opts = m.handlers.find((h) => typeof h === 'object') || {};
      const fns = m.handlers.filter((h) => typeof h === 'function');
      if (!opts.public && !user) throw new HttpError(401, 'Требуется вход');
      // защита от CSRF: изменяющие запросы только с нашего сайта
      if (!opts.public && req.method !== 'GET') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Запрос с чужого сайта');
      }
      const ctx = { req, res, user, token: cookies.sid, params: m.params, query: Object.fromEntries(url.searchParams), body: {} };
      if (req.method !== 'GET') ctx.body = await readBody(req, pathname === '/api/products/import-price' || /^\/api\/orders\/\d+\/photos$/.test(pathname) ? 15 * 1024 * 1024 : undefined);
      let result;
      for (const fn of fns) { result = await fn(ctx); }
      if (result !== undefined) send(res, 200, result);
      return;
    }

    if (req.method === 'GET' && staticHandler(req, res, pathname)) return;
    // SPA: всё остальное отдаём index.html
    if (req.method === 'GET' && !path.extname(pathname)) return staticHandler(req, res, '/');
    throw new HttpError(404, 'Не найдено');
  } catch (e) {
    let status = e.status || 500;
    let msg = e.message;
    if (status === 500 && String(e.message).includes('FOREIGN KEY')) { status = 400; msg = 'Связанная запись не найдена или используется'; }
    else if (status === 500) { console.error(new Date().toISOString(), req.method, pathname, e); msg = 'Внутренняя ошибка сервера'; }
    send(res, status, { error: msg });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CRM запущена: http://${HOST}:${PORT}`);
  require('./lib/notify').start(botHandlers);
  require('./lib/warranty').start();
});

const shutdown = () => { server.close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
