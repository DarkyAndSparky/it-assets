'use strict';
/**
 * Тесты: REL-6 — «слоты компонентов» (component_slots), конфигурация
 * для UI-подсказки при привязке связей, НЕ часть field_schemas/META_KEYS
 * (см. обоснование в server/repositories/settings.repo.js).
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

describe('GET/PUT /api/component-slots', () => {
  test('GET требует логин', async () => {
    const res = await request(app).get('/api/component-slots');
    expect(res.status).toBe(401);
  });

  test('GET без сохранённых слотов → пустой объект', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/component-slots').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('PUT требует авторизацию (запись)', async () => {
    const res = await request(app).put('/api/component-slots/PC').send({ slots: [] });
    expect(res.status).toBe(401);
  });

  test('PUT сохраняет слоты для type_code, GET их возвращает', async () => {
    if (!AUTH['x-user-id']) return;
    const slots = [
      { slot_label: 'Видеокарта', target_type_codes: ['GPU'] },
      { slot_label: 'Диск', target_type_codes: ['HDD', 'SSD'] },
    ];
    const put = await request(app).put('/api/component-slots/PC').set(AUTH).send({ slots });
    expect(put.status).toBe(200);
    expect(put.body.slots.length).toBe(2);

    const get = await request(app).get('/api/component-slots').set(AUTH);
    expect(get.body.PC.length).toBe(2);
    expect(get.body.PC[0].slot_label).toBe('Видеокарта');
    expect(get.body.PC[0].target_type_codes).toEqual(['GPU']);
  });

  test('пустой массив слотов удаляет запись для type_code (не хранит пустой массив)', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/component-slots/TempType').set(AUTH).send({
      slots: [{ slot_label: 'X', target_type_codes: [] }],
    });
    await request(app).put('/api/component-slots/TempType').set(AUTH).send({ slots: [] });
    const get = await request(app).get('/api/component-slots').set(AUTH);
    expect(get.body.TempType).toBeUndefined();
  });

  test('slot_label без значения → 400 (валидация)', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/component-slots/PC2').set(AUTH).send({
      slots: [{ slot_label: '', target_type_codes: [] }],
    });
    expect(res.status).toBe(400);
  });

  test('target_type_codes необязателен — дефолтится в пустой массив', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/component-slots/PC3').set(AUTH).send({
      slots: [{ slot_label: 'Просто слот без ограничений' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.slots[0].target_type_codes).toEqual([]);
  });

  test('сервер НЕ проверяет target_type_codes при создании связи — мягкая подсказка, не ограничение целостности', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/component-slots/PC4').set(AUTH).send({
      slots: [{ slot_label: 'Видеокарта', target_type_codes: ['GPU'] }],
    });
    const pc = await request(app).post('/api/assets').set(AUTH).send({ model: 'SlotIgnoreTestPC', tab: 'os' });
    // Компонент НЕ типа GPU — связь должна создаться без препятствий,
    // т.к. проверка типов — только в UI-пикере, не в relations.repo.js.
    const notGpu = await request(app).post('/api/assets').set(AUTH).send({ model: 'SlotIgnoreTestDisk', tab: 'os' });
    const rel = await request(app).post('/api/asset-relations').set(AUTH).send({
      from_asset_id: pc.body.id, to_asset_id: notGpu.body.id,
      relation_type: 'component_of', slot_label: 'Видеокарта',
    });
    expect(rel.status).toBe(201);
  });
});

describe('server/repositories/settings.repo.js — component slots модульные тесты', () => {
  const settingsRepo = require('../server/repositories/settings.repo');

  test('getComponentSlotsForType для несуществующего type_code → пустой массив', () => {
    expect(settingsRepo.getComponentSlotsForType('no-such-type')).toEqual([]);
  });
});
