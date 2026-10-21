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

// В выгрузках из 1С внутри текста бывают HTML-сущности (&quot; и т.п.) — превращаем их в обычные символы
function fixEntities(s) {
  let prev; s = String(s);
  do { prev = s; s = decode(s); } while (s !== prev && /&[a-z#0-9]+;/i.test(s));
  return s;
}

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
      sku: A, name: fixEntities(B),
      cost: +String(C || '').replace(',', '.') || 0,
      dealer: +String(D || '').replace(',', '.') || 0,
      price: +String(E || '').replace(',', '.') || 0,
      unit: F && F.length < 12 ? F : 'шт',
      group: fixEntities(groups[0] || 'Без группы'), sub: fixEntities(groups[1] || ''), brand: fixEntities(groups[2] || ''),
    });
  }
  if (!headerFound) throw new Error('Не найден заголовок прайса (столбец «Номенклатура»)');
  return items;
}

// ---------- Запись .xlsx (один лист) без внешних библиотек ----------
// rows: массив массивов (строки/числа); первая строка — заголовок (жирным). widths: ширины колонок в символах.
const xesc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8'), comp = zlib.deflateRawSync(data), nm = Buffer.from(name, 'utf8'), crc = zlib.crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, comp); central.push(c, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
function writeSheet(rows, { sheet = 'Лист1', widths = [] } = {}) {
  const sd = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
    if (v === null || v === undefined || v === '') return '';
    return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xesc(sheet).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${sd}</sheetData></worksheet>`,
  });
}

module.exports = { readSheet, parseDealerPrice, fixEntities, writeSheet };
