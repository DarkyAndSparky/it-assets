'use strict';
/**
 * Тесты: HEALTH-1 — проактивные уведомления о смене health-статуса
 * (server/lib/notify.js::checkAndNotifyHealth()). Реальную проверку
 * здоровья (server/lib/health.js) мокаем целиком — тестируем логику
 * дедупликации по СМЕНЕ статуса и гейтинг по настройкам, не реальные
 * disk/cert/backup проверки (те тестируются отдельно, если вообще
 * тестируются — см. известный пробел в docs/index.html).
 *
 * ВАЖНО (урок PROD-13/PROD-14): tests/helpers/makeDb.js вызывает
 * jest.resetModules() внутри себя — require() замоканных модулей для
 * получения контролируемой ссылки должен идти СТРОГО ПОСЛЕ makeDb().
 */
jest.mock('../server/lib/health', () => ({
  checkHealth: jest.fn(),
}));

const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');
const notify = require('../server/lib/notify');
const { checkHealth } = require('../server/lib/health');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

let fetchSpy;
beforeEach(() => {
  checkHealth.mockReset();
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => '' });
});
afterEach(() => { fetchSpy.mockRestore(); });

const okResult    = { overall: 'ok',    checks: { db: { status: 'ok', detail: 'OK' } } };
const errorResult = { overall: 'error', checks: { disk: { status: 'error', detail: '0.2 GB свободно (2.0%)' } } };
const warnResult  = { overall: 'warn',  checks: { cert: { status: 'warn', detail: 'Истекает через 10 дн.' } } };

describe('notify.js::checkAndNotifyHealth()', () => {
  test('notify_on_health_issues выключен (дефолт) — ничего не отправляет, даже при overall=error', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: 'https://example.com/health-hook', events: [],
      notify_on_health_issues: false,
    });
    checkHealth.mockReturnValue(errorResult);
    await notify.checkAndNotifyHealth();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('enabled=false целиком — тоже ничего не отправляет, даже если notify_on_health_issues=true', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: false, webhook_url: 'https://example.com/health-hook', events: [],
      notify_on_health_issues: true,
    });
    checkHealth.mockReturnValue(errorResult);
    await notify.checkAndNotifyHealth();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('оба тумблера включены, статус ухудшился → отправляет уведомление', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: 'https://example.com/health-hook', events: [],
      notify_on_health_issues: true,
    });
    checkHealth.mockReturnValue(okResult);
    await notify.checkAndNotifyHealth(); // сначала зафиксировать "ok" как базовое состояние
    await new Promise(r => setTimeout(r, 20));
    fetchSpy.mockClear();

    checkHealth.mockReturnValue(errorResult);
    await notify.checkAndNotifyHealth();
    await new Promise(r => setTimeout(r, 20));
    expect(fetchSpy).toHaveBeenCalled();
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.text).toContain('disk');
  });

  test('дедупликация: повторный вызов с ТЕМ ЖЕ overall не отправляет уведомление снова', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: 'https://example.com/health-hook', events: [],
      notify_on_health_issues: true,
    });
    checkHealth.mockReturnValue(errorResult);
    await notify.checkAndNotifyHealth();
    await new Promise(r => setTimeout(r, 20));
    fetchSpy.mockClear();

    // Тот же error — второй раз подряд, статус не менялся.
    await notify.checkAndNotifyHealth();
    await new Promise(r => setTimeout(r, 20));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('уведомляет и при УЛУЧШЕНИИ статуса (error → ok), не только при ухудшении', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: 'https://example.com/health-hook', events: [],
      notify_on_health_issues: true,
    });
    checkHealth.mockReturnValue(errorResult);
    await notify.checkAndNotifyHealth();
    await new Promise(r => setTimeout(r, 20));
    fetchSpy.mockClear();

    checkHealth.mockReturnValue(okResult);
    await notify.checkAndNotifyHealth();
    await new Promise(r => setTimeout(r, 20));
    expect(fetchSpy).toHaveBeenCalled();
  });

  test('warn тоже считается изменением статуса относительно ok', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: 'https://example.com/health-hook', events: [],
      notify_on_health_issues: true,
    });
    checkHealth.mockReturnValue(okResult);
    await notify.checkAndNotifyHealth();
    await new Promise(r => setTimeout(r, 20));
    fetchSpy.mockClear();

    checkHealth.mockReturnValue(warnResult);
    await notify.checkAndNotifyHealth();
    await new Promise(r => setTimeout(r, 20));
    expect(fetchSpy).toHaveBeenCalled();
  });

  test('ошибка внутри самой checkHealth() не роняет checkAndNotifyHealth', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: 'https://example.com/health-hook', events: [],
      notify_on_health_issues: true,
    });
    checkHealth.mockImplementation(() => { throw new Error('disk read failed'); });
    await expect(notify.checkAndNotifyHealth()).resolves.not.toThrow();
  });
});

describe('PUT /api/settings/notify-config — notify_on_health_issues поле', () => {
  test('сохраняется и возвращается (не секрет, не маскируется)', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, notify_on_health_issues: true, events: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.notify_on_health_issues).toBe(true);
  });
});
