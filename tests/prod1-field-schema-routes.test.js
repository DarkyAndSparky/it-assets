'use strict';
/**
 * Тесты: PROD-1/PROD-4 на уровне HTTP-роутов — GET /api/meta-keys,
 * GET/PUT/DELETE /api/field-schemas(/:type_code).
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

describe('GET /api/meta-keys', () => {
  test('без логина → 401', async () => {
    const res = await request(app).get('/api/meta-keys');
    expect(res.status).toBe(401);
  });

  test('с логином → массив ключей, включает ip/mac', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/meta-keys').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toEqual(expect.arrayContaining(['ip', 'mac']));
  });
});

describe('GET/PUT/DELETE /api/field-schemas', () => {
  test('GET без логина → 401', async () => {
    const res = await request(app).get('/api/field-schemas');
    expect(res.status).toBe(401);
  });

  test('PUT без прав (не залогинен) → 401', async () => {
    const res = await request(app).put('/api/field-schemas/NB').send({ fields: [] });
    expect(res.status).toBe(401);
  });

  test('PUT с валидными полями → сохраняется и видно в GET', async () => {
    if (!AUTH['x-user-id']) return;
    const fields = [{ key: 'ip', type: 'ip', required: false }];
    const put = await request(app).put('/api/field-schemas/NB').set(AUTH).send({ fields });
    expect(put.status).toBe(200);

    const get = await request(app).get('/api/field-schemas').set(AUTH);
    expect(get.status).toBe(200);
    expect(get.body.NB).toEqual(fields);
  });

  test('PUT с key вне META_KEYS → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/field-schemas/NB').set(AUTH)
      .send({ fields: [{ key: 'not_a_real_key', type: 'text' }] });
    expect(res.status).toBe(400);
  });

  test('PUT с type=select без options → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/field-schemas/NB').set(AUTH)
      .send({ fields: [{ key: 'network', type: 'select' }] });
    expect(res.status).toBe(400);
  });

  test('PUT с type=select и options → 200', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/field-schemas/NB').set(AUTH)
      .send({ fields: [{ key: 'network', type: 'select', options: ['LAN', 'WiFi'] }] });
    expect(res.status).toBe(200);
  });

  test('DELETE сбрасывает схему на дефолт', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/field-schemas/NB').set(AUTH).send({ fields: [{ key: 'ip', type: 'ip' }] });
    const del = await request(app).delete('/api/field-schemas/NB').set(AUTH);
    expect(del.status).toBe(200);
    const get = await request(app).get('/api/field-schemas').set(AUTH);
    expect(get.body.NB).toBeUndefined();
  });
});
