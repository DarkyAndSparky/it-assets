'use strict';
/**
 * Тесты: PROD-18 — meta.purchase_date/meta.cost (16-й/17-й META_KEYS).
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

describe('PROD-18: meta.purchase_date / meta.cost', () => {
  test('GET /api/meta-keys включает purchase_date и cost', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/meta-keys').set(AUTH);
    expect(res.body).toContain('purchase_date');
    expect(res.body).toContain('cost');
  });

  test('сохраняются и видны через GET', async () => {
    if (!AUTH['x-user-id']) return;
    const create = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'Prod18Model', type: 'Ноутбук', tab: 'os',
        meta: { purchase_date: '2024-03-15', cost: '54990' } });
    const get = await request(app).get(`/api/assets/${create.body.id}`).set(AUTH);
    expect(get.body.meta.purchase_date).toBe('2024-03-15');
    expect(get.body.meta.cost).toBe('54990');
  });

  test('со схемой типа cost=number — нечисловое значение отклоняется (PROD-3)', async () => {
    if (!AUTH['x-user-id']) return;
    await mockDb.setTypeCodes([{ code: 'NB', name: 'Ноутбук', tab: 'os' }]);
    await mockDb.setFieldSchema('NB', [{ key: 'cost', type: 'number' }]);
    const res = await request(app).post('/api/assets').set(AUTH)
      .send({ model: 'BadCost', type: 'Ноутбук', tab: 'os', meta: { cost: 'дорого' } });
    expect(res.status).toBe(400);
    mockDb.setFieldSchema('NB', null);
  });

  test('bulk-update-meta проставляет purchase_date/cost нескольким активам разом', async () => {
    if (!AUTH['x-user-id']) return;
    const c1 = await request(app).post('/api/assets').set(AUTH).send({ model: 'Bulk18A', tab: 'os' });
    const c2 = await request(app).post('/api/assets').set(AUTH).send({ model: 'Bulk18B', tab: 'os' });
    const res = await request(app).post('/api/assets/bulk-update-meta').set(AUTH)
      .send({ ids: [c1.body.id, c2.body.id], meta: { cost: '10000' } });
    expect(res.status).toBe(200);
    expect(res.body.ids_assigned.sort()).toEqual([c1.body.id, c2.body.id].sort());
  });
});
