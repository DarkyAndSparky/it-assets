'use strict';
/**
 * Тесты: IDEA-2 — fuzzy-проверка дублей серийников (нормализация формата,
 * не точное совпадение) при импорте CSV, и в previewCsvImport().
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

describe('IDEA-2: POST /api/import/csv — fuzzy_duplicate_serials', () => {
  test('серийник, отличающийся только форматированием от существующего актива — импортируется (не exact), но помечен как fuzzy-дубль', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({ model: 'Existing', tab: 'os', serial: 'SN12345' });

    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ model: 'Imported', tab: 'os', serial: 'SN-12345' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1); // не exact-match, поэтому реально добавлен
    expect(res.body.fuzzy_duplicate_serials).toHaveLength(1);
    expect(res.body.fuzzy_duplicate_serials[0]).toMatchObject({ serial: 'SN-12345', matched_with: 'SN12345', source: 'existing' });
  });

  test('точное совпадение серийника — обычный exact-дедуп, НЕ попадает в fuzzy-список (уже поймано раньше)', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({ model: 'ExactExisting', tab: 'os', serial: 'EXACT001' });
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ model: 'ExactImport', tab: 'os', serial: 'EXACT001' }],
    });
    expect(res.body.added).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.fuzzy_duplicate_serials).toHaveLength(0);
  });

  test('два похожих серийника В ОДНОМ файле (разное форматирование) — помечаются как batch-дубль', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [
        { model: 'BatchA', tab: 'os', serial: 'AB 001' },
        { model: 'BatchB', tab: 'os', serial: 'ab-001' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(2); // оба реально разные строки, разное форматирование — не exact
    const batchDup = res.body.fuzzy_duplicate_serials.find(f => f.source === 'batch');
    expect(batchDup).toBeTruthy();
  });

  test('совершенно разные серийники — не попадают в fuzzy-список', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{ model: 'Unique', tab: 'os', serial: 'ZZZ999UNIQUE' }],
    });
    expect(res.body.fuzzy_duplicate_serials).toHaveLength(0);
  });
});

describe('IDEA-2: POST /api/import/csv/preview — possible_duplicate_serials', () => {
  test('preview находит вероятный дубль по нормализованному серийнику', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({ model: 'PreviewExisting', tab: 'os', serial: 'PVW-100' });
    const res = await request(app).post('/api/import/csv/preview').set(AUTH).send({
      rows: [{ model: 'PreviewNew', tab: 'os', serial: 'pvw100' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.possible_duplicate_serials).toHaveLength(1);
    expect(res.body.possible_duplicate_serials[0].matched_with).toBe('PVW-100');
  });

  test('preview ничего не изменяет в базе (чисто информационный)', async () => {
    if (!AUTH['x-user-id']) return;
    const before = await request(app).get('/api/stats');
    await request(app).post('/api/import/csv/preview').set(AUTH).send({
      rows: [{ model: 'ShouldNotBeAdded', tab: 'os', serial: 'NEVERADDED' }],
    });
    const after = await request(app).get('/api/stats');
    expect(after.body.total).toBe(before.body.total);
  });
});
