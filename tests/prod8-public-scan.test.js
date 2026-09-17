'use strict';
/**
 * Тесты: PROD-8 — GET /api/public/scan (страница /scan, без логина).
 * Ключевое: НЕТ requireAuth, но результат — заведомо безопасное
 * подмножество полей (см. assetsRepo.getPublicAssetInfo()).
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

describe('PROD-8: GET /api/public/scan', () => {
  test('работает БЕЗ авторизации (весь смысл фичи) — отсутствие AUTH-заголовков не даёт 401', async () => {
    const res = await request(app).get('/api/public/scan?code=ANY');
    expect(res.status).not.toBe(401);
  });

  test('без code → 400', async () => {
    const res = await request(app).get('/api/public/scan');
    expect(res.status).toBe(400);
  });

  test('несуществующий код → 404, не 500 и не пустой массив', async () => {
    const res = await request(app).get('/api/public/scan?code=NO-SUCH-CODE-XYZ');
    expect(res.status).toBe(404);
  });

  test('находит по точному инв.номеру', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'ScanTestModel', tab: 'os', serial: 'SN-SCAN-001',
      meta: { login: 'admin', password: 'supersecret', ip: '10.0.0.5' },
    });
    const invRes = await request(app).put(`/api/assets/${created.body.id}`).set(AUTH).send({ inv: 'INV-SCAN-TEST-001' });
    void invRes;
    const asset = await request(app).get(`/api/assets/${created.body.id}`).set(AUTH);
    const inv = asset.body.inv || 'INV-SCAN-TEST-001';

    const res = await request(app).get('/api/public/scan?code=' + encodeURIComponent(inv));
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('ScanTestModel');
  });

  test('находит по серийному номеру, включая QR-стиль префикс SN:', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'ScanBySerialModel', tab: 'os', serial: 'SN-UNIQUE-777',
    });
    const res = await request(app).get('/api/public/scan?code=' + encodeURIComponent('SN:SN-UNIQUE-777'));
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('ScanBySerialModel');
    expect(res.body.serial).toBe('SN-UNIQUE-777');
  });

  test('поиск по инв.номеру с QR-стиль префиксом INV: и регистронезависимо', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'ScanCaseModel', tab: 'os', serial: 'sn-mixed-case-42',
    });
    void created;
    const res = await request(app).get('/api/public/scan?code=' + encodeURIComponent('SN:SN-MIXED-CASE-42'));
    expect(res.status).toBe(200);
    expect(res.body.model).toBe('ScanCaseModel');
  });

  test('СПИСАННЫЙ актив не находится (как и в остальном API)', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({
      model: 'ScanRetiredModel', tab: 'os', serial: 'SN-RETIRED-999',
    });
    await request(app).delete(`/api/assets/${created.body.id}`).set(AUTH);
    const res = await request(app).get('/api/public/scan?code=' + encodeURIComponent('SN-RETIRED-999'));
    expect(res.status).toBe(404);
  });

  test('SEC: ответ НИКОГДА не содержит meta (login/password/ip/mac и т.п.)', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'ScanSecretsModel', tab: 'os', serial: 'SN-SECRETS-001',
      meta: { login: 'root', password: 'hunter2', ip: '192.168.1.1', mac: 'AA:BB:CC:DD:EE:FF' },
    });
    const res = await request(app).get('/api/public/scan?code=' + encodeURIComponent('SN-SECRETS-001'));
    expect(res.status).toBe(200);
    expect(res.body.meta).toBeUndefined();
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('root');
    expect(raw).not.toContain('192.168.1.1');
    expect(raw).not.toContain('AA:BB:CC:DD:EE:FF');
  });

  test('SEC: ответ не содержит имя ответственного сотрудника (персональные данные)', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'ScanResponsibleModel', tab: 'os', serial: 'SN-RESP-001', responsible: 'Иванов Иван Иванович',
    });
    const res = await request(app).get('/api/public/scan?code=' + encodeURIComponent('SN-RESP-001'));
    expect(res.status).toBe(200);
    expect(res.body.responsible).toBeUndefined();
  });

  test('только whitelist-поля в ответе', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({
      model: 'ScanWhitelistModel', tab: 'os', serial: 'SN-WL-001', org: 'ООО Тест', note: 'секретная заметка',
    });
    const res = await request(app).get('/api/public/scan?code=' + encodeURIComponent('SN-WL-001'));
    const allowed = ['model', 'type', 'category', 'serial', 'inv', 'status', 'tab', 'filial', 'location'];
    Object.keys(res.body).forEach(k => expect(allowed).toContain(k));
  });
});

describe('PROD-8: assetsRepo.getPublicAssetInfo — модульные тесты', () => {
  test('пустой/отсутствующий код → null, не исключение', () => {
    const assetsRepo = require('../server/repositories/assets.repo');
    expect(assetsRepo.getPublicAssetInfo('')).toBeNull();
    expect(assetsRepo.getPublicAssetInfo(null)).toBeNull();
    expect(assetsRepo.getPublicAssetInfo(undefined)).toBeNull();
  });
});

describe('PROD-8: /scan.html — соответствие глобальному CSP (script-src \'self\')', () => {
  // Регрессия: изначально JS страницы был инлайн-<script>, что глобальный
  // CSP-заголовок (server/index.js, "script-src 'self'" без 'unsafe-inline')
  // молча блокирует в браузере — страница открывалась бы, но JS не
  // выполнялся бы вообще. Исправлено переносом в public/js/scan.js
  // (найдено и исправлено в рамках PROD-12, не изначально).
  test('в HTML нет инлайн-<script> с кодом — только внешние <script src=...>', async () => {
    const res = await request(app).get('/scan.html');
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>[^<]*\S[^<]*<\/script>/);
    expect(res.text).toContain('<script src="/js/scan.js">');
  });

  test('ответ сервера несёт CSP script-src \'self\' (страница отдаётся тем же middleware, что и весь сайт)', async () => {
    const res = await request(app).get('/scan.html');
    const csp = res.headers['content-security-policy'] || '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
  });
});

