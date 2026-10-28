'use strict';
const crypto = require('node:crypto');
const { get, run } = require('./db');
const { HttpError } = require('./http');

const SESSION_DAYS = 90; // продлевается при каждом использовании (приложение на телефоне не разлогинивает)

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
  const u = get(`SELECT u.id,u.login,u.name,u.role,u.is_master,u.salary_percent,u.goods_percent,u.active,u.perm_marketing,u.perm_smm,s.expires_at FROM sessions s
                 JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?`, token, Date.now());
  if (!u || !u.active) return null;
  // скользящий срок: раз в сутки продлеваем сессию
  if (u.expires_at - Date.now() < (SESSION_DAYS - 1) * 864e5) { run('UPDATE sessions SET expires_at=? WHERE token=?', Date.now() + SESSION_DAYS * 864e5, token); u.renewed = true; }
  delete u.expires_at;
  return u;
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
// Руководитель-мастер (manager + is_master) имеет те же права, что и администратор
const isAdminUser = (u) => !!u && (u.role === 'admin' || (u.role === 'manager' && !!u.is_master));
function requireRole(...roles) {
  return (ctx) => {
    if (roles.includes(ctx.user.role) || (roles.includes('admin') && isAdminUser(ctx.user))) return;
    throw new HttpError(403, 'Недостаточно прав');
  };
}

// Маркетинг (полный): администратор всегда; руководители — если не сняли галочку; остальные — если поставили
const canMarketing = (u) => !!u && (u.role === 'admin' || (u.perm_marketing === null || u.perm_marketing === undefined ? isAdminUser(u) : u.perm_marketing === 1));
const canSmm = (u) => canMarketing(u) || (!!u && u.perm_smm === 1);
const guard = (fn, msg) => (ctx) => { if (!fn(ctx.user)) throw new HttpError(403, msg); };
const requireMarketing = guard(canMarketing, 'Нет доступа к маркетингу');
const requireSmm = guard(canSmm, 'Нет доступа к разделу SMM');
module.exports = { SESSION_DAYS, hashPassword, verifyPassword, createSession, userFromToken, checkRate, can, requireRole, isAdminUser, canMarketing, canSmm, requireMarketing, requireSmm };
