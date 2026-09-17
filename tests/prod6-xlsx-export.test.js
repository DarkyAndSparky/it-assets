'use strict';
/**
 * Тесты: PROD-6 — xlsx-экспорт отчётов.
 * GET /api/export/xlsx — тот же набор данных, что /api/export/csv, в
 * формате .xlsx (собран вручную через server/lib/xlsx-writer.js, без
 * npm xlsx-библиотек — см. подробное объяснение в том файле).
 */
const request = require('supertest');
const AdmZip  = require('adm-zip');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

// content-type xlsx не распознаётся дефолтными парсерами superagent
// (text/json/urlencoded) — .buffer(true) БЕЗ явного parse() кладёт в
// res.body пустой {} вместо бинарных данных (сами байты остаются
// доступны только как испорченный res.text). Явный parse() ниже
// собирает чанки как Buffer напрямую с raw-потока ответа.
async function getXlsx(url) {
  const res = await request(app).get(url).set(AUTH).buffer(true).parse((response, cb) => {
    const chunks = [];
    response.on('data', c => chunks.push(c));
    response.on('end', () => cb(null, Buffer.concat(chunks)));
    response.on('error', cb);
  });
  return res;
}

describe('PROD-6: GET /api/export/xlsx', () => {
  test('требует авторизацию (SEC-8, симметрично /export/csv)', async () => {
    const res = await request(app).get('/api/export/xlsx');
    expect(res.status).toBe(401);
  });

  test('отдаёт валидный .xlsx (ZIP с нужными частями OOXML)', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await getXlsx('/api/export/xlsx');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain('.xlsx');

    const zip = new AdmZip(res.body);
    const names = zip.getEntries().map(e => e.entryName);
    expect(names).toEqual(expect.arrayContaining([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
      'xl/styles.xml', 'xl/worksheets/sheet1.xml',
    ]));
  });

  test('шапка листа содержит тот же набор колонок, что CSV-экспорт (IDEA-1)', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await getXlsx('/api/export/xlsx');
    const zip = new AdmZip(res.body);
    const sheetXml = zip.getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
    ['Инв. номер', 'Сеть', 'Контроллер', 'Доп. описание', 'Гарантия/ТО', 'Дата покупки', 'Стоимость']
      .forEach(col => expect(sheetXml).toContain(col));
  });

  test('?tab= фильтрует так же, как у CSV-экспорта', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'XlsxTabFilterModel', tab: 'infra', meta: { cost: 999 },
    });
    expect(created.status).toBeLessThan(300);

    const res = await getXlsx('/api/export/xlsx?tab=infra');
    const zip = new AdmZip(res.body);
    const sheetXml = zip.getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
    expect(sheetXml).toContain('XlsxTabFilterModel');
  });

  test('значение, похожее на формулу (=...), не теряется и не исполняется (SEC-11-style защита)', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'XlsxFormulaModel', tab: 'os', note: '=1+1',
    });
    const res = await getXlsx('/api/export/xlsx');
    const zip = new AdmZip(res.body);
    const sheetXml = zip.getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
    // Экранирование апострофа (&apos;) — валидный XML, не баг: важно, что
    // apostrophe-префикс ВООБЩЕ присутствует (в любом виде экранирования),
    // а "=1+1" никогда не встречается голым внутри <v> (что означало бы
    // числовую/формульную ячейку).
    expect(sheetXml).toMatch(/(&apos;|')=1\+1/);
    expect(sheetXml).not.toMatch(/<v>=1\+1<\/v>/);
  });
});

describe('PROD-6: server/lib/xlsx-writer — модульные тесты', () => {
  const { buildXlsx } = require('../server/lib/xlsx-writer');

  test('числа пишутся как числовые ячейки (без t="inlineStr")', () => {
    const buf = buildXlsx(['Name', 'Cost'], [['Item', 1500]], 'Test');
    const zip = new AdmZip(buf);
    const xml = zip.getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
    expect(xml).toContain('<c r="B2"><v>1500</v></c>');
  });

  test('пустые значения не создают лишних ячеек', () => {
    const buf = buildXlsx(['A', 'B'], [['x', '']], 'Test');
    const zip = new AdmZip(buf);
    const xml = zip.getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
    expect(xml).not.toContain('r="B2"');
  });

  test('имя листа обрезается до 31 символа (лимит Excel)', () => {
    const longName = 'A'.repeat(50);
    const buf = buildXlsx(['A'], [['x']], longName);
    const zip = new AdmZip(buf);
    const wb = zip.getEntry('xl/workbook.xml').getData().toString('utf8');
    const match = wb.match(/name="([^"]+)"/);
    expect(match[1].length).toBe(31);
  });

  test('XML-спецсимволы в значениях экранируются', () => {
    const buf = buildXlsx(['A'], [['<script>&"\'</script>']], 'Test');
    const zip = new AdmZip(buf);
    const xml = zip.getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;');
  });
});
