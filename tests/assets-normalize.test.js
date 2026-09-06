'use strict';
const makeDb = require('./helpers/makeDb');

// BUG-4: org/filial/location — id должен и проставляться при записи
// (create/update/move), и разрешаться в актуальное имя при чтении, а не
// оставаться замороженным снапшотом после переименования справочника.

describe('BUG-4: normalizeAsset — filial/location/org id+snapshot', () => {
  test('createAsset проставляет filial_id/location_id/org_id по имени из справочника', () => {
    const db = makeDb();
    const assetsRepo = jest.requireActual('../server/repositories/assets.repo');
    const org    = db.config.createOrg({ name: 'ООО Ромашка', short_code: 'ROM' });
    const filial = db.config.createFilial({ name: 'Филиал Центр', address: '' });
    const loc    = db.config.createLocation({ name: 'Каб. 101', filial_id: filial.id, type: 'office' });

    const { id } = assetsRepo.createAsset({
      model: 'ThinkPad X1', org: org.name, filial: filial.name, location: loc.name,
    }, 'tester');

    const raw = assetsRepo.getAllAssets().find(a => a.id === id);
    expect(raw.org_id).toBe(org.id);
    expect(raw.filial_id).toBe(filial.id);
    expect(raw.location_id).toBe(loc.id);
  });

  test('переименование филиала/локации/орг подтягивается в normalizeAsset без обновления актива', () => {
    const db = makeDb();
    const assetsRepo = jest.requireActual('../server/repositories/assets.repo');
    const org    = db.config.createOrg({ name: 'ООО Старт', short_code: 'STR' });
    const filial = db.config.createFilial({ name: 'Филиал Юг', address: '' });
    const loc    = db.config.createLocation({ name: 'Склад А', filial_id: filial.id, type: 'office' });

    const { id } = assetsRepo.createAsset({
      model: 'Dell 24"', org: org.name, filial: filial.name, location: loc.name,
    }, 'tester');

    db.config.renameOrg(org.id, 'ООО Старт Плюс', 'tester');
    db.config.updateFilial(filial.id, { name: 'Филиал Юг (новый)' });
    db.config.updateLocation(loc.id, { name: 'Склад А-2' });

    const fetched = assetsRepo.getAssetById(id);
    expect(fetched.org).toBe('ООО Старт Плюс');
    expect(fetched.filial).toBe('Филиал Юг (новый)');
    expect(fetched.location).toBe('Склад А-2');

    const [listed] = assetsRepo.listAssets({}).items.filter(a => a.id === id);
    expect(listed.org).toBe('ООО Старт Плюс');
    expect(listed.filial).toBe('Филиал Юг (новый)');
    expect(listed.location).toBe('Склад А-2');
  });

  test('moveAsset переносит id вместе с новым снапшотом филиала/локации', () => {
    const db = makeDb();
    const assetsRepo = jest.requireActual('../server/repositories/assets.repo');
    const filialA = db.config.createFilial({ name: 'Филиал А', address: '' });
    const filialB = db.config.createFilial({ name: 'Филиал Б', address: '' });
    const locB    = db.config.createLocation({ name: 'Место Б', filial_id: filialB.id, type: 'office' });

    const { id } = assetsRepo.createAsset({ model: 'Моноблок', filial: filialA.name }, 'tester');
    assetsRepo.moveAsset(id, { newFilial: filialB.name, newLocation: locB.name }, 'tester');

    const raw = assetsRepo.getAllAssets().find(a => a.id === id);
    expect(raw.filial_id).toBe(filialB.id);
    expect(raw.location_id).toBe(locB.id);

    db.config.updateFilial(filialB.id, { name: 'Филиал Б (переименован)' });
    const fetched = assetsRepo.getAssetById(id);
    expect(fetched.filial).toBe('Филиал Б (переименован)');
  });

  test('id не найден в справочнике (свободный текст org) — падаем на снапшот, без ошибок', () => {
    const db = makeDb();
    const assetsRepo = jest.requireActual('../server/repositories/assets.repo');
    const { id } = assetsRepo.createAsset({ model: 'Принтер', org: 'Внешний контрагент, не в справочнике' }, 'tester');
    const fetched = assetsRepo.getAssetById(id);
    expect(fetched.org).toBe('Внешний контрагент, не в справочнике');
  });
});
