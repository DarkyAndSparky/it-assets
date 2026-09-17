'use strict';
/**
 * Тесты: PROD-11 — REST API-ключи. Ключ наследует роль владельца целиком
 * (не отдельная модель прав), используется как Bearer-токен в
 * requireAuth/requireLogin (server/middleware/auth.js).
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
let adminId;
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) { AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' }; adminId = res.body.user.id; }
});

describe('PROD-11: POST/GET/DELETE /api/api-keys — самообслуживание', () => {
  test('POST требует авторизацию', async () => {
    const res = await request(app).post('/api/api-keys').send({ name: 'x' });
    expect(res.status).toBe(401);
  });

  test('POST без name → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/api-keys').set(AUTH).send({});
    expect(res.status).toBe(400);
  });

  test('POST создаёт ключ, СЫРОЙ ключ возвращается один раз и начинается с itak_', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/api-keys').set(AUTH).send({ name: 'CI pipeline' });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(/^itak_/);
    expect(res.body.name).toBe('CI pipeline');
    expect(res.body.id).toBeTruthy();
  });

  test('GET список НЕ содержит сырой ключ, только префикс/метаданные', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/api-keys').set(AUTH).send({ name: 'ListCheckKey' });
    const res = await request(app).get('/api/api-keys').set(AUTH);
    expect(res.status).toBe(200);
    const found = res.body.find(k => k.name === 'ListCheckKey');
    expect(found).toBeTruthy();
    expect(found.key).toBeUndefined();
    expect(found.key_hash).toBeUndefined();
    expect(found.key_prefix).toMatch(/^itak_/);
  });

  test('DELETE отзывает ключ — после отзыва он больше не проходит аутентификацию', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/api-keys').set(AUTH).send({ name: 'ToRevoke' });
    const rawKey = created.body.key;

    const okBefore = await request(app).get('/api/assets').set({ Authorization: `Bearer ${rawKey}` });
    expect(okBefore.status).toBe(200);

    const del = await request(app).delete(`/api/api-keys/${created.body.id}`).set(AUTH);
    expect(del.status).toBe(200);

    const failAfter = await request(app).get('/api/assets').set({ Authorization: `Bearer ${rawKey}` });
    expect(failAfter.status).toBe(401);
  });

  test('DELETE чужого ключа обычным пользователем → 403', async () => {
    if (!AUTH['x-user-id']) return;
    const op = mockDb.createUser({ name: 'ApiKeyOp', login: 'apikeyop', role: 'operator', pin: 'opkeypin1' });
    const opAuth = { 'x-user-id': op.id, 'x-edit-password': 'opkeypin1' };
    const created = await request(app).post('/api/api-keys').set(AUTH).send({ name: 'AdminOwnedKey' });
    const res = await request(app).delete(`/api/api-keys/${created.body.id}`).set(opAuth);
    expect(res.status).toBe(403);
  });

  test('DELETE несуществующего ключа → 404', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).delete('/api/api-keys/no-such-id').set(AUTH);
    expect(res.status).toBe(404);
  });
});

describe('PROD-11: Bearer-ключ как альтернатива x-user-id/x-edit-password', () => {
  test('валидный ключ проходит requireLogin (GET /api/assets)', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/api-keys').set(AUTH).send({ name: 'BearerReadTest' });
    const res = await request(app).get('/api/assets').set({ Authorization: `Bearer ${created.body.key}` });
    expect(res.status).toBe(200);
  });

  test('валидный ключ проходит requireAuth (создание актива)', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/api-keys').set(AUTH).send({ name: 'BearerWriteTest' });
    const res = await request(app).post('/api/assets')
      .set({ Authorization: `Bearer ${created.body.key}` })
      .send({ model: 'ApiKeyCreatedAsset', tab: 'os' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('невалидный/поддельный ключ → 401 (не 500, не тихий провал в другую ветку)', async () => {
    const res = await request(app).get('/api/assets').set({ Authorization: 'Bearer itak_totallyFakeKeyValue1234567890' });
    expect(res.status).toBe(401);
  });

  test('ключ viewer-пользователя НЕ проходит requireAuth (роль наследуется целиком)', async () => {
    if (!AUTH['x-user-id']) return;
    const viewer = mockDb.createUser({ name: 'ApiKeyViewer', login: 'apikeyviewer', role: 'viewer', pin: '' });
    const viewerAuth = { 'x-user-id': viewer.id, 'x-edit-password': '' };
    // viewer не может пройти requireAuth (POST), но requireLogin (GET) — может;
    // requireAuth сам по себе блокирует viewer и без ключа, так что создаём ключ
    // через прямой вызов репозитория (viewer не смог бы создать ключ себе через
    // POST /api/api-keys, т.к. это тоже requireAuth) — тестируем именно
    // "ключ существует, но роль viewer всё равно блокирует запись".
    const apiKeysRepo = require('../server/repositories/apikeys.repo');
    const { key } = apiKeysRepo.createApiKey(viewer.id, 'ViewerKey');
    const res = await request(app).post('/api/assets')
      .set({ Authorization: `Bearer ${key}` })
      .send({ model: 'ShouldNotBeCreated', tab: 'os' });
    expect(res.status).toBe(403);
  });

  test('заголовок Authorization в неверном формате игнорируется — падает в обычный auth-флоу, не крашит', async () => {
    const res = await request(app).get('/api/assets').set({ Authorization: 'NotBearer garbage' });
    expect(res.status).toBe(401);
  });
});

describe('PROD-11: server/repositories/apikeys.repo.js — модульные тесты', () => {
  const apiKeysRepo = require('../server/repositories/apikeys.repo');

  test('authenticateApiKey(null/пустая строка/не itak_) → null, не исключение', () => {
    expect(apiKeysRepo.authenticateApiKey(null)).toBeNull();
    expect(apiKeysRepo.authenticateApiKey('')).toBeNull();
    expect(apiKeysRepo.authenticateApiKey('sk_wrong_prefix_123')).toBeNull();
  });

  test('getApiKeyOwner для несуществующего id → null', () => {
    expect(apiKeysRepo.getApiKeyOwner('no-such-id')).toBeNull();
  });
});
