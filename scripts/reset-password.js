'use strict';
// Сброс пароля: node scripts/reset-password.js admin НовыйПароль
const { get, run } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

const [login, pw] = process.argv.slice(2);
if (!login || !pw || pw.length < 6) {
  console.log('Использование: node scripts/reset-password.js <логин> <новый пароль (от 6 символов)>');
  process.exit(1);
}
const u = get('SELECT id FROM users WHERE login=?', login.toLowerCase());
if (!u) { console.log('Пользователь не найден'); process.exit(1); }
run('UPDATE users SET pass_hash=?, active=1 WHERE id=?', hashPassword(pw), u.id);
run('DELETE FROM sessions WHERE user_id=?', u.id);
console.log('Пароль обновлён для', login);
