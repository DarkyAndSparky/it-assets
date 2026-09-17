'use strict';
/**
 * Тесты: PROD-9 — лёгкая версия доступа по организации. users.org_id
 * (null = без ограничения), requireOrgAccess в create/update/delete/move
 * активов. Bulk-роуты НЕ прикрыты (известное ограничение light-версии).
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let ADMIN_AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) ADMIN_AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

async function createOrg(name, code) {
  const res = await request(app).post('/api/orgs').set(ADMIN_AUTH).send({ name, short_code: code });
  return res.body;
}

async function createRestrictedUser(org_id) {
  const res = await request(app).post('/api/users').set(ADMIN_AUTH)
    .send({ name: 'Restricted', login: `restricted-${org_id||'none'}-${Date.now()}`, role: 'operator', pin: '1234', org_id });
  return { 'x-user-id': res.body.id, 'x-edit-password': '1234' };
}

describe('PROD-9: users.org_id — CRUD round-trip', () => {
  test('org_id по умолчанию null (без ограничения)', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const res = await request(app).post('/api/users').set(ADMIN_AUTH)
      .send({ name: 'NoOrgUser', login: `noorg-${Date.now()}`, role: 'operator', pin: '1234' });
    expect(res.body.org_id == null).toBe(true);
  });

  test('org_id сохраняется и виден через GET /api/users', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const org = await createOrg('PROD9 Org A', 'P9A');
    const created = await request(app).post('/api/users').set(ADMIN_AUTH)
      .send({ name: 'OrgUser', login: `orguser-${Date.now()}`, role: 'operator', pin: '1234', org_id: org.id });
    const list = await request(app).get('/api/users').set(ADMIN_AUTH);
    const found = list.body.find(u => u.id === created.body.id);
    expect(found.org_id).toBe(org.id);
  });
});

describe('PROD-9: requireOrgAccess на create/update/delete/move', () => {
  test('без org_id (не ограничен) — работает как раньше, любая организация', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const unrestricted = await createRestrictedUser(null);
    const orgA = await createOrg('PROD9 Org B', 'P9B');
    const res = await request(app).post('/api/assets').set(unrestricted)
      .send({ model: 'UnrestrictedModel', tab: 'os', org: orgA.name });
    expect(res.status).toBe(200);
  });

  test('ограниченный пользователь НЕ может создать актив под чужой организацией', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const orgOwn   = await createOrg('PROD9 Own', 'P9OWN');
    const orgOther = await createOrg('PROD9 Other', 'P9OTH');
    const restricted = await createRestrictedUser(orgOwn.id);
    const res = await request(app).post('/api/assets').set(restricted)
      .send({ model: 'ForbiddenModel', tab: 'os', org: orgOther.name });
    expect(res.status).toBe(403);
  });

  test('ограниченный пользователь МОЖЕТ создать актив под СВОЕЙ организацией', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const orgOwn = await createOrg('PROD9 Own2', 'P9OWN2');
    const restricted = await createRestrictedUser(orgOwn.id);
    const res = await request(app).post('/api/assets').set(restricted)
      .send({ model: 'AllowedModel', tab: 'os', org: orgOwn.name });
    expect(res.status).toBe(200);
  });

  test('создание без указания org (свободный текст не резолвится) не блокируется — light-версия', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const orgOwn = await createOrg('PROD9 Own3', 'P9OWN3');
    const restricted = await createRestrictedUser(orgOwn.id);
    const res = await request(app).post('/api/assets').set(restricted)
      .send({ model: 'NoOrgSpecified', tab: 'os' });
    expect(res.status).toBe(200);
  });

  test('обновление чужого (по org) актива запрещено', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const orgOwn   = await createOrg('PROD9 UpdOwn', 'P9UO');
    const orgOther = await createOrg('PROD9 UpdOther', 'P9UOT');
    const foreignAsset = await request(app).post('/api/assets').set(ADMIN_AUTH)
      .send({ model: 'ForeignAsset', tab: 'os', org: orgOther.name });
    const restricted = await createRestrictedUser(orgOwn.id);
    const res = await request(app).put(`/api/assets/${foreignAsset.body.id}`).set(restricted)
      .send({ note: 'попытка правки' });
    expect(res.status).toBe(403);
  });

  test('обновление своего (по org) актива разрешено', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const orgOwn = await createOrg('PROD9 UpdOwn2', 'P9UO2');
    const ownAsset = await request(app).post('/api/assets').set(ADMIN_AUTH)
      .send({ model: 'OwnAsset', tab: 'os', org: orgOwn.name });
    const restricted = await createRestrictedUser(orgOwn.id);
    const res = await request(app).put(`/api/assets/${ownAsset.body.id}`).set(restricted)
      .send({ note: 'своя правка' });
    expect(res.status).toBe(200);
  });

  test('списание чужого актива запрещено', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const orgOwn   = await createOrg('PROD9 DelOwn', 'P9DO');
    const orgOther = await createOrg('PROD9 DelOther', 'P9DOT');
    const foreignAsset = await request(app).post('/api/assets').set(ADMIN_AUTH)
      .send({ model: 'ForeignDelAsset', tab: 'os', org: orgOther.name });
    const restricted = await createRestrictedUser(orgOwn.id);
    const res = await request(app).delete(`/api/assets/${foreignAsset.body.id}`).set(restricted);
    expect(res.status).toBe(403);
  });

  test('перемещение чужого актива запрещено', async () => {
    if (!ADMIN_AUTH['x-user-id']) return;
    const orgOwn   = await createOrg('PROD9 MoveOwn', 'P9MO');
    const orgOther = await createOrg('PROD9 MoveOther', 'P9MOT');
    const foreignAsset = await request(app).post('/api/assets').set(ADMIN_AUTH)
      .send({ model: 'ForeignMoveAsset', tab: 'os', org: orgOther.name });
    const restricted = await createRestrictedUser(orgOwn.id);
    const res = await request(app).post(`/api/assets/${foreignAsset.body.id}/move`).set(restricted)
      .send({ newResponsible: 'Кто-то' });
    expect(res.status).toBe(403);
  });
});
