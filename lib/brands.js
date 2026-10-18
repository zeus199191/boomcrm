'use strict';
// Бренды на странице «Автозвук»: логотипы хранятся на нашем сервере (папка данных /brands).
// Часть логотипов сервер один раз скачивает сам с официальных сайтов; любой можно загрузить/заменить в CRM (Настройки → «Логотипы брендов»).
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, getSetting, setSetting } = require('./db');
const { HttpError } = require('./http');

const DIR = path.join(DATA_DIR, 'brands');
const AUTO = path.join(DIR, 'auto'); // скачанные автоматически — самый низкий приоритет
const BUNDLED = path.join(__dirname, '..', 'public', 'img', 'brands'); // логотипы, присланные ателье (идут с обновлением)
const BRANDS = [
  { slug: 'brax', name: 'Brax', country: 'Германия', main: 1 },
  { slug: 'helix', name: 'Helix', country: 'Германия', main: 1 },
  { slug: 'match', name: 'Match', country: 'Германия', main: 1 },
  { slug: 'audison', name: 'Audison', country: 'Италия', main: 1, src: 'https://static.audison.com/media/2022/10/audison_logo.svg' },
  { slug: 'hertz', name: 'Hertz', country: 'Италия', main: 1, src: 'https://static.hertz-audio.com/media/2021/04/hertz_logo.svg' },
  { slug: 'focal', name: 'Focal', country: 'Франция', main: 1 },
  { slug: 'morel', name: 'Morel', country: 'Израиль', main: 1 },
  { slug: 'jlaudio', name: 'JL Audio', country: 'США', main: 1 },
  { slug: 'recoil', name: 'Recoil Audio', country: 'США', main: 1, src: 'https://cdn.brandfetch.io/idWmjt9h4p/w/1008/h/230/theme/light/logo.png?c=1bxid64Mup7aczewSAYMX&t=1790951830279' },
  { slug: 'hellion', name: 'Hellion' },
  { slug: 'madbit', name: 'Madbit' },
  { slug: 'kontur', name: 'Контур-Аудио' },
  { slug: 'resolut', name: 'Resolut' },
  { slug: 'goldhorn', name: 'GoldHorn' },
  { slug: 'aura', name: 'Aura' },
  { slug: 'dlaudio', name: 'DL Audio' },
  { slug: 'alphard', name: 'Alphard Group' },
  { slug: 'dynamicstate', name: 'Dynamic State' },
];
const EXT = { 'image/svg+xml': 'svg', 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' };
const MIME = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' };

function fileOf(slug) {
  for (const d of [DIR, BUNDLED, AUTO]) for (const e of ['svg', 'png', 'webp', 'jpg']) { const f = path.join(d, `${slug}.${e}`); if (fs.existsSync(f)) return { f, e, bundled: d === BUNDLED }; }
  return null;
}
function save(slug, buf, ext, dir = DIR) {
  fs.mkdirSync(dir, { recursive: true });
  for (const e of ['svg', 'png', 'webp', 'jpg']) { try { fs.unlinkSync(path.join(dir, `${slug}.${e}`)); } catch {} }
  fs.writeFileSync(path.join(dir, `${slug}.${ext}`), buf);
}
function sniff(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  const head = buf.slice(0, 600).toString('utf8');
  if (/<svg[\s>]/i.test(head) || (/^\s*<\?xml/.test(head) && buf.toString('utf8').includes('<svg'))) return 'svg';
  return null;
}
// безопасность SVG: убираем скрипты и обработчики
const cleanSvg = (s) => s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '').replace(/javascript:/gi, '');

// публичный список для страницы сайта
function list() {
  return BRANDS.map((b) => {
    const f = fileOf(b.slug);
    return { ...b, logo: f && getSetting('brand_hide_' + b.slug) !== '1' ? `/brand-logo/${b.slug}.${f.e}?v=${Math.round(fs.statSync(f.f).mtimeMs / 1000)}` : '' };
  });
}

// один раз скачать известные логотипы (повторная попытка — не чаще раза в сутки)
async function autoload() {
  const last = +getSetting('brands_autoload_at') || 0;
  if (Date.now() - last < 864e5) return;
  setSetting('brands_autoload_at', String(Date.now()));
  for (const b of BRANDS) {
    if (!b.src || fileOf(b.slug) || getSetting('brand_noauto_' + b.slug) === '1') continue;
    try {
      const res = await fetch(b.src, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0 BoomsystemCRM' } });
      if (!res.ok) continue;
      let buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 || buf.length > 1024 * 1024) continue;
      const ext = sniff(buf); if (!ext) continue;
      if (ext === 'svg') buf = Buffer.from(cleanSvg(buf.toString('utf8')));
      save(b.slug, buf, ext, AUTO);
    } catch {}
  }
}

function serve(req, res, pathname) {
  const m = /^\/brand-logo\/([a-z0-9-]+)\.(svg|png|webp|jpg)$/.exec(pathname); if (!m) return false;
  const f = fileOf(m[1]); if (!f) { res.writeHead(404); res.end(); return true; }
  const buf = fs.readFileSync(f.f);
  res.writeHead(200, { 'Content-Type': MIME[f.e], 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
  res.end(buf); return true;
}

function register(r, ADMIN) {
  r.get('/api/site/brands', ADMIN, () => list().map((b) => ({ slug: b.slug, name: b.name, country: b.country || '', main: !!b.main, logo: b.logo, has_file: !!b.logo, hidden: getSetting('brand_hide_' + b.slug) === '1' })));
  r.post('/api/site/brands/:slug/logo', ADMIN, (ctx) => {
    const b = BRANDS.find((x) => x.slug === ctx.params.slug); if (!b) throw new HttpError(404, 'Бренд не найден');
    const m = /^data:([\w/+.-]+)?;base64,(.+)$/s.exec(String(ctx.body.data || ''));
    if (!m) throw new HttpError(400, 'Загрузите картинку логотипа');
    let buf = Buffer.from(m[2], 'base64');
    if (buf.length > 2 * 1024 * 1024) throw new HttpError(413, 'Файл больше 2 МБ');
    const ext = sniff(buf); if (!ext) throw new HttpError(400, 'Нужен файл SVG, PNG, WebP или JPG');
    if (ext === 'svg') buf = Buffer.from(cleanSvg(buf.toString('utf8')));
    save(b.slug, buf, ext); setSetting('brand_hide_' + b.slug, '0'); setSetting('brand_uploaded_' + b.slug, '1');
    return { ok: true };
  });
  r.delete('/api/site/brands/:slug/logo', ADMIN, (ctx) => {
    const b = BRANDS.find((x) => x.slug === ctx.params.slug); if (!b) throw new HttpError(404, 'Бренд не найден');
    for (const d of [DIR, AUTO]) for (const e of ['svg', 'png', 'webp', 'jpg']) { try { fs.unlinkSync(path.join(d, `${b.slug}.${e}`)); } catch {} }
    setSetting('brand_uploaded_' + b.slug, '0'); setSetting('brand_noauto_' + b.slug, '1'); // не скачивать снова автоматически
    if (fileOf(b.slug)) setSetting('brand_hide_' + b.slug, '1'); // встроенный логотип — просто скрыть
    return { ok: true };
  });
}

let timer = null;
function migrateAuto() {
  for (const b of BRANDS) {
    if (!b.src || getSetting('brand_uploaded_' + b.slug) === '1') continue;
    for (const e of ['svg', 'png', 'webp', 'jpg']) { const f = path.join(DIR, `${b.slug}.${e}`); if (fs.existsSync(f)) { fs.mkdirSync(AUTO, { recursive: true }); fs.renameSync(f, path.join(AUTO, `${b.slug}.${e}`)); } }
  }
}
function start() { try { migrateAuto(); } catch {} if (timer) return; setTimeout(() => autoload().catch(() => {}), 5000).unref?.(); timer = setInterval(() => autoload().catch(() => {}), 6 * 3600e3); timer.unref?.(); }

module.exports = { BRANDS, list, register, serve, start, autoload };
