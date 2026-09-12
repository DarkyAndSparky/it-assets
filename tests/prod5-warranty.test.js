'use strict';
/**
 * Тесты: PROD-5 — meta.warranty (15-й META_KEYS ключ), фильтр
 * ?warranty_expiring_days= в listAssets, счётчики warrantyExpired/
 * warrantyExpiring в /api/stats.
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

function isoDaysFromNow(days) {
  return new Date(Date.now() + days*24*60*60*1000).toISOString().slice(0, 10);
}

async function createAssetWithWarranty(warranty) {
  const res = await request(app).post('/api/assets').set(AUTH)
    .send({ model: 'WarrantyModel', type: 'Ноутбук', tab: 'os', meta: warranty ? { warranty } : {} });
  return res.body.id;
}

describe('PROD-5: meta.warranty round-trip', () => {
  test('meta.warranty сохраняется и виден через GET', async () => {
    if (!AUTH['x-user-id']) return;
    const date = isoDaysFromNow(10);
    const id = await createAssetWithWarranty(date);
    const get = await request(app).get(`/api/assets/${id}`).set(AUTH);
    expect(get.body.meta.warranty).toBe(date);
  });

  test('GET /api/meta-keys включает warranty', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/meta-keys').set(AUTH);
    expect(res.body).toContain('warranty');
  });
});

describe('PROD-5: GET /api/assets?warranty_expiring_days=', () => {
  test('находит активы с истекающей в пределах N дней гарантией, не находит с далёкой', async () => {
    if (!AUTH['x-user-id']) return;
    const soonId = await createAssetWithWarranty(isoDaysFromNow(5));
    const farId  = await createAssetWithWarranty(isoDaysFromNow(200));
    const res = await request(app).get('/api/assets?warranty_expiring_days=30&limit=500').set(AUTH);
    const ids = res.body.items.map(a => a.id);
    expect(ids).toContain(soonId);
    expect(ids).not.toContain(farId);
  });

  test('warranty_expiring_days=0 находит уже истёкшую гарантию', async () => {
    if (!AUTH['x-user-id']) return;
    const expiredId = await createAssetWithWarranty(isoDaysFromNow(-5));
    const res = await request(app).get('/api/assets?warranty_expiring_days=0&limit=500').set(AUTH);
    const ids = res.body.items.map(a => a.id);
    expect(ids).toContain(expiredId);
  });

  test('активы без meta.warranty не попадают в выборку', async () => {
    if (!AUTH['x-user-id']) return;
    const noWarrantyId = await createAssetWithWarranty(null);
    const res = await request(app).get('/api/assets?warranty_expiring_days=9999&limit=500').set(AUTH);
    const ids = res.body.items.map(a => a.id);
    expect(ids).not.toContain(noWarrantyId);
  });
});

describe('PROD-5: /api/stats — warrantyExpired/warrantyExpiring', () => {
  test('считает истёкшие и истекающие раздельно', async () => {
    if (!AUTH['x-user-id']) return;
    const before = await request(app).get('/api/stats');
    await createAssetWithWarranty(isoDaysFromNow(-1));  // истекла
    await createAssetWithWarranty(isoDaysFromNow(10));  // истекает скоро
    const after = await request(app).get('/api/stats');
    expect(after.body.warrantyExpired).toBe((before.body.warrantyExpired||0) + 1);
    expect(after.body.warrantyExpiring).toBe((before.body.warrantyExpiring||0) + 1);
  });
});
