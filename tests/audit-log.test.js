'use strict';
/**
 * Тесты: общесистемный аудит-лог (audit_log / server/repositories/audit.repo.js
 * / GET /api/audit) — перенесено из Procure-IT, адаптировано под node:sqlite +
 * uuidv7 + repositories/routes-паттерн it-assets. См. PLAN.md исходного
 * архива для полного описания точек интеграции.
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');
const { sqlite } = require('../server/db/sqlite');
const auditRepo = require('../server/repositories/audit.repo');

function clearAudit() {
  sqlite.prepare('DELETE FROM audit_log').run();
}

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

beforeEach(() => clearAudit());

describe('audit.repo — logAction/listAudit (unit)', () => {
  test('logAction пишет строку, listAudit её возвращает с распарсенным detail', () => {
    auditRepo.logAction({ id: 'u1', name: 'Test User' }, 'user.create', 'user', 'u2', { role: 'operator' });
    const rows = auditRepo.listAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: 'u1', actor_name: 'Test User',
      action: 'user.create', entity: 'user', entity_id: 'u2',
      detail: { role: 'operator' },
    });
    expect(typeof rows[0].id).toBe('string');
    expect(typeof rows[0].ts).toBe('string');
  });

  test('actor = null (системное/до-идентификационное действие) → actor_id/actor_name пустые строки, не null', () => {
    auditRepo.logAction(null, 'login.fail', 'user', 'unknown-id', { reason: 'not found' });
    const rows = auditRepo.listAudit();
    expect(rows[0].actor_id).toBe('');
    expect(rows[0].actor_name).toBe('');
  });

  test('detail не передан → null, а не "undefined"/"null" строкой', () => {
    auditRepo.logAction({ id: 'u1' }, 'backup.restore', 'system', '');
    const rows = auditRepo.listAudit();
    expect(rows[0].detail).toBeNull();
  });

  test('listAudit фильтрует по actor_id/entity/entity_id', () => {
    auditRepo.logAction({ id: 'u1' }, 'apikey.create', 'apikey', 'k1');
    auditRepo.logAction({ id: 'u2' }, 'apikey.create', 'apikey', 'k2');
    auditRepo.logAction({ id: 'u1' }, 'apikey.revoke', 'apikey', 'k1');

    expect(auditRepo.listAudit({ actor_id: 'u1' })).toHaveLength(2);
    expect(auditRepo.listAudit({ entity: 'apikey', entity_id: 'k2' })).toHaveLength(1);
  });

  test('listAudit сортирует по ts DESC (новые первыми)', () => {
    auditRepo.logAction({ id: 'u1' }, 'a', 'e', '1');
    auditRepo.logAction({ id: 'u1' }, 'b', 'e', '2');
    const rows = auditRepo.listAudit();
    expect(rows[0].action).toBe('b');
    expect(rows[1].action).toBe('a');
  });

  test('limit зажимается в диапазон 1–500 (баг, пойманный на Procure-IT — здесь заложено с нуля)', () => {
    for (let i = 0; i < 5; i++) auditRepo.logAction({ id: 'u1' }, 'a', 'e', String(i));
    expect(auditRepo.listAudit({ limit: '999999' })).toHaveLength(5); // зажато до 500, но записей меньше
    expect(auditRepo.listAudit({ limit: 2 })).toHaveLength(2);
    expect(auditRepo.listAudit({ limit: 0 })).toHaveLength(1); // зажато снизу до 1
    expect(auditRepo.listAudit({ limit: 'not-a-number' })).toHaveLength(5); // невалидное → дефолт 50
  });
});

describe('GET /api/audit — только requireAdmin', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });

  test('оператор (не admin) → 403', async () => {
    const op = mockDb.createUser({ name: 'Audit Op', login: 'auditop', role: 'operator', pin: 'auditpin1' });
    const res = await request(app).get('/api/audit')
      .set({ 'x-user-id': op.id, 'x-edit-password': 'auditpin1' });
    expect(res.status).toBe(403);
  });

  test('admin получает список записей', async () => {
    auditRepo.logAction({ id: 'u1', name: 'Someone' }, 'user.create', 'user', 'u9');
    const res = await request(app).get('/api/audit').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ action: 'user.create', entity: 'user', entity_id: 'u9' });
  });
});

describe('Точки интеграции', () => {
  test('POST /api/users/auth (PIN) — успешный вход пишет login.success', async () => {
    await request(app).post('/api/users/auth').send({ user_id: 'sys-user-admin', pin: 'test123' });
    const rows = auditRepo.listAudit({ action: undefined, entity: 'user' }).filter(r => r.action === 'login.success');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].detail).toMatchObject({ method: 'pin' });
  });

  test('POST /api/users/auth (PIN) — неверный PIN пишет login.fail с actor=null', async () => {
    await request(app).post('/api/users/auth').send({ user_id: 'sys-user-admin', pin: 'wrong-pin' });
    const rows = auditRepo.listAudit().filter(r => r.action === 'login.fail');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actor_id).toBe('');
  });

  test('POST /api/users/login (логин/пароль) — успех и провал', async () => {
    await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
    await request(app).post('/api/users/login').send({ login: 'admin', password: 'wrong' });
    const rows = auditRepo.listAudit();
    expect(rows.some(r => r.action === 'login.success' && r.detail?.method === 'password')).toBe(true);
    expect(rows.some(r => r.action === 'login.fail' && r.detail?.method === 'password')).toBe(true);
  });

  test('создание и отзыв API-ключа пишутся в лог', async () => {
    const created = await request(app).post('/api/api-keys').set(AUTH).send({ name: 'test-key' });
    expect(created.status).toBe(201);
    await request(app).delete(`/api/api-keys/${created.body.id}`).set(AUTH);

    const rows = auditRepo.listAudit();
    expect(rows.some(r => r.action === 'apikey.create' && r.entity_id === created.body.id)).toBe(true);
    expect(rows.some(r => r.action === 'apikey.revoke' && r.entity_id === created.body.id)).toBe(true);
  });

  test('смена роли пользователя пишет user.role_change с from/to', async () => {
    const user = mockDb.createUser({ name: 'Role Target', login: 'roletarget', role: 'viewer', pin: 'rolepin1' });
    await request(app).put(`/api/users/${user.id}`).set(AUTH).send({ role: 'operator' });

    const rows = auditRepo.listAudit().filter(r => r.action === 'user.role_change');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_id: user.id, detail: { from: 'viewer', to: 'operator' } });
  });

  test('update без смены role НЕ пишет user.role_change', async () => {
    const user = mockDb.createUser({ name: 'No Role Change', login: 'norolechange', role: 'viewer', pin: 'rolepin2' });
    await request(app).put(`/api/users/${user.id}`).set(AUTH).send({ name: 'Renamed' });
    expect(auditRepo.listAudit().some(r => r.action === 'user.role_change')).toBe(false);
  });

  test('изменение LDAP-конфига пишет ldap.config_update с fields_changed, без секретов', async () => {
    await request(app).put('/api/settings/ldap-config').set(AUTH).send({ enabled: true, bind_password: 'super-secret' });
    const rows = auditRepo.listAudit().filter(r => r.action === 'ldap.config_update');
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.fields_changed.sort()).toEqual(['bind_password', 'enabled']);
    expect(JSON.stringify(rows[0])).not.toContain('super-secret');
  });
});
