'use strict';
// Публикации: пост с фото/видео одним нажатием в MAX (чат для контента), Telegram-канал, группу ВКонтакте
// и раздел «Наши работы» на сайте. Без фото или видео пост не публикуется. Текст предлагается по заказ-наряду.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, all, get, run, getSetting, setSetting, DATA_DIR } = require('./db');
const { HttpError } = require('./http');

const DIR = path.join(DATA_DIR, 'pubs');
const MAX_FILE = 50 * 1024 * 1024; // лимит Telegram на загрузку видео ботом
const CHANNELS = ['max', 'tg', 'vk', 'site'];
const CH_NAME = { max: 'MAX', tg: 'Telegram', vk: 'ВКонтакте', site: 'Сайт' };

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS pubs (id INTEGER PRIMARY KEY, order_id INTEGER, title TEXT, text TEXT, status TEXT DEFAULT 'draft',
    results TEXT, site_visible INTEGER DEFAULT 0, user_id INTEGER, created_at TEXT DEFAULT (datetime('now','localtime')), published_at TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS pub_media (id INTEGER PRIMARY KEY, pub_id INTEGER NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL, mime TEXT,
    size INTEGER, sort INTEGER DEFAULT 0, src_photo_id INTEGER)`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_pub_media ON pub_media(pub_id, sort)');
}

const r2 = (s) => String(s || '').trim();
const media = (pid) => all('SELECT * FROM pub_media WHERE pub_id=? ORDER BY sort, id', pid);
const fileOf = (m) => path.join(DIR, String(m.pub_id), m.file);
const results = (p) => { try { return JSON.parse(p.results || '{}'); } catch { return {}; } };
function full(p) { return { ...p, results: results(p), media: media(p.id).map((m) => ({ id: m.id, kind: m.kind, mime: m.mime, size: m.size })) }; }

// ---------- текст по заказ-наряду ----------
const CATS = [
  ['alarm', /сигнализ|автозапуск|starline|старлайн|pandora|пандора|pandect|иммобилайз|метк/i, '🔐', 'надёжная защита и тёплая машина каждое утро', 'Установили сигнализацию с автозапуском', '#автозапуск #сигнализация'],
  ['sound', /акусти|динамик|сабвуф|усилит|процессор|dsp|твитер|мидбас|подиум|короб|аудио|audio|focal|helix|morel|hertz|audison|brax|match|jl/i, '🔊', 'чистый, детальный звук', 'Собрали аудиосистему', '#автозвук #caraudio'],
  ['noise', /шумо|вибро|изоляц|stp|aero|шумка/i, '🤫', 'тишина в салоне даже на шипах', 'Сделали шумоизоляцию', '#шумоизоляция'],
  ['media', /магнитол|андроид|android|teyes|мультимед|carplay|камер|регистратор|экран|монитор/i, '📱', 'современная мультимедиа и удобство в каждой поездке', 'Установили мультимедиа', '#магнитола #мультимедиа'],
  ['print', /3d|печат|подиум.*печат/i, '🛠', 'детали, сделанные точно под машину', 'Напечатали и установили детали', '#3dпечать'],
];
function suggest(orderId) {
  const o = get(`SELECT o.*, ca.brand, ca.model, ca.year FROM orders o LEFT JOIN cars ca ON ca.id=o.car_id WHERE o.id=?`, orderId);
  if (!o) throw new HttpError(404, 'Заказ не найден');
  const items = all('SELECT kind, name, qty FROM order_items WHERE order_id=? ORDER BY kind DESC, price*qty DESC', orderId);
  const clean = (n) => String(n).split(',')[0].replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const works = [...new Set(items.filter((i) => i.kind === 'service').map((i) => clean(i.name)))];
  const goods = [...new Set(items.filter((i) => i.kind === 'product').map((i) => clean(i.name)))];
  const car = [o.brand, o.model].filter(Boolean).join(' ') + (o.year ? ` ${o.year}` : '');
  const carS = car.trim() || 'Автомобиль клиента';
  const allText = items.map((i) => i.name).join(' ') + ' ' + (o.complaint || '');
  const cats = CATS.filter(([, re]) => re.test(allText));
  const c = cats[0] || ['other', /./, '🔧', 'аккуратная работа и гарантия', 'Выполнили работы', ''];
  const benefit = cats.length > 1 ? cats.map((x) => x[3]).slice(0, 2).join(' и ') : c[3];
  const brandTags = [...new Set(goods.map((g) => (g.match(/^[A-Za-z][A-Za-z0-9-]+/) || [])[0]).filter(Boolean).map((b) => '#' + b.toLowerCase().replace(/-/g, '')))].slice(0, 3);
  const tags = ['#Бумсистем', '#Ангарск', ...cats.map((x) => x[5]).join(' ').split(' ').filter(Boolean), ...brandTags].filter((v, i, a) => v && a.indexOf(v) === i).join(' ');
  const phone = getSetting('company_phone') || '';
  const list = (arr) => arr.map((x) => '• ' + x).join('\n');
  const contact = `📍 ${getSetting('company_name') || 'Бумсистем'}, Ангарск${phone ? `\n📞 Запись: ${phone}` : ''}`;
  const v1 = [`${c[0] === 'other' ? '🔧' : c[2]} ${carS} — ${c[4].toLowerCase()}`, '',
    works.length ? 'Что сделали:\n' + list(works) : '', goods.length ? '\nОборудование:\n' + list(goods) : '', '',
    `Результат — ${benefit}. Всё аккуратно, по-заводскому, с гарантией.`, '', contact, '', tags].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();
  const v2 = [`${c[2]} ${carS}: ${[...works.slice(0, 3)].join(', ').toLowerCase() || c[4].toLowerCase()}.`,
    goods.length ? `Ставили: ${goods.slice(0, 3).join(', ')}.` : '', `Владелец получил ${benefit}.`, '', contact, tags].filter(Boolean).join('\n').trim();
  const v3 = [`Как получить ${benefit}? Показываем на примере ${carS} 👇`, '',
    works.length ? list(works) : '', goods.length ? list(goods) : '', '',
    'Хотите так же? Напишите нам — подберём решение под вашу машину и назовём цену.', '', contact, '', tags].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();
  const tidy = (t) => t.replace(/\n{3,}/g, '\n\n').trim();
  return { title: `${carS} — ${c[4].toLowerCase()}`, variants: [v1, v2, v3].map(tidy), works, goods, car: carS };
}

// ---------- каналы ----------
// MAX
async function postMax(p, list, text) {
  const max = require('./max');
  const chat = getSetting('max_content_chat_id');
  if (!chat) return { ok: false, error: 'Не выбран чат для публикаций (Настройки → MAX)' };
  const att = [];
  for (const m of list.slice(0, 10)) {
    const up = await max.uploadFile(fs.readFileSync(fileOf(m)), m.file, m.kind === 'video' ? 'video' : 'image', m.mime);
    if (!up.ok) return { ok: false, error: 'Загрузка в MAX: ' + up.error };
    att.push(up.attachment);
  }
  const r = await max.sendMedia({ chat_id: +chat }, text, att);
  return r && r.ok ? { ok: true } : { ok: false, error: (r && r.error) || 'MAX не принял пост' };
}

// Telegram: канал (бот — администратор канала)
async function tgForm(method, form) {
  const token = getSetting('tg_token'); if (!token) return { ok: false, description: 'Не указан токен Telegram-бота (Настройки → Telegram)' };
  try {
    const res = await fetch(`${process.env.TG_API_BASE || 'https://api.telegram.org'}/bot${token}/${method}`, { method: 'POST', body: form, signal: AbortSignal.timeout(180000) });
    return await res.json();
  } catch (e) { return { ok: false, description: String(e.cause?.code || e.message) }; }
}
async function postTg(p, list, text) {
  const chat = getSetting('tg_post_chat');
  if (!chat) return { ok: false, error: 'Не указан Telegram-канал (Маркетинг → Публикации → Подключения)' };
  const items = list.slice(0, 10);
  const capOk = text.length <= 1024;
  const blob = (m) => new Blob([fs.readFileSync(fileOf(m))], { type: m.mime || (m.kind === 'video' ? 'video/mp4' : 'image/jpeg') });
  let r;
  if (items.length === 1) {
    const m = items[0]; const f = new FormData();
    f.append('chat_id', chat); if (capOk) f.append('caption', text);
    f.append(m.kind === 'video' ? 'video' : 'photo', blob(m), m.file);
    r = await tgForm(m.kind === 'video' ? 'sendVideo' : 'sendPhoto', f);
  } else {
    const f = new FormData(); f.append('chat_id', chat);
    f.append('media', JSON.stringify(items.map((m, i) => ({ type: m.kind === 'video' ? 'video' : 'photo', media: `attach://f${i}`, ...(i === 0 && capOk ? { caption: text } : {}) }))));
    items.forEach((m, i) => f.append(`f${i}`, blob(m), m.file));
    r = await tgForm('sendMediaGroup', f);
  }
  if (!r || !r.ok) return { ok: false, error: 'Telegram: ' + ((r && r.description) || 'ошибка') };
  if (!capOk) {
    const f = new FormData(); f.append('chat_id', chat); f.append('text', text.slice(0, 4096));
    const t = await tgForm('sendMessage', f); if (!t || !t.ok) return { ok: false, error: 'Telegram (текст): ' + ((t && t.description) || 'ошибка') };
  }
  const ch = String(chat).startsWith('@') ? chat.slice(1) : null;
  const mid = Array.isArray(r.result) ? r.result[0]?.message_id : r.result?.message_id;
  return { ok: true, url: ch && mid ? `https://t.me/${ch}/${mid}` : '' };
}

// ВКонтакте: стена сообщества. Нужен ключ с правами wall, photos, video (ключ пользователя-администратора группы)
const VKV = '5.199';
async function vk(method, params) {
  const token = getSetting('vk_token'); if (!token) throw new Error('Не указан ключ доступа ВКонтакте');
  const body = new URLSearchParams({ ...params, access_token: token, v: VKV });
  const res = await fetch((process.env.VK_API_BASE || 'https://api.vk.com') + '/method/' + method, { method: 'POST', body, signal: AbortSignal.timeout(60000) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.error_msg} (${j.error.error_code})`);
  return j.response;
}
async function postVk(p, list, text) {
  const gid = String(getSetting('vk_group_id') || '').replace(/\D/g, '');
  if (!gid || !getSetting('vk_token')) return { ok: false, error: 'ВКонтакте не подключён (ключ и ID группы)' };
  try {
    const att = [];
    for (const m of list.slice(0, 10)) {
      const buf = fs.readFileSync(fileOf(m));
      if (m.kind === 'video') {
        const s = await vk('video.save', { group_id: gid, name: (p.title || 'Наша работа').slice(0, 100), wallpost: 0 });
        const f = new FormData(); f.append('video_file', new Blob([buf], { type: m.mime || 'video/mp4' }), m.file);
        const up = await fetch(s.upload_url, { method: 'POST', body: f, signal: AbortSignal.timeout(300000) }); await up.text();
        att.push(`video${s.owner_id}_${s.video_id}`);
      } else {
        const s = await vk('photos.getWallUploadServer', { group_id: gid });
        const f = new FormData(); f.append('photo', new Blob([buf], { type: m.mime || 'image/jpeg' }), m.file);
        const up = await (await fetch(s.upload_url, { method: 'POST', body: f, signal: AbortSignal.timeout(120000) })).json();
        if (!up.photo || up.photo === '[]') throw new Error('ВК не принял фото');
        const saved = await vk('photos.saveWallPhoto', { group_id: gid, server: up.server, photo: up.photo, hash: up.hash });
        att.push(`photo${saved[0].owner_id}_${saved[0].id}`);
      }
    }
    const r = await vk('wall.post', { owner_id: '-' + gid, from_group: 1, message: text, attachments: att.join(',') });
    return { ok: true, url: `https://vk.com/wall-${gid}_${r.post_id}` };
  } catch (e) { return { ok: false, error: 'ВКонтакте: ' + e.message }; }
}

async function publish(p, channels) {
  const list = media(p.id);
  if (!list.length) throw new HttpError(400, 'Добавьте хотя бы одно фото или видео — без них пост не публикуется');
  const text = r2(p.text); if (!text) throw new HttpError(400, 'Напишите текст поста');
  const res = results(p);
  for (const ch of channels.filter((c) => CHANNELS.includes(c))) {
    let r;
    try {
      if (ch === 'max') r = await postMax(p, list, text);
      else if (ch === 'tg') r = await postTg(p, list, text);
      else if (ch === 'vk') r = await postVk(p, list, text);
      else if (ch === 'site') { run('UPDATE pubs SET site_visible=1 WHERE id=?', p.id); r = { ok: true }; }
    } catch (e) { r = { ok: false, error: e.message }; }
    res[ch] = { ...r, at: new Date().toISOString() };
  }
  const vals = Object.values(res); const okAll = vals.length && vals.every((x) => x.ok);
  run("UPDATE pubs SET results=?, status=?, published_at=COALESCE(published_at, datetime('now','localtime')) WHERE id=?",
    JSON.stringify(res), okAll ? 'published' : vals.some((x) => x.ok) ? 'partial' : 'error', p.id);
  return res;
}

// приём файла потоком (без base64): фото до 15 МБ, видео до 50 МБ
function receive(ctx, pid) {
  const mime = String(ctx.req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const kind = /^video\//.test(mime) ? 'video' : /^image\/(jpeg|png|webp)$/.test(mime) ? 'photo' : null;
  if (!kind) throw new HttpError(400, 'Можно загрузить фото (JPG, PNG, WebP) или видео (MP4, MOV)');
  const limit = kind === 'video' ? MAX_FILE : 15 * 1024 * 1024;
  const ext = kind === 'video' ? (mime.includes('quicktime') ? '.mov' : '.mp4') : mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
  const dir = path.join(DIR, String(pid)); fs.mkdirSync(dir, { recursive: true });
  const file = Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + ext;
  const fp = path.join(dir, file);
  return new Promise((resolve, reject) => {
    let size = 0; const out = fs.createWriteStream(fp);
    ctx.req.on('data', (c) => { size += c.length; if (size > limit) { ctx.req.destroy(); out.destroy(); try { fs.unlinkSync(fp); } catch {} reject(new HttpError(413, kind === 'video' ? 'Видео больше 50 МБ — сожмите его или обрежьте' : 'Фото больше 15 МБ')); } });
    ctx.req.pipe(out);
    out.on('finish', () => {
      if (size < 200) { try { fs.unlinkSync(fp); } catch {} return reject(new HttpError(400, 'Пустой файл')); }
      const sort = (get('SELECT MAX(sort) s FROM pub_media WHERE pub_id=?', pid).s || 0) + 1;
      const id = Number(run('INSERT INTO pub_media(pub_id,kind,file,mime,size,sort) VALUES(?,?,?,?,?,?)', pid, kind, file, mime, size, sort).lastInsertRowid);
      resolve({ id, kind });
    });
    out.on('error', reject); ctx.req.on('error', reject);
  });
}

function removePub(id) {
  try { fs.rmSync(path.join(DIR, String(id)), { recursive: true, force: true }); } catch {}
  run('DELETE FROM pub_media WHERE pub_id=?', id); run('DELETE FROM pubs WHERE id=?', id);
}

function register(r, ADMIN, { photoPath, MK }) {
  const need = (id) => { const p = get('SELECT * FROM pubs WHERE id=?', +id); if (!p) throw new HttpError(404, 'Публикация не найдена'); return p; };
  // подключения
  r.get('/api/pubs/settings', ADMIN, () => ({
    tg_post_chat: getSetting('tg_post_chat') || '', tg_bot: !!getSetting('tg_token'),
    vk_group_id: getSetting('vk_group_id') || '', vk_token: !!getSetting('vk_token'),
    max_content: !!getSetting('max_content_chat_id'), max_bot: !!getSetting('max_token'),
    ai: require('./ai').provider(), ai_provider: getSetting('ai_provider') || '', gigachat_key: !!getSetting('gigachat_key'), gigachat_scope: getSetting('gigachat_scope') || 'GIGACHAT_API_PERS',
    yandex_key: !!getSetting('yandex_key'), yandex_folder: getSetting('yandex_folder') || '', yandex_model: getSetting('yandex_model') || 'yandexgpt/latest',
  }));
  r.put('/api/pubs/settings', MK, (ctx) => {
    const b = ctx.body;
    if (b.tg_post_chat !== undefined) setSetting('tg_post_chat', r2(b.tg_post_chat).replace(/^https?:\/\/t\.me\//, '@').replace(/^@?([A-Za-z]\w{3,})$/, '@$1'));
    if (b.vk_group_id !== undefined) setSetting('vk_group_id', r2(b.vk_group_id).replace(/^https?:\/\/vk\.(com|ru)\/(club|public)?/, ''));
    if (b.vk_token) setSetting('vk_token', r2(b.vk_token));
    if (b.vk_token_clear) setSetting('vk_token', '');
    if (b.ai_provider !== undefined) setSetting('ai_provider', ['gigachat', 'yandex'].includes(b.ai_provider) ? b.ai_provider : '');
    if (b.gigachat_key) setSetting('gigachat_key', r2(b.gigachat_key));
    if (b.gigachat_scope) setSetting('gigachat_scope', ['GIGACHAT_API_PERS', 'GIGACHAT_API_B2B', 'GIGACHAT_API_CORP'].includes(b.gigachat_scope) ? b.gigachat_scope : 'GIGACHAT_API_PERS');
    if (b.yandex_key) setSetting('yandex_key', r2(b.yandex_key));
    if (b.yandex_folder !== undefined) setSetting('yandex_folder', r2(b.yandex_folder));
    if (b.yandex_model !== undefined) setSetting('yandex_model', r2(b.yandex_model) || 'yandexgpt/latest');
    return { ok: true };
  });
  // ИИ: текст поста по заказ-наряду или улучшение своего текста
  r.post('/api/pubs/ai', ADMIN, async (ctx) => {
    const b = ctx.body || {}; let facts = '', title = '';
    if (b.order_id) {
      const s = suggest(+b.order_id); title = s.title;
      facts = [`Автомобиль: ${s.car}`, s.works.length ? `Работы: ${s.works.join('; ')}` : '', s.goods.length ? `Установленное оборудование: ${s.goods.join('; ')}` : ''].filter(Boolean).join('\n');
    }
    if (!facts && !r2(b.current)) throw new HttpError(400, 'Выберите заказ-наряд или напишите черновик текста — ИИ нужны факты');
    const text = await require('./ai').postText({ facts, style: b.style, wish: r2(b.wish).slice(0, 300), current: b.mode === 'improve' ? r2(b.current).slice(0, 3000) : '' });
    return { text, title };
  });
  r.post('/api/pubs/ai-test', MK, async () => ({ text: await require('./ai').complete('Отвечай одним коротким предложением.', 'Скажи «Готов писать посты для Бумсистем!»') }));
  r.get('/api/pubs', ADMIN, () => all('SELECT * FROM pubs ORDER BY id DESC LIMIT 60').map(full));
  r.get('/api/pubs/orders', ADMIN, () => all(`SELECT o.id, o.status, COALESCE(o.issued_at,o.done_at,o.scheduled_at,o.created_at) date, ca.brand, ca.model, ca.year,
      (SELECT GROUP_CONCAT(name, ', ') FROM (SELECT name FROM order_items WHERE order_id=o.id ORDER BY kind DESC, price*qty DESC LIMIT 3)) items,
      (SELECT COUNT(*) FROM order_photos WHERE order_id=o.id) photos, (SELECT COUNT(*) FROM pubs WHERE order_id=o.id AND status<>'draft') used
    FROM orders o LEFT JOIN cars ca ON ca.id=o.car_id WHERE o.status IN ('done','issued','in_work') AND EXISTS (SELECT 1 FROM order_items WHERE order_id=o.id)
    ORDER BY COALESCE(o.issued_at,o.done_at,o.created_at) DESC LIMIT 60`));
  r.get('/api/pubs/suggest', ADMIN, (ctx) => ({ ...suggest(+ctx.query.order_id),
    photos: all('SELECT id, created_at FROM order_photos WHERE order_id=? ORDER BY id', +ctx.query.order_id) }));
  r.post('/api/pubs', ADMIN, (ctx) => ({ id: Number(run('INSERT INTO pubs(order_id,title,text,user_id) VALUES(?,?,?,?)', ctx.body.order_id ? +ctx.body.order_id : null, r2(ctx.body.title) || null, r2(ctx.body.text) || null, ctx.user.id).lastInsertRowid) }));
  r.put('/api/pubs/:id', ADMIN, (ctx) => {
    const p = need(ctx.params.id); const b = ctx.body;
    run('UPDATE pubs SET order_id=?, title=?, text=? WHERE id=?', b.order_id !== undefined ? (b.order_id ? +b.order_id : null) : p.order_id,
      b.title !== undefined ? r2(b.title) || null : p.title, b.text !== undefined ? r2(b.text) || null : p.text, p.id);
    if (b.site_visible !== undefined) run('UPDATE pubs SET site_visible=? WHERE id=?', b.site_visible ? 1 : 0, p.id);
    return { ok: true };
  });
  r.delete('/api/pubs/:id', ADMIN, (ctx) => { removePub(+ctx.params.id); return { ok: true }; });
  r.post('/api/pubs/:id/media', ADMIN, async (ctx) => receive(ctx, need(ctx.params.id).id));
  r.post('/api/pubs/:id/media/from-order', ADMIN, (ctx) => {
    const p = need(ctx.params.id); const ids = (ctx.body.photo_ids || []).map(Number).filter(Boolean); let n = 0;
    for (const id of ids) {
      if (get('SELECT 1 FROM pub_media WHERE pub_id=? AND src_photo_id=?', p.id, id)) continue;
      const ph = get('SELECT * FROM order_photos WHERE id=?', id); if (!ph) continue;
      let buf; try { buf = fs.readFileSync(photoPath(ph)); } catch { continue; }
      const dir = path.join(DIR, String(p.id)); fs.mkdirSync(dir, { recursive: true });
      const ext = ph.file.endsWith('.png') ? '.png' : ph.file.endsWith('.webp') ? '.webp' : '.jpg';
      const file = 'o' + id + '-' + crypto.randomBytes(3).toString('hex') + ext; fs.writeFileSync(path.join(dir, file), buf);
      const sort = (get('SELECT MAX(sort) s FROM pub_media WHERE pub_id=?', p.id).s || 0) + 1;
      run('INSERT INTO pub_media(pub_id,kind,file,mime,size,sort,src_photo_id) VALUES(?,?,?,?,?,?,?)', p.id, 'photo', file, ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', buf.length, sort, id); n++;
    }
    return { added: n };
  });
  r.delete('/api/pubs/:id/media/:mid', ADMIN, (ctx) => {
    const m = get('SELECT * FROM pub_media WHERE id=? AND pub_id=?', +ctx.params.mid, +ctx.params.id); if (!m) return { ok: true };
    try { fs.unlinkSync(fileOf(m)); } catch {} run('DELETE FROM pub_media WHERE id=?', m.id); return { ok: true };
  });
  r.post('/api/pubs/:id/media/:mid/first', ADMIN, (ctx) => { run('UPDATE pub_media SET sort=-1 WHERE id=? AND pub_id=?', +ctx.params.mid, +ctx.params.id); return { ok: true }; });
  r.get('/api/pubs/:id/media/:mid', ADMIN, (ctx) => {
    const m = get('SELECT * FROM pub_media WHERE id=? AND pub_id=?', +ctx.params.mid, +ctx.params.id); if (!m) throw new HttpError(404, 'Нет файла');
    return sendFile(ctx.req, ctx.res, m, 'private');
  });
  r.post('/api/pubs/:id/publish', ADMIN, async (ctx) => {
    const p = need(ctx.params.id); const b = ctx.body || {};
    if (b.text !== undefined || b.title !== undefined) run('UPDATE pubs SET title=COALESCE(?,title), text=COALESCE(?,text) WHERE id=?', b.title !== undefined ? r2(b.title) || null : null, b.text !== undefined ? r2(b.text) || null : null, p.id);
    const chs = (b.channels || []).filter((c) => CHANNELS.includes(c)); if (!chs.length) throw new HttpError(400, 'Отметьте, куда публиковать');
    return { results: await publish(get('SELECT * FROM pubs WHERE id=?', p.id), chs) };
  });
  r.post('/api/pubs/test/:ch', MK, async (ctx) => {
    const ch = ctx.params.ch;
    if (ch === 'tg') {
      const chat = getSetting('tg_post_chat'); if (!chat) throw new HttpError(400, 'Укажите канал');
      const f = new FormData(); f.append('chat_id', chat); const j = await tgForm('getChat', f);
      if (!j || !j.ok) throw new HttpError(400, 'Telegram: ' + ((j && j.description) || 'нет связи') + '. Добавьте бота администратором канала.');
      return { ok: true, name: j.result.title };
    }
    if (ch === 'vk') {
      const gid = String(getSetting('vk_group_id') || '').replace(/\D/g, '') || getSetting('vk_group_id');
      try { const g = await vk('groups.getById', { group_id: gid }); const grp = Array.isArray(g) ? g[0] : g?.groups?.[0]; await vk('photos.getWallUploadServer', { group_id: String(grp?.id || gid) });
        if (grp?.id) setSetting('vk_group_id', String(grp.id)); return { ok: true, name: grp?.name || '' }; }
      catch (e) { throw new HttpError(400, e.message); }
    }
    throw new HttpError(400, 'Неизвестный канал');
  });
}

// отдача файла (с поддержкой Range для видео)
function sendFile(req, res, m, cache) {
  let st; try { st = fs.statSync(fileOf(m)); } catch { throw new HttpError(404, 'Файл не найден'); }
  const type = m.mime || (m.kind === 'video' ? 'video/mp4' : 'image/jpeg');
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range && m.kind === 'video') {
    const start = range[1] ? +range[1] : 0; const end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Cache-Control': cache + ', max-age=86400' });
    fs.createReadStream(fileOf(m), { start, end }).pipe(res); return undefined;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': cache + ', max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(fileOf(m)).pipe(res); return undefined;
}
// публичная отдача для сайта: /works-media/<id>.<ext> — только у опубликованных на сайте работ
function serve(req, res, pathname) {
  const mm = /^\/works-media\/(\d+)\.\w+$/.exec(pathname); if (!mm) return false;
  const m = get('SELECT pm.* FROM pub_media pm JOIN pubs p ON p.id=pm.pub_id WHERE pm.id=? AND p.site_visible=1', +mm[1]);
  if (!m) { res.writeHead(404); res.end(); return true; }
  try { sendFile(req, res, m, 'public'); } catch { res.writeHead(404); res.end(); }
  return true;
}
// для сайта
function siteWorks(limit = 9) {
  return all('SELECT * FROM pubs WHERE site_visible=1 ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?', limit)
    .map((p) => ({ id: p.id, title: p.title, text: p.text, media: media(p.id).map((m) => ({ id: m.id, kind: m.kind, url: `/works-media/${m.id}${path.extname(m.file)}` })) }))
    .filter((p) => p.media.length);
}

module.exports = { migrate, register, serve, siteWorks, suggest, CH_NAME };
