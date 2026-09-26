'use strict';
/**
 * Тесты: WH-1 (Track 13) — «держатель склада» (МОЛ),
 * locations.responsible_id/responsible.
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
let filialId;
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
  const filial = mockDb.config.createFilial({ name: 'WH-1 Test Filial', address: '' });
  filialId = filial.id;
});

async function makeEmployee(name) {
  const res = await request(app).post('/api/employees').set(AUTH).send({ name });
  return res.body.id;
}

describe('POST /api/locations — responsible_id при создании', () => {
  test('без responsible_id → responsible пустой (необязательное поле)', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/locations').set(AUTH)
      .send({ name: 'WH-1 Loc No Custodian', filial_id: filialId, type: 'warehouse' });
    expect(res.status).toBe(200);
    expect(res.body.responsible_id).toBeFalsy();
    expect(res.body.responsible).toBe('');
  });

  test('с responsible_id → responsible (имя) заполняется автоматически (снапшот)', async () => {
    if (!AUTH['x-user-id']) return;
    const empId = await makeEmployee('Кладовщик Иванов');
    const res = await request(app).post('/api/locations').set(AUTH)
      .send({ name: 'WH-1 Loc With Custodian', filial_id: filialId, type: 'warehouse', responsible_id: empId });
    expect(res.status).toBe(200);
    expect(res.body.responsible_id).toBe(empId);
    expect(res.body.responsible).toBe('Кладовщик Иванов');
  });

  test('несуществующий responsible_id → трактуется как "без держателя", не 400/500', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/locations').set(AUTH)
      .send({ name: 'WH-1 Loc Bad Custodian', filial_id: filialId, type: 'warehouse', responsible_id: 'no-such-employee' });
    expect(res.status).toBe(200);
    expect(res.body.responsible_id).toBeFalsy();
    expect(res.body.responsible).toBe('');
  });
});

describe('PUT /api/locations/:id — изменение держателя', () => {
  test('назначить держателя существующей локации', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/locations').set(AUTH)
      .send({ name: 'WH-1 Loc To Assign', filial_id: filialId, type: 'warehouse' });
    const empId = await makeEmployee('Кладовщик Петров');
    const res = await request(app).put(`/api/locations/${created.body.id}`).set(AUTH)
      .send({ responsible_id: empId });
    expect(res.status).toBe(200);
    expect(res.body.responsible).toBe('Кладовщик Петров');
  });

  test('очистить держателя пустой строкой', async () => {
    if (!AUTH['x-user-id']) return;
    const empId = await makeEmployee('Кладовщик Сидоров');
    const created = await request(app).post('/api/locations').set(AUTH)
      .send({ name: 'WH-1 Loc To Clear', filial_id: filialId, type: 'warehouse', responsible_id: empId });
    expect(created.body.responsible).toBe('Кладовщик Сидоров');

    const res = await request(app).put(`/api/locations/${created.body.id}`).set(AUTH)
      .send({ responsible_id: '' });
    expect(res.status).toBe(200);
    expect(res.body.responsible_id).toBeFalsy();
    expect(res.body.responsible).toBe('');
  });

  test('смена держателя на другого сотрудника — старое имя не остаётся', async () => {
    if (!AUTH['x-user-id']) return;
    const emp1 = await makeEmployee('Кладовщик Первый');
    const emp2 = await makeEmployee('Кладовщик Второй');
    const created = await request(app).post('/api/locations').set(AUTH)
      .send({ name: 'WH-1 Loc Reassign', filial_id: filialId, type: 'warehouse', responsible_id: emp1 });
    const res = await request(app).put(`/api/locations/${created.body.id}`).set(AUTH)
      .send({ responsible_id: emp2 });
    expect(res.body.responsible).toBe('Кладовщик Второй');
    expect(res.body.responsible).not.toContain('Первый');
  });

  test('PUT без поля responsible_id — держатель НЕ трогается (частичное обновление)', async () => {
    if (!AUTH['x-user-id']) return;
    const empId = await makeEmployee('Кладовщик Нетронутый');
    const created = await request(app).post('/api/locations').set(AUTH)
      .send({ name: 'WH-1 Loc Untouched', filial_id: filialId, type: 'warehouse', responsible_id: empId });
    const res = await request(app).put(`/api/locations/${created.body.id}`).set(AUTH)
      .send({ name: 'WH-1 Loc Untouched Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.responsible).toBe('Кладовщик Нетронутый');
  });
});

describe('GET /api/locations — responsible/responsible_id в списке', () => {
  test('поля присутствуют в ответе списка (не только single GET)', async () => {
    if (!AUTH['x-user-id']) return;
    const empId = await makeEmployee('Кладовщик Списочный');
    await request(app).post('/api/locations').set(AUTH)
      .send({ name: 'WH-1 Loc In List', filial_id: filialId, type: 'warehouse', responsible_id: empId });
    const res = await request(app).get('/api/locations').set(AUTH);
    const loc = res.body.find(l => l.name === 'WH-1 Loc In List');
    expect(loc).toBeTruthy();
    expect(loc.responsible).toBe('Кладовщик Списочный');
  });
});

describe('server/repositories/locations.repo.js — модульные тесты', () => {
  const locationsRepo = require('../server/repositories/locations.repo');

  test('createLocation без responsible_id не падает', () => {
    expect(() => locationsRepo.createLocation({ name: 'WH-1 Direct', filial_id: filialId })).not.toThrow();
  });
});
