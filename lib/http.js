'use strict';
// Минимальный роутер поверх node:http
const fs = require('node:fs');
const path = require('node:path');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createRouter() {
  const routes = [];
  const add = (method) => (pattern, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handlers });
  };
  const router = {
    get: add('GET'), post: add('POST'), put: add('PUT'), delete: add('DELETE'),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(pathname);
        if (m) {
          const params = {};
          r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
          return { handlers: r.handlers, params };
        }
      }
      return null;
    },
  };
  return router;
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = req.headers['content-type'] || '';
      try {
        if (ct.includes('application/json')) return resolve(JSON.parse(raw));
        if (ct.includes('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(raw)));
        try { return resolve(JSON.parse(raw)); } catch { return resolve(Object.fromEntries(new URLSearchParams(raw))); }
      } catch { reject(new HttpError(400, 'Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  if (typeof body === 'object' && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
    headers['Content-Type'] = headers['Content-Type'] || 'application/json; charset=utf-8';
  }
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function serveStatic(root) {
  return (req, res, pathname) => {
    let p = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root)) return false;
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (!stat.isFile()) return false;
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : ext === '.woff2' ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    });
    require('node:stream').pipeline(fs.createReadStream(file), res, () => {}); // закрывает файл при обрыве запроса
    return true;
  };
}

module.exports = { createRouter, readBody, parseCookies, send, serveStatic, HttpError };
