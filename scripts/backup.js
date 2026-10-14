'use strict';
// Резервная копия базы. Запускается ежедневно через cron (см. install.sh).
// Хранит последние 30 копий в data/backups.
const path = require('node:path');
const fs = require('node:fs');
const { db, DATA_DIR } = require('../lib/db');

const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const d = new Date(); const p = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
const file = path.join(dir, `crm-${stamp}.sqlite`);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
console.log('Backup:', file);

const keep = +process.env.BACKUP_KEEP || 30;
const files = fs.readdirSync(dir).filter((f) => f.startsWith('crm-')).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
