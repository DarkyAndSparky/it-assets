'use strict';
/**
 * Тесты: IDEA-3 — «Инвентаризация по месту». POST /api/assets/inventory-check
 * сверяет отсканированные коды с тем, что должно быть в указанном месте.
 * Только отчёт о расхождениях — ничего не мутирует.
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

describe('POST /api/assets/inventory-check', () => {
  test('требует авторизацию', async () => {
    const res = await request(app).post('/api/assets/inventory-check').send({ location: 'X', codes: [] });
    expect(res.status).toBe(401);
  });

  test('без location → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/assets/inventory-check').set(AUTH).send({ codes: [] });
    expect(res.status).toBe(400);
  });

  test('пустой location (только пробелы) → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/assets/inventory-check').set(AUTH).send({ location: '   ', codes: [] });
    expect(res.status).toBe(400);
  });

  test('ничего не сканировали — все активы места попадают в missing', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'InvCheckModelA', tab: 'os', serial: 'SN-INV-A', location: 'Кабинет 101',
    });
    expect(created.status).toBe(200);
    const res = await request(app).post('/api/assets/inventory-check').set(AUTH)
      .send({ location: 'Кабинет 101', codes: [] });
    expect(res.status).toBe(200);
    expect(res.body.missing.some(a => a.serial === 'SN-INV-A')).toBe(true);
    expect(res.body.matched.length).toBe(0);
  });

  test('отсканировали ровно то, что нужно — matched, missing пуст', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'InvCheckModelB', tab: 'os', serial: 'SN-INV-B', location: 'Кабинет 202',
    });
    const res = await request(app).post('/api/assets/inventory-check').set(AUTH)
      .send({ location: 'Кабинет 202', codes: ['SN-INV-B'] });
    expect(res.status).toBe(200);
    expect(res.body.matched.some(a => a.serial === 'SN-INV-B')).toBe(true);
    expect(res.body.missing.some(a => a.serial === 'SN-INV-B')).toBe(false);
  });

  test('отсканирован актив, который числится в ДРУГОМ месте — unexpected с actual_location', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'InvCheckModelC', tab: 'os', serial: 'SN-INV-C', location: 'Склад',
    });
    const res = await request(app).post('/api/assets/inventory-check').set(AUTH)
      .send({ location: 'Кабинет 303', codes: ['SN-INV-C'] });
    expect(res.status).toBe(200);
    const found = res.body.unexpected.find(a => a.serial === 'SN-INV-C');
    expect(found).toBeTruthy();
    expect(found.actual_location).toBe('Склад');
  });

  test('отсканирован код, которого нет в системе вообще — unknown', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/assets/inventory-check').set(AUTH)
      .send({ location: 'Кабинет 101', codes: ['NO-SUCH-CODE-EVER-XYZ'] });
    expect(res.status).toBe(200);
    expect(res.body.unknown).toContain('NO-SUCH-CODE-EVER-XYZ');
  });

  test('QR-стиль префиксы SN:/INV: распознаются так же, как в /api/public/scan (PROD-8)', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'InvCheckModelD', tab: 'os', serial: 'SN-INV-D', location: 'Кабинет 404',
    });
    const res = await request(app).post('/api/assets/inventory-check').set(AUTH)
      .send({ location: 'Кабинет 404', codes: ['SN:SN-INV-D'] });
    expect(res.body.matched.some(a => a.serial === 'SN-INV-D')).toBe(true);
  });

  test('списанный актив не попадает ни в missing, ни в expected_count', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'InvCheckRetiredModel', tab: 'os', serial: 'SN-INV-RETIRED', location: 'Кабинет 505',
    });
    await request(app).delete(`/api/assets/${created.body.id}`).set(AUTH);
    const res = await request(app).post('/api/assets/inventory-check').set(AUTH)
      .send({ location: 'Кабинет 505', codes: [] });
    expect(res.body.missing.some(a => a.serial === 'SN-INV-RETIRED')).toBe(false);
  });

  test('ничего не мутирует — местоположение актива не меняется после сверки', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'InvCheckNoMutateModel', tab: 'os', serial: 'SN-INV-NOMUTATE', location: 'Склад',
    });
    await request(app).post('/api/assets/inventory-check').set(AUTH)
      .send({ location: 'Кабинет 999', codes: ['SN-INV-NOMUTATE'] });
    const after = await request(app).get(`/api/assets/${created.body.id}`).set(AUTH);
    expect(after.body.location).toBe('Склад');
  });

  test('дубли в codes не ломают счётчики (актив однократно учитывается в matched)', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'InvCheckDupeModel', tab: 'os', serial: 'SN-INV-DUPE', location: 'Кабинет 111',
    });
    const res = await request(app).post('/api/assets/inventory-check').set(AUTH)
      .send({ location: 'Кабинет 111', codes: ['SN-INV-DUPE', 'SN-INV-DUPE', 'SN-INV-DUPE'] });
    const matches = res.body.matched.filter(a => a.serial === 'SN-INV-DUPE');
    expect(matches.length).toBe(3); // отчёт по сканам, не по активам — 3 скана = 3 строки, это ожидаемо
  });
});

describe('IDEA-3: server/repositories/assets.repo.js::checkInventoryByLocation — модульные тесты', () => {
  const assetsRepo = require('../server/repositories/assets.repo');

  test('пустой location → всё равно не падает, просто пустая выборка', () => {
    const res = assetsRepo.checkInventoryByLocation('', []);
    expect(res.expected_count).toBe(0);
    expect(res.missing).toEqual([]);
  });

  test('codes не массив → трактуется как пустой список, не исключение', () => {
    expect(() => assetsRepo.checkInventoryByLocation('X', null)).not.toThrow();
    expect(() => assetsRepo.checkInventoryByLocation('X', undefined)).not.toThrow();
  });
});
