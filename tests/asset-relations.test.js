'use strict';
/**
 * Тесты: универсальные связи между активами (asset_relations, вариант C
 * из обсуждения архитектуры составных активов). Ядро без UI-интеграции
 * (тип поля asset_ref в схеме типов — отдельный, следующий шаг).
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

async function makeAsset(model, extra = {}) {
  const res = await request(app).post('/api/assets').set(AUTH).send({ model, tab: 'os', ...extra });
  return res.body.id;
}

describe('POST /api/asset-relations', () => {
  test('требует авторизацию', async () => {
    const res = await request(app).post('/api/asset-relations').send({});
    expect(res.status).toBe(401);
  });

  test('неизвестный relation_type → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const a = await makeAsset('RelTestA1');
    const b = await makeAsset('RelTestB1');
    const res = await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: a, to_asset_id: b, relation_type: 'bogus_type' });
    expect(res.status).toBe(400);
  });

  test('актив сам с собой → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const a = await makeAsset('RelTestSelf');
    const res = await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: a, to_asset_id: a, relation_type: 'component_of' });
    expect(res.status).toBe(400);
  });

  test('несуществующий from_asset_id → 404', async () => {
    if (!AUTH['x-user-id']) return;
    const b = await makeAsset('RelTestB2');
    const res = await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: 'no-such-id', to_asset_id: b, relation_type: 'component_of' });
    expect(res.status).toBe(404);
  });

  test('несуществующий to_asset_id → 404', async () => {
    if (!AUTH['x-user-id']) return;
    const a = await makeAsset('RelTestA3');
    const res = await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: a, to_asset_id: 'no-such-id', relation_type: 'component_of' });
    expect(res.status).toBe(404);
  });

  test('успешное создание → 201, вернувшаяся запись содержит id/created_at', async () => {
    if (!AUTH['x-user-id']) return;
    const pc = await makeAsset('RelTestPC1');
    const disk = await makeAsset('RelTestDisk1');
    const res = await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: pc, to_asset_id: disk, relation_type: 'component_of', slot_label: 'Диск 1' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.relation_type).toBe('component_of');
    expect(res.body.slot_label).toBe('Диск 1');
  });

  describe('кардинальность (component_of — один родитель на компонент)', () => {
    test('привязать уже привязанный компонент к ДРУГОМУ родителю → 400', async () => {
      if (!AUTH['x-user-id']) return;
      const pc1 = await makeAsset('RelCardPC1');
      const pc2 = await makeAsset('RelCardPC2');
      const disk = await makeAsset('RelCardDisk');
      const first = await request(app).post('/api/asset-relations').set(AUTH)
        .send({ from_asset_id: pc1, to_asset_id: disk, relation_type: 'component_of' });
      expect(first.status).toBe(201);
      const second = await request(app).post('/api/asset-relations').set(AUTH)
        .send({ from_asset_id: pc2, to_asset_id: disk, relation_type: 'component_of' });
      expect(second.status).toBe(400);
    });

    test('один родитель может иметь НЕСКОЛЬКО компонентов одного типа связи (2 диска)', async () => {
      if (!AUTH['x-user-id']) return;
      const pc = await makeAsset('RelMultiPC');
      const disk1 = await makeAsset('RelMultiDisk1');
      const disk2 = await makeAsset('RelMultiDisk2');
      const r1 = await request(app).post('/api/asset-relations').set(AUTH)
        .send({ from_asset_id: pc, to_asset_id: disk1, relation_type: 'component_of' });
      const r2 = await request(app).post('/api/asset-relations').set(AUTH)
        .send({ from_asset_id: pc, to_asset_id: disk2, relation_type: 'component_of' });
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
    });

    test('после отвязки компонент можно привязать к другому родителю', async () => {
      if (!AUTH['x-user-id']) return;
      const pc1 = await makeAsset('RelReattachPC1');
      const pc2 = await makeAsset('RelReattachPC2');
      const disk = await makeAsset('RelReattachDisk');
      const first = await request(app).post('/api/asset-relations').set(AUTH)
        .send({ from_asset_id: pc1, to_asset_id: disk, relation_type: 'component_of' });
      await request(app).delete(`/api/asset-relations/${first.body.id}`).set(AUTH);
      const second = await request(app).post('/api/asset-relations').set(AUTH)
        .send({ from_asset_id: pc2, to_asset_id: disk, relation_type: 'component_of' });
      expect(second.status).toBe(201);
    });
  });

  test('SEC: прямой цикл (B→A, когда уже есть A→B того же типа) → 400', async () => {
    if (!AUTH['x-user-id']) return;
    const a = await makeAsset('RelCycleA');
    const b = await makeAsset('RelCycleB');
    const first = await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: a, to_asset_id: b, relation_type: 'component_of' });
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: b, to_asset_id: a, relation_type: 'component_of' });
    expect(second.status).toBe(400);
  });
});

describe('GET /api/assets/:id/relations', () => {
  test('требует авторизацию', async () => {
    const res = await request(app).get('/api/assets/nonexistent/relations');
    expect(res.status).toBe(401);
  });

  test('несуществующий актив → 404', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/assets/no-such-id/relations').set(AUTH);
    expect(res.status).toBe(404);
  });

  test('родитель видит компонент в списке связей (direction=from)', async () => {
    if (!AUTH['x-user-id']) return;
    const pc = await makeAsset('RelListPC');
    const disk = await makeAsset('RelListDisk', { serial: 'SN-REL-LIST-1' });
    await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: pc, to_asset_id: disk, relation_type: 'component_of', slot_label: 'Диск 1' });

    const res = await request(app).get(`/api/assets/${pc}/relations`).set(AUTH);
    expect(res.status).toBe(200);
    const link = res.body.find(r => r.other_asset_id === disk);
    expect(link).toBeTruthy();
    expect(link.direction).toBe('from');
    expect(link.other.model).toBe('RelListDisk');
    expect(link.other.serial).toBe('SN-REL-LIST-1');
    expect(link.slot_label).toBe('Диск 1');
  });

  test('компонент видит родителя в списке связей (direction=to)', async () => {
    if (!AUTH['x-user-id']) return;
    const pc = await makeAsset('RelReversePC');
    const disk = await makeAsset('RelReverseDisk');
    await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: pc, to_asset_id: disk, relation_type: 'component_of' });

    const res = await request(app).get(`/api/assets/${disk}/relations`).set(AUTH);
    const link = res.body.find(r => r.other_asset_id === pc);
    expect(link).toBeTruthy();
    expect(link.direction).toBe('to');
    expect(link.other.model).toBe('RelReversePC');
  });
});

describe('DELETE /api/asset-relations/:id', () => {
  test('требует авторизацию', async () => {
    const res = await request(app).delete('/api/asset-relations/nonexistent');
    expect(res.status).toBe(401);
  });

  test('несуществующая связь → 404', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).delete('/api/asset-relations/no-such-id').set(AUTH);
    expect(res.status).toBe(404);
  });

  test('удаление реально убирает связь из обоих списков', async () => {
    if (!AUTH['x-user-id']) return;
    const pc = await makeAsset('RelDeletePC');
    const disk = await makeAsset('RelDeleteDisk');
    const created = await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: pc, to_asset_id: disk, relation_type: 'component_of' });
    const del = await request(app).delete(`/api/asset-relations/${created.body.id}`).set(AUTH);
    expect(del.status).toBe(200);

    const pcRelations = await request(app).get(`/api/assets/${pc}/relations`).set(AUTH);
    const diskRelations = await request(app).get(`/api/assets/${disk}/relations`).set(AUTH);
    expect(pcRelations.body.find(r => r.other_asset_id === disk)).toBeUndefined();
    expect(diskRelations.body.find(r => r.other_asset_id === pc)).toBeUndefined();
  });
});

describe('История (симметрично move/status_change)', () => {
  test('привязка пишет запись в историю ОБОИХ активов', async () => {
    if (!AUTH['x-user-id']) return;
    const pc = await makeAsset('RelHistPC');
    const disk = await makeAsset('RelHistDisk');
    await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: pc, to_asset_id: disk, relation_type: 'component_of' });

    const pcHist = await request(app).get(`/api/history?asset_id=${pc}`).set(AUTH);
    const diskHist = await request(app).get(`/api/history?asset_id=${disk}`).set(AUTH);
    expect(pcHist.body.items.some(h => h.action_type === 'relation_add')).toBe(true);
    expect(diskHist.body.items.some(h => h.action_type === 'relation_add')).toBe(true);
  });

  test('отвязка пишет relation_remove в историю обоих', async () => {
    if (!AUTH['x-user-id']) return;
    const pc = await makeAsset('RelHistRemovePC');
    const disk = await makeAsset('RelHistRemoveDisk');
    const created = await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: pc, to_asset_id: disk, relation_type: 'component_of' });
    await request(app).delete(`/api/asset-relations/${created.body.id}`).set(AUTH);

    const pcHist = await request(app).get(`/api/history?asset_id=${pc}`).set(AUTH);
    expect(pcHist.body.items.some(h => h.action_type === 'relation_remove')).toBe(true);
  });
});

describe('Списание не блокирует и не каскадит на связи', () => {
  test('списанный родитель — связь остаётся видна на компоненте', async () => {
    if (!AUTH['x-user-id']) return;
    const pc = await makeAsset('RelRetirePC');
    const disk = await makeAsset('RelRetireDisk');
    await request(app).post('/api/asset-relations').set(AUTH)
      .send({ from_asset_id: pc, to_asset_id: disk, relation_type: 'component_of' });

    const retireRes = await request(app).delete(`/api/assets/${pc}`).set(AUTH);
    expect(retireRes.status).toBe(200);

    const diskRelations = await request(app).get(`/api/assets/${disk}/relations`).set(AUTH);
    expect(diskRelations.body.some(r => r.other_asset_id === pc)).toBe(true);
  });
});

describe('server/repositories/relations.repo.js — модульные тесты', () => {
  const relationsRepo = require('../server/repositories/relations.repo');

  test('SUPPORTED_RELATION_TYPES содержит component_of', () => {
    expect(relationsRepo.SUPPORTED_RELATION_TYPES).toContain('component_of');
  });

  test('listRelationsForAsset для актива без связей → пустой массив', () => {
    expect(relationsRepo.listRelationsForAsset('no-such-asset-id')).toEqual([]);
  });
});
