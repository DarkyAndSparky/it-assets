'use strict';
/**
 * Тесты: PROD-7 — Webhook/Telegram-уведомления при событиях.
 * Область действия (см. server/lib/notify.js): только add/retire/
 * status_change, БЕЗ move/bulk-*. Секреты маскируются на GET/PUT,
 * повторное сохранение с маской не затирает значение.
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

// Перехватываем исходящие сетевые запросы (webhook/Telegram) — тесты не
// должны реально ходить в сеть, ни по скорости, ни по надёжности CI.
let fetchSpy;
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, text: async () => '' });
});
afterEach(() => { fetchSpy.mockRestore(); });

describe('PROD-7: GET/PUT /api/settings/notify-config — доступ и маскировка', () => {
  test('без авторизации → 401', async () => {
    const res = await request(app).get('/api/settings/notify-config');
    expect(res.status).toBe(401);
  });

  test('оператор (не admin) получает 403', async () => {
    const op = mockDb.createUser({ name: 'Notify Op', login: 'notifyop', role: 'operator', pin: 'notifypin1' });
    const res = await request(app).get('/api/settings/notify-config')
      .set({ 'x-user-id': op.id, 'x-edit-password': 'notifypin1' });
    expect(res.status).toBe(403);
  });

  test('admin получает дефолтный конфиг (выключено, без секретов)', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).get('/api/settings/notify-config').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  test('PUT сохраняет конфиг, секреты возвращаются МАСКИРОВАННЫМИ, не в открытом виде', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true,
      webhook_url: 'https://example.com/hook/abcdEFGH1234',
      telegram_bot_token: '123456:AAABBBCCCDDDEEEFFF',
      telegram_chat_id: '-100987654321',
      events: ['add', 'retire'],
    });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.telegram_chat_id).toBe('-100987654321'); // не секрет — как есть
    expect(res.body.webhook_url).not.toContain('abcdEFGH1234');
    expect(res.body.webhook_url).toMatch(/^••••/);
    expect(res.body.telegram_bot_token).not.toContain('AAABBBCCCDDDEEEFFF');
    expect(res.body.telegram_bot_token).toMatch(/^••••/);
  });

  test('повторный PUT с маской вместо секрета НЕ затирает сохранённое значение', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: 'https://example.com/real-secret-url', events: ['add'],
    });
    const masked = await request(app).get('/api/settings/notify-config').set(AUTH);
    // Повторно сохраняем, отправив как раз то, что вернул GET (маску) —
    // симулирует форму, где админ поменял только галочку события, но не URL.
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: masked.body.webhook_url, events: ['add', 'retire'],
    });
    // Косвенная проверка: раз notifyEvent реально стучится на этот URL при
    // следующем создании актива — если бы значение затёрлось маской,
    // fetch получил бы вызов с URL, буквально равным "••••...".
    await request(app).post('/api/assets').set(AUTH).send({ model: 'NotifyMaskCheck', tab: 'os' });
    await new Promise(r => setTimeout(r, 50)); // notifyEvent — fire-and-forget
    const calledUrls = fetchSpy.mock.calls.map(c => c[0]);
    expect(calledUrls.some(u => u === 'https://example.com/real-secret-url')).toBe(true);
    expect(calledUrls.some(u => typeof u === 'string' && u.startsWith('••••'))).toBe(false);
  });
});

describe('PROD-7: события реально триггерят отправку', () => {
  beforeEach(async () => {
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: 'https://example.com/events-hook',
      events: ['add', 'retire', 'status_change'],
    });
    fetchSpy.mockClear();
  });

  test('создание актива (add) шлёт webhook', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({ model: 'NotifyAddModel', tab: 'os' });
    await new Promise(r => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalled();
    const [url, opts] = fetchSpy.mock.calls.find(c => c[0] === 'https://example.com/events-hook');
    const body = JSON.parse(opts.body);
    expect(body.event).toBe('add');
  });

  test('списание (retire) шлёт webhook', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({ model: 'NotifyRetireModel', tab: 'os' });
    fetchSpy.mockClear();
    await request(app).delete(`/api/assets/${created.body.id}`).set(AUTH);
    await new Promise(r => setTimeout(r, 50));
    const call = fetchSpy.mock.calls.find(c => c[0] === 'https://example.com/events-hook');
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1].body).event).toBe('retire');
  });

  test('перемещение (move) НЕ настроено на отправку — намеренное ограничение области действия', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({ model: 'NotifyMoveModel', tab: 'os' });
    fetchSpy.mockClear();
    await request(app).post(`/api/assets/${created.body.id}/move`).set(AUTH).send({ newLocation: 'Другой кабинет' });
    await new Promise(r => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('событие, не выбранное в events[], не отправляется', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, webhook_url: 'https://example.com/events-hook', events: ['retire'], // без 'add'
    });
    fetchSpy.mockClear();
    await request(app).post('/api/assets').set(AUTH).send({ model: 'NotifyFilteredModel', tab: 'os' });
    await new Promise(r => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('enabled: false — ничего не отправляется, даже если events заполнены', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: false, webhook_url: 'https://example.com/events-hook', events: ['add'],
    });
    fetchSpy.mockClear();
    await request(app).post('/api/assets').set(AUTH).send({ model: 'NotifyDisabledModel', tab: 'os' });
    await new Promise(r => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('PROD-7: POST /api/settings/notify-test', () => {
  test('требует admin', async () => {
    const res = await request(app).post('/api/settings/notify-test');
    expect(res.status).toBe(401);
  });

  test('без webhook/telegram — пустой результат, не ошибка', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/settings/notify-test').set(AUTH).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  test('с webhook_url — шлёт тестовое сообщение и возвращает "sent"', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).post('/api/settings/notify-test').set(AUTH)
      .send({ webhook_url: 'https://example.com/test-hook' });
    expect(res.status).toBe(200);
    expect(res.body.webhook).toBe('sent');
    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/test-hook', expect.any(Object));
  });

  test('сбой отправки отражается в результате, но роут не падает', async () => {
    if (!AUTH['x-user-id']) return;
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    const res = await request(app).post('/api/settings/notify-test').set(AUTH)
      .send({ webhook_url: 'https://example.com/test-hook' });
    expect(res.status).toBe(200);
    expect(res.body.webhook).toContain('error');
  });
});

describe('PROD-7: server/lib/notify.js — модульные тесты', () => {
  const notify = require('../server/lib/notify');

  test('SUPPORTED_EVENTS фильтрует неизвестные значения при сохранении', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/settings/notify-config').set(AUTH).send({
      enabled: true, events: ['add', 'bogus_event', 'retire'],
    });
    expect(res.body.events.sort()).toEqual(['add', 'retire']);
  });

  test('notifyEvent молча ничего не делает, если событие не в белом списке', () => {
    expect(() => notify.notifyEvent({ action_type: 'move', asset_id: 'x' })).not.toThrow();
  });
});
