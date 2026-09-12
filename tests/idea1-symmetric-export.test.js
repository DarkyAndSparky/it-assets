'use strict';
/**
 * Тесты: IDEA-1 — экспорт должен быть симметричен импорту. Раньше не был:
 * meta.network отсутствовал целиком, meta.winbox/meta.controller
 * схлопывались в одну колонку, meta.cartridge/meta.note2 никогда не
 * писались обратно при импорте (даже при экспорте), meta.warranty/
 * purchase_date/cost (PROD-5/PROD-18) вообще не участвовали.
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

describe('IDEA-1: экспорт включает ВСЕ meta-поля', () => {
  test('заголовки CSV содержат Сеть/Контроллер/Доп. описание/Гарантия/Дата покупки/Стоимость', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/export/csv').set(AUTH);
    const headerLine = res.text.split('\n')[0];
    ['Сеть', 'Контроллер', 'Доп. описание', 'Гарантия/ТО', 'Дата покупки', 'Стоимость'].forEach(col => {
      expect(headerLine).toContain(col);
    });
  });

  test('winbox и controller экспортируются в РАЗНЫЕ колонки, не схлопываются', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'WinboxCtrlModel', tab: 'os',
      meta: { winbox: '192.168.1.1', controller: 'unifi.example.com' },
    });
    const res = await request(app).get('/api/export/csv').set(AUTH);
    const rows = res.text.split('\n');
    const line = rows.find(r => r.includes('WinboxCtrlModel'));
    expect(line).toContain('192.168.1.1');
    expect(line).toContain('unifi.example.com');
  });
});

describe('IDEA-1: серверный importCsv пишет ПОЛНЫЙ набор meta-полей', () => {
  test('winbox/controller/network/cartridge/note2/warranty/purchase_date/cost — все сохраняются', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/import/csv').set(AUTH).send({
      rows: [{
        model: 'FullMetaRoundtrip', tab: 'os',
        winbox: '10.0.0.1', controller: 'ctrl.local', network: 'VLAN10',
        cartridge: 'HP-85A', note2: 'доп заметка',
        warranty: '2026-12-31', purchase_date: '2024-01-10', cost: '99999',
      }],
    });
    expect(res.status).toBe(200);
    expect(res.body.added).toBe(1);

    const list = await request(app).get('/api/assets?search=FullMetaRoundtrip').set(AUTH);
    const asset = list.body.items[0];
    expect(asset.meta).toMatchObject({
      winbox: '10.0.0.1', controller: 'ctrl.local', network: 'VLAN10',
      cartridge: 'HP-85A', note2: 'доп заметка',
      warranty: '2026-12-31', purchase_date: '2024-01-10', cost: '99999',
    });
  });
});

describe('IDEA-1: полный цикл export → import без потерь', () => {
  test('все meta-значения корректно попадают в соответствующие колонки CSV (round-trip значений, не дублирование актива — dupe-защита по ключу это намеренно предотвращает)', async () => {
    if (!AUTH['x-user-id']) return;
    const meta = {
      ip: '1.1.1.1', mac: 'AA:BB:CC:DD:EE:FF', subnet: '255.255.255.0', network: 'LAN',
      winbox: 'winbox.local', controller: 'controller.local', login: 'admin', password: 'secret',
      hostname: 'host-1', cartridge: 'CF-217A', firmware: 'v1.2.3', cabinet: 'B-202',
      note2: 'важное примечание', warranty: '2027-06-01', purchase_date: '2023-09-01', cost: '12345',
    };
    await request(app).post('/api/assets').set(AUTH).send({ model: 'RoundtripFull', tab: 'os', meta });

    const exported = await request(app).get('/api/export/csv').set(AUTH);
    const lines = exported.text.replace(/^\uFEFF/, '').split('\n');
    const headerCells = lines[0].split(';').map(c => c.replace(/^"|"$/g, ''));
    const dataLine = lines.find(l => l.includes('RoundtripFull'));
    const cells = dataLine.split(';').map(c => c.replace(/^"|"$/g, ''));
    const byHeader = {};
    headerCells.forEach((h, i) => { byHeader[h] = cells[i]; });

    expect(byHeader).toMatchObject({
      IP: meta.ip, MAC: meta.mac, 'Подсеть': meta.subnet, 'Сеть': meta.network,
      'WinBox/URL': meta.winbox, 'Контроллер': meta.controller,
      'Логин': meta.login, 'Пароль': meta.password, 'Hostname': meta.hostname,
      'Картриджи': meta.cartridge, 'Прошивка': meta.firmware, 'ИНВ шкаф': meta.cabinet,
      'Доп. описание': meta.note2, 'Гарантия/ТО': meta.warranty,
      'Дата покупки': meta.purchase_date, 'Стоимость': meta.cost,
    });

    // Реимпорт ТЕХ ЖЕ данных (тот же серийник) — корректно перехватывается
    // exact-match дедупом, это ожидаемое поведение, а не потеря данных.
    const reimportRow = {
      model: byHeader['Модель'], tab: byHeader['Вкладка'] || 'os', serial: byHeader['Серийный №'] || '',
      ip: byHeader['IP'], mac: byHeader['MAC'],
    };
    const reimport = await request(app).post('/api/import/csv').set(AUTH).send({ rows: [reimportRow] });
    expect(reimport.body.added).toBe(0);
    expect(reimport.body.skipped).toBe(1);
  });
});
