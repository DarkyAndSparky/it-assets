'use strict';
/**
 * Тесты: server/lib/health.js (извлечено из settings.routes.js при
 * реализации HEALTH-1) + GET /api/settings/health. Реальные disk/cert
 * значения не мокаем — тестовое окружение имеет своё настоящее
 * (достаточное) место на диске и обычно без TLS-сертификата, поэтому
 * проверяем СТРУКТУРУ ответа и базовые инварианты, не конкретные
 * пороговые значения (те зависят от машины, где реально бежит тест).
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');
const { checkHealth } = require('../server/lib/health');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

describe('server/lib/health.js::checkHealth()', () => {
  test('возвращает overall и все 4 проверки со статусом ok/warn/error', () => {
    const result = checkHealth();
    expect(['ok', 'warn', 'error']).toContain(result.overall);
    expect(result.checks).toHaveProperty('db');
    expect(result.checks).toHaveProperty('backup');
    expect(result.checks).toHaveProperty('cert');
    expect(result.checks).toHaveProperty('disk');
    for (const check of Object.values(result.checks)) {
      expect(['ok', 'warn', 'error']).toContain(check.status);
      expect(typeof check.detail).toBe('string');
    }
  });

  test('overall = error, если хотя бы одна проверка error (инвариант агрегации)', () => {
    // db-проверка в тестовом окружении реальна и рабочая (SELECT 1 на
    // живую in-memory/temp БД) — здесь просто фиксируем сам принцип
    // агрегации через прямой вызов с реальными данными: если что-то
    // сломано, overall не может быть 'ok'.
    const result = checkHealth();
    const hasError = Object.values(result.checks).some(c => c.status === 'error');
    const hasWarn  = Object.values(result.checks).some(c => c.status === 'warn');
    if (hasError) expect(result.overall).toBe('error');
    else if (hasWarn) expect(result.overall).toBe('warn');
    else expect(result.overall).toBe('ok');
  });
});

describe('GET /api/settings/health', () => {
  test('требует авторизацию', async () => {
    const res = await request(app).get('/api/settings/health');
    expect(res.status).toBe(401);
  });

  test('отдаёт тот же формат, что checkHealth() напрямую', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/settings/health').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('overall');
    expect(res.body).toHaveProperty('checks.db');
    expect(res.body).toHaveProperty('checks.backup');
    expect(res.body).toHaveProperty('checks.cert');
    expect(res.body).toHaveProperty('checks.disk');
  });
});
