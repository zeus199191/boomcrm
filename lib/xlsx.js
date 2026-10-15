'use strict';
// Минимальное чтение .xlsx без внешних библиотек: zip (stored/deflate) + первый лист.
// Возвращает массив строк: { r, level, cells: { A: 'значение', B: ... } }
const zlib = require('node:zlib');

function unzip(buf) {
  // ищем End Of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Файл не похож на .xlsx');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files[name] = () => {
      const lNameLen = buf.readUInt16LE(local + 26), lExtra = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtra;
      const data = buf.subarray(start, start + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    };
    p += 46 + nameLen + extraLen + commLen;
  }
  return files;
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');

function readSheet(buf) {
  const files = unzip(buf);
  const shared = [];
  if (files['xl/sharedStrings.xml']) {
    const xml = files['xl/sharedStrings.xml']().toString('utf8');
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(decode((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, '')).join('')));
    }
  }
  const sheetName = Object.keys(files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort()[0];
  if (!sheetName) throw new Error('В файле нет листов');
  const xml = files[sheetName]().toString('utf8');
  const rows = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g; let m;
  while ((m = rowRe.exec(xml))) {
    const attrs = m[1];
    const r = +((attrs.match(/\br="(\d+)"/) || [])[1] || 0);
    const level = +((attrs.match(/outlineLevel="(\d+)"/) || [])[1] || 0);
    const cells = {};
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let c;
    while ((c = cRe.exec(m[2]))) {
      const ref = (c[1].match(/\br="([A-Z]+)\d+"/) || [])[1];
      const t = (c[1].match(/\bt="(\w+)"/) || [])[1];
      const inner = c[2] || '';
      let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      if (t === 's' && v !== undefined) v = shared[+v];
      else if (t === 'inlineStr') v = decode((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || '');
      else if (v !== undefined) v = decode(v);
      if (ref && v !== undefined && String(v).trim() !== '') cells[ref] = String(v).trim();
    }
    rows.push({ r, level, cells });
  }
  return rows;
}

// Прайс дилера (формат «Спарта Маркет»): группы по уровням группировки строк,
// колонки: A код, B название, C VIP дилер, D дилер, E розница, F единицы.
function parseDealerPrice(buf) {
  const rows = readSheet(buf);
  const stack = [];
  const items = [];
  let headerFound = false;
  for (const row of rows) {
    const { A, B, C, D, E, F } = row.cells;
    if (!headerFound) { if (B && /номенклатура/i.test(B)) headerFound = true; continue; }
    if (!B) continue;
    if (!A) { // строка группы
      const lvl = Math.max(row.level, 1);
      stack[lvl] = B; stack.length = lvl + 1;
      continue;
    }
    const groups = stack.slice(1).filter(Boolean);
    items.push({
      sku: A, name: B,
      cost: +String(C || '').replace(',', '.') || 0,
      dealer: +String(D || '').replace(',', '.') || 0,
      price: +String(E || '').replace(',', '.') || 0,
      unit: F && F.length < 12 ? F : 'шт',
      group: groups[0] || 'Без группы', sub: groups[1] || '', brand: groups[2] || '',
    });
  }
  if (!headerFound) throw new Error('Не найден заголовок прайса (столбец «Номенклатура»)');
  return items;
}

module.exports = { readSheet, parseDealerPrice };
