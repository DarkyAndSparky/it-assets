/**
 * server/lib/xlsx-writer.js
 *
 * PROD-6: минимальный писатель .xlsx (один лист, заголовки + строки),
 * без сторонних xlsx-библиотек.
 *
 * Почему не npm-пакет: на момент реализации есть ровно два кандидата в
 * npm-реестре — `xlsx` (SheetJS) и `exceljs`. `xlsx@0.18.5` (последняя
 * версия, реально опубликованная в npm) несёт high-severity Prototype
 * Pollution + ReDoS БЕЗ доступного фикса через npm (SheetJS чинит их
 * только в билдах на собственном CDN, не в npm-реестре — известный,
 * годами не решённый спор). `exceljs` тянет ~90 транзитивных пакетов,
 * включая `jimp`/`file-type`/`browserslist`/`js-yaml` (обработка
 * изображений — нам не нужна, мы пишем только текст/числа) — и часть из
 * них тоже с открытыми уязвимостями. Проекту (см. SEC-1..13, философию
 * «не тащить лишнее» по всему коду) это не подходит.
 *
 * `.xlsx` — это ZIP с XML внутри (OOXML SpreadsheetML), `adm-zip` уже
 * есть в зависимостях (используется для бэкапов) — собираем архив
 * вручную. Формат достаточно простой для одного листа без форматирования
 * чисел/формул: заголовки/шапка + плоская таблица значений.
 *
 * Строки — только `inlineStr` (тип ячейки задан явно в XML), НЕ
 * `sharedStrings.xml` — проще (не нужен отдельный индекс строк), и ровно
 * по этой причине (явный тип ячейки, не эвристика по ведущему символу,
 * как в CSV) Excel/LibreOffice НЕ трактуют содержимое как формулу, даже
 * если оно начинается с `=`/`+`/`-`/`@`. Тем не менее применяем тот же
 * apostrophe-prefix, что и `csvCell()` в csv.repo.js (SEC-11) — cheap
 * defense-in-depth на случай стороннего ридера/конвертера, который всё
 * же гадает по первому символу (например при импорте в Google Таблицы
 * через «открыть как» с автоопределением).
 */
'use strict';

const AdmZip = require('adm-zip');

function xmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    // XML 1.0 запрещает большинство control-символов (кроме \t\n\r) —
    // reject тихо портит файл ("не читается / повреждён") без этой чистки.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// См. комментарий вверху файла / SEC-11 в csv.repo.js — та же логика.
function safeText(v) {
  const s = String(v ?? '');
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// Индекс колонки (0-based) → буквенный адрес (A, B, ... Z, AA, AB, ...).
function colLetter(idx) {
  let n = idx + 1, s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function buildSheetXml(headers, rows) {
  const rowsXml = [];

  // Строка 1 — заголовки, стиль s="1" (жирный, см. styles.xml).
  const headerCells = headers.map((h, i) =>
    `<c r="${colLetter(i)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(h)}</t></is></c>`
  ).join('');
  rowsXml.push(`<row r="1">${headerCells}</row>`);

  rows.forEach((row, rIdx) => {
    const r = rIdx + 2; // с учётом строки заголовков
    const cells = row.map((v, cIdx) => {
      const addr = colLetter(cIdx) + r;
      if (isFiniteNumber(v)) return `<c r="${addr}"><v>${v}</v></c>`;
      const text = safeText(v);
      if (text === '') return ''; // пустые ячейки не пишем — меньше XML, тот же визуальный результат
      return `<c r="${addr}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
    }).join('');
    rowsXml.push(`<row r="${r}">${cells}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rowsXml.join('')}</sheetData>
</worksheet>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

// Минимальный набор стилей: s="0" дефолт, s="1" — жирная шапка.
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * @param {string[]} headers — заголовки колонок (строка 1, жирным)
 * @param {Array<Array<string|number>>} rows — данные; числа пишутся как
 *   числовые ячейки, всё остальное — как текст (inlineStr)
 * @param {string} [sheetName] — имя листа, максимум 31 символ (лимит Excel)
 * @returns {Buffer} — готовый .xlsx
 */
function buildXlsx(headers, rows, sheetName) {
  const name = (sheetName || 'Отчёт').slice(0, 31);
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES_XML, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(ROOT_RELS_XML, 'utf8'));
  zip.addFile('xl/workbook.xml', Buffer.from(workbookXml(name), 'utf8'));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(WORKBOOK_RELS_XML, 'utf8'));
  zip.addFile('xl/styles.xml', Buffer.from(STYLES_XML, 'utf8'));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(buildSheetXml(headers, rows), 'utf8'));
  return zip.toBuffer();
}

module.exports = { buildXlsx };
