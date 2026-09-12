'use strict';
/**
 * Тесты: PROD-19 (POST /api/assets/bulk-update-meta) и PROD-20 (GET
 * /api/assets?meta_<key>=...).
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

async function createAsset(overrides = {}) {
  const res = await request(app).post('/api/assets').set(AUTH)
    .send({ model: 'BulkMetaModel', type: 'Ноутбук', tab: 'os', ...overrides });
  return res.body.id;
}

describe('POST /api/assets/bulk-update-meta', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).post('/api/assets/bulk-update-meta').send({ ids: ['x'], meta: { ip: '1.1.1.1' } });
    expect(res.status).toBe(401);
  });

  test('без ids → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/assets/bulk-update-meta').set(AUTH).send({ meta: { ip: '1.1.1.1' } });
    expect(res.status).toBe(400);
  });

  test('пустой meta → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/assets/bulk-update-meta').set(AUTH).send({ ids: ['x'], meta: {} });
    expect(res.status).toBe(400);
  });

  test('key вне META_KEYS → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/assets/bulk-update-meta').set(AUTH)
      .send({ ids: ['x'], meta: { not_a_real_key: 'v' } });
    expect(res.status).toBe(400);
  });

  test('успешно проставляет meta нескольким активам разом', async () => {
    if (!AUTH['x-user-id']) return;
    const id1 = await createAsset();
    const id2 = await createAsset();
    const res = await request(app).post('/api/assets/bulk-update-meta').set(AUTH)
      .send({ ids: [id1, id2], meta: { network: 'WiFi' } });
    expect(res.status).toBe(200);
    expect(res.body.ids_assigned.sort()).toEqual([id1, id2].sort());

    const get1 = await request(app).get(`/api/assets/${id1}`).set(AUTH);
    expect(get1.body.meta.network).toBe('WiFi');
  });

  test('несуществующий id — в ids_failed, не мешает остальным', async () => {
    if (!AUTH['x-user-id']) return;
    const id1 = await createAsset();
    const res = await request(app).post('/api/assets/bulk-update-meta').set(AUTH)
      .send({ ids: [id1, 'no-such-id'], meta: { hostname: 'srv1' } });
    expect(res.status).toBe(200);
    expect(res.body.ids_assigned).toContain(id1);
    expect(res.body.ids_failed.some(f => f.id === 'no-such-id')).toBe(true);
  });

  test('со схемой типа — невалидное значение для одного ассета уходит в ids_failed, остальные проходят', async () => {
    if (!AUTH['x-user-id']) return;
    await mockDb.setTypeCodes([{ code: 'NB', name: 'Ноутбук', tab: 'os' }]);
    await mockDb.setFieldSchema('NB', [{ key: 'ip', type: 'ip' }]);
    const idOk = await createAsset();
    const res = await request(app).post('/api/assets/bulk-update-meta').set(AUTH)
      .send({ ids: [idOk], meta: { ip: 'not-an-ip' } });
    expect(res.status).toBe(200);
    expect(res.body.ids_failed.some(f => f.id === idOk)).toBe(true);
    expect(res.body.ids_assigned).not.toContain(idOk);
    mockDb.setFieldSchema('NB', null); // сброс, чтобы не влиять на другие тесты в этом файле
  });

  test('bulk-update-meta пишет запись в историю с action_type=edit', async () => {
    if (!AUTH['x-user-id']) return;
    const id1 = await createAsset();
    await request(app).post('/api/assets/bulk-update-meta').set(AUTH)
      .send({ ids: [id1], meta: { cabinet: 'A-101' } });
    const hist = await request(app).get(`/api/history?asset_id=${id1}`).set(AUTH);
    expect(hist.body.items.some(h => h.action_type === 'edit')).toBe(true);
  });
});

describe('GET /api/assets?meta_<key>= — PROD-20', () => {
  test('фильтрует по подстроке в конкретном meta-поле', async () => {
    if (!AUTH['x-user-id']) return;
    const idA = await createAsset({ model: 'MetaFilterA' });
    const idB = await createAsset({ model: 'MetaFilterB' });
    await request(app).post('/api/assets/bulk-update-meta').set(AUTH).send({ ids: [idA], meta: { hostname: 'SRV-ALPHA' } });
    await request(app).post('/api/assets/bulk-update-meta').set(AUTH).send({ ids: [idB], meta: { hostname: 'SRV-BETA' } });

    const res = await request(app).get('/api/assets?meta_hostname=alpha').set(AUTH);
    expect(res.status).toBe(200);
    const ids = res.body.items.map(a => a.id);
    expect(ids).toContain(idA);
    expect(ids).not.toContain(idB);
  });

  test('пустое значение фильтра — не фильтрует (возвращает всё)', async () => {
    if (!AUTH['x-user-id']) return;
    const before = await request(app).get('/api/assets?tab=os').set(AUTH);
    const after = await request(app).get('/api/assets?tab=os&meta_hostname=').set(AUTH);
    expect(after.body.total).toBe(before.body.total);
  });
});
