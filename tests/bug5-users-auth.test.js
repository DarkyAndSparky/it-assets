'use strict';
/**
 * Тесты: BUG-5 — GET /api/users переведён на requireLogin (единообразно с
 * остальными read-only роутами, INFRA-7), вместо самодельной инлайн-проверки.
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

describe('BUG-5: GET /api/users — requireLogin', () => {
  test('без x-user-id → 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  test('с несуществующим x-user-id → 401', async () => {
    const res = await request(app).get('/api/users').set('x-user-id', 'no-such-user');
    expect(res.status).toBe(401);
  });

  test('viewer без пароля (x-edit-password не передан) — доступ есть, в отличие от requireAuth', async () => {
    const viewer = mockDb.createUser({ name: 'Viewer RO', login: 'viewerro', role: 'viewer', pin: '1234' });
    const res = await request(app).get('/api/users').set('x-user-id', viewer.id);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('деактивированный пользователь → 401', async () => {
    const u = mockDb.createUser({ name: 'Inactive', login: 'inactiveu', role: 'operator', pin: '1234' });
    mockDb.updateUser(u.id, { active: false });
    const res = await request(app).get('/api/users').set('x-user-id', u.id);
    expect(res.status).toBe(401);
  });
});
