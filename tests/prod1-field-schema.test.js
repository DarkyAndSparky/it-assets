'use strict';
/**
 * Тесты: PROD-1 (схема типизированных полей по type_code) и PROD-3
 * (серверная валидация meta по этой схеме).
 */
const makeDb = require('./helpers/makeDb');

describe('PROD-1: db.getFieldSchema/setFieldSchema', () => {
  test('без сохранённой схемы возвращает null', () => {
    const db = makeDb();
    expect(db.getFieldSchema('NB')).toBeNull();
  });

  test('setFieldSchema сохраняет и getFieldSchema отдаёт обратно', () => {
    const db = makeDb();
    const fields = [
      { key: 'ip', type: 'ip', required: false },
      { key: 'mac', type: 'text' },
    ];
    db.setFieldSchema('NB', fields);
    expect(db.getFieldSchema('NB')).toEqual(fields);
    expect(db.getFieldSchema('OTHER')).toBeNull();
  });

  test('setFieldSchema(code, null) сбрасывает схему на дефолт', () => {
    const db = makeDb();
    db.setFieldSchema('NB', [{ key: 'ip', type: 'ip' }]);
    expect(db.getFieldSchema('NB')).not.toBeNull();
    db.setFieldSchema('NB', null);
    expect(db.getFieldSchema('NB')).toBeNull();
  });

  test('getFieldSchemas отдаёт карту по всем типам сразу', () => {
    const db = makeDb();
    db.setFieldSchema('NB', [{ key: 'ip', type: 'ip' }]);
    db.setFieldSchema('PR', [{ key: 'hostname', type: 'text' }]);
    const all = db.getFieldSchemas();
    expect(Object.keys(all).sort()).toEqual(['NB', 'PR']);
  });
});

describe('PROD-3: валидация meta по схеме при create/update ассета', () => {
  let db, assetsRepo;

  beforeEach(() => {
    db = makeDb();
    assetsRepo = jest.requireActual('../server/repositories/assets.repo');
    db.setTypeCodes([{ code: 'NB', name: 'Ноутбук', tab: 'os' }]);
  });

  test('без схемы у типа — meta не проверяется (обратная совместимость)', () => {
    expect(() => assetsRepo.createAsset({
      model: 'ThinkPad', type: 'Ноутбук', meta: { ip: 'не похоже на IP вообще' },
    }, 'tester')).not.toThrow();
  });

  test('со схемой — невалидный ip отклоняется 400-подобной ошибкой', () => {
    db.setFieldSchema('NB', [{ key: 'ip', type: 'ip' }]);
    expect(() => assetsRepo.createAsset({
      model: 'ThinkPad', type: 'Ноутбук', meta: { ip: 'не ip' },
    }, 'tester')).toThrow(/ip/);
  });

  test('со схемой — валидный ip проходит', () => {
    db.setFieldSchema('NB', [{ key: 'ip', type: 'ip' }]);
    expect(() => assetsRepo.createAsset({
      model: 'ThinkPad', type: 'Ноутбук', meta: { ip: '192.168.1.1' },
    }, 'tester')).not.toThrow();
  });

  test('required-поле, отсутствующее в meta — отклоняется', () => {
    db.setFieldSchema('NB', [{ key: 'inv', type: 'text', required: true, label: 'Инв. номер' }]);
    expect(() => assetsRepo.createAsset({
      model: 'ThinkPad', type: 'Ноутбук', meta: {},
    }, 'tester')).toThrow(/обязательно/);
  });

  test('select-поле со значением вне options — отклоняется', () => {
    db.setFieldSchema('NB', [{ key: 'network', type: 'select', options: ['LAN', 'WiFi'] }]);
    expect(() => assetsRepo.createAsset({
      model: 'ThinkPad', type: 'Ноутбук', meta: { network: 'Bluetooth' },
    }, 'tester')).toThrow(/network/);
  });

  test('select-поле со значением из options — проходит', () => {
    db.setFieldSchema('NB', [{ key: 'network', type: 'select', options: ['LAN', 'WiFi'] }]);
    expect(() => assetsRepo.createAsset({
      model: 'ThinkPad', type: 'Ноутбук', meta: { network: 'WiFi' },
    }, 'tester')).not.toThrow();
  });

  test('number-поле с нечисловым значением — отклоняется', () => {
    db.setFieldSchema('NB', [{ key: 'note2', type: 'number' }]);
    expect(() => assetsRepo.createAsset({
      model: 'ThinkPad', type: 'Ноутбук', meta: { note2: 'abc' },
    }, 'tester')).toThrow(/note2/);
  });

  test('updateAsset валидирует слитый результат (existing + патч), required не даёт ложных срабатываний', () => {
    db.setFieldSchema('NB', [{ key: 'inv', type: 'text', required: true }]);
    const { id } = assetsRepo.createAsset({ model: 'ThinkPad', type: 'Ноутбук', meta: { inv: 'INV-1' } }, 'tester');
    // Патчим только mac, не трогая inv — required для inv должен считаться
    // выполненным за счёт уже сохранённого значения, а не падать.
    expect(() => assetsRepo.updateAsset(id, { meta: { mac: 'AA:BB:CC:DD:EE:FF' } }, 'tester')).not.toThrow();
  });

  test('updateAsset отклоняет патч, стирающий required-поле в пустую строку', () => {
    db.setFieldSchema('NB', [{ key: 'inv', type: 'text', required: true }]);
    const { id } = assetsRepo.createAsset({ model: 'ThinkPad', type: 'Ноутбук', meta: { inv: 'INV-1' } }, 'tester');
    expect(() => assetsRepo.updateAsset(id, { meta: { inv: '' } }, 'tester')).toThrow(/обязательно/);
  });
});
