'use strict';
/**
 * Тесты: PROD-10 — версионирование записей (снапшот полей при изменении).
 * Снапшот пишется в createAsset (v1), updateAsset (до патча), retireAsset
 * (до списания). move/bulk-* НЕ снапшотятся — осознанное ограничение,
 * см. server/repositories/assets.repo.js / SCHEMA.md.
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

describe('PROD-10: GET /api/assets/:id/versions', () => {
  test('требует авторизацию', async () => {
    const res = await request(app).get('/api/assets/nonexistent/versions');
    expect(res.status).toBe(401);
  });

  test('несуществующий актив → 404', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/assets/nonexistent-id-xyz/versions').set(AUTH);
    expect(res.status).toBe(404);
  });

  test('создание актива → версия 1 сразу доступна', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'VersionTestModel', tab: 'os', serial: 'SN-VER-001',
    });
    const res = await request(app).get(`/api/assets/${created.body.id}/versions`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].version_no).toBe(1);
    expect(res.body[0].snapshot.model).toBe('VersionTestModel');
  });

  test('изменение поля добавляет новую версию СО СТАРЫМ значением (снапшот ДО патча)', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'VersionEditModel', tab: 'os', serial: 'SN-VER-002', note: 'первая заметка',
    });
    await request(app).put(`/api/assets/${created.body.id}`).set(AUTH).send({ note: 'вторая заметка' });

    const res = await request(app).get(`/api/assets/${created.body.id}/versions`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    // DESC — новая версия первая. Версия 2 — снапшот ДО патча (старое значение).
    expect(res.body[0].version_no).toBe(2);
    expect(res.body[0].snapshot.note).toBe('первая заметка');
    expect(res.body[1].version_no).toBe(1);
  });

  test('несколько последовательных изменений — растущий version_no, порядок DESC', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'VersionMultiModel', tab: 'os', serial: 'SN-VER-003',
    });
    await request(app).put(`/api/assets/${created.body.id}`).set(AUTH).send({ note: 'edit 1' });
    await request(app).put(`/api/assets/${created.body.id}`).set(AUTH).send({ note: 'edit 2' });
    await request(app).put(`/api/assets/${created.body.id}`).set(AUTH).send({ note: 'edit 3' });

    const res = await request(app).get(`/api/assets/${created.body.id}/versions`).set(AUTH);
    expect(res.body.length).toBe(4); // create + 3 edits
    expect(res.body.map(v => v.version_no)).toEqual([4, 3, 2, 1]);
  });

  test('списание пишет финальный снапшот ДО списания (статус ещё старый в снапшоте)', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'VersionRetireModel', tab: 'os', serial: 'SN-VER-004',
    });
    await request(app).delete(`/api/assets/${created.body.id}`).set(AUTH);

    const res = await request(app).get(`/api/assets/${created.body.id}/versions`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].snapshot.status).not.toBe('списан'); // снапшот ДО, ещё старый статус
  });

  test('move НЕ создаёт новую версию — осознанное ограничение области действия', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'VersionMoveModel', tab: 'os', serial: 'SN-VER-005',
    });
    const before = await request(app).get(`/api/assets/${created.body.id}/versions`).set(AUTH);
    await request(app).post(`/api/assets/${created.body.id}/move`).set(AUTH).send({ newLocation: 'Другой кабинет' });
    const after = await request(app).get(`/api/assets/${created.body.id}/versions`).set(AUTH);
    expect(after.body.length).toBe(before.body.length);
  });

  test('снапшот включает meta целиком (это не whitelist, в отличие от PROD-8 /scan)', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'VersionMetaModel', tab: 'os', serial: 'SN-VER-006',
      meta: { login: 'admin', ip: '10.0.0.1' },
    });
    const res = await request(app).get(`/api/assets/${created.body.id}/versions`).set(AUTH);
    expect(res.body[0].snapshot.meta.login).toBe('admin');
    expect(res.body[0].snapshot.meta.ip).toBe('10.0.0.1');
  });
});

describe('PROD-10: server/repositories/assets.repo.js — модульные тесты', () => {
  const assetsRepo = require('../server/repositories/assets.repo');

  test('getAssetVersions() для несуществующего asset_id → пустой массив, не исключение', () => {
    expect(assetsRepo.getAssetVersions('no-such-asset-id')).toEqual([]);
  });
});
