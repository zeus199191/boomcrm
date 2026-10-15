'use strict';
const crypto = require('node:crypto');
const { get, run } = require('./db');
const { HttpError } = require('./http');

const SESSION_DAYS = 30;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  const exp = Buffer.from(hashHex, 'hex');
  return exp.length === hash.length && crypto.timingSafeEqual(hash, exp);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', token, userId, Date.now() + SESSION_DAYS * 864e5);
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return token;
}
function userFromToken(token) {
  if (!token) return null;
  const u = get(`SELECT u.id,u.login,u.name,u.role,u.is_master,u.salary_percent,u.goods_percent,u.active FROM sessions s
                 JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`, token, Date.now());
  return u && u.active ? u : null;
}

// Простая защита от перебора паролей
const attempts = new Map();
function checkRate(key) {
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, t: now };
  if (now - a.t > 15 * 60e3) { a.n = 0; a.t = now; }
  a.n++; attempts.set(key, a);
  if (a.n > 10) throw new HttpError(429, 'Слишком много попыток входа. Подождите 15 минут.');
}

// Права ролей
const can = {
  admin: () => true,
  manager: (perm) => !['users', 'settings', 'salary_all'].includes(perm),
  master: (perm) => ['orders_own', 'calendar', 'clients_view'].includes(perm),
};
function requireRole(...roles) {
  return (ctx) => {
    if (!roles.includes(ctx.user.role)) throw new HttpError(403, 'Недостаточно прав');
  };
}

module.exports = { hashPassword, verifyPassword, createSession, userFromToken, checkRate, can, requireRole };
