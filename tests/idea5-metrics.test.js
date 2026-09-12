'use strict';
/**
 * Тесты: IDEA-5 — GET /api/metrics.
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

describe('GET /api/metrics', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).get('/api/metrics');
    expect(res.status).toBe(401);
  });

  test('оператор (не admin) → 403', async () => {
    const op = await mockDb.createUser({ name: 'Op Metrics', login: 'opmetrics', role: 'operator', pin: '1234' });
    const res = await request(app).get('/api/metrics')
      .set({ 'x-user-id': op.id, 'x-edit-password': '1234' });
    expect(res.status).toBe(403);
  });

  test('admin получает структуру с assets/history/storage/backups/uptime_sec', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/metrics').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('generated_at');
    expect(res.body).toHaveProperty('assets.total');
    expect(res.body).toHaveProperty('assets.by_status');
    expect(res.body).toHaveProperty('assets.by_tab');
    expect(res.body).toHaveProperty('history.total');
    expect(res.body).toHaveProperty('storage.sqlite_bytes');
    expect(res.body).toHaveProperty('backups.count');
    expect(typeof res.body.uptime_sec).toBe('number');
  });

  test('assets.total считает и списанные (honest snapshot, не только активные)', async () => {
    if (!AUTH['x-user-id']) return;
    const before = await request(app).get('/api/metrics').set(AUTH);
    const create = await request(app).post('/api/assets').set(AUTH).send({ model: 'MetricsTestModel', tab: 'os' });
    await request(app).delete(`/api/assets/${create.body.id}`).set(AUTH); // списание
    const after = await request(app).get('/api/metrics').set(AUTH);
    expect(after.body.assets.total).toBe(before.body.assets.total + 1);
    expect(after.body.assets.by_status['списан']).toBeGreaterThanOrEqual(1);
  });
});
