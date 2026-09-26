'use strict';
/**
 * Тесты: PROD-13 — LDAP/AD аутентификация. Реального LDAP-сервера нет —
 * мокаем `ldapts` целиком, управляем поведением bind/search/unbind по
 * сценарию в каждом тесте. Особое внимание — на КРИТИЧНЫЕ security-кейсы,
 * описанные в шапке server/lib/ldap.js (anonymous bind, LDAP injection,
 * неоднозначный поиск).
 */
jest.mock('ldapts', () => {
  const mockBind = jest.fn();
  const mockSearch = jest.fn();
  const mockUnbind = jest.fn().mockResolvedValue(undefined);
  class Client {
    constructor(opts) { this.opts = opts; }
    bind(...args) { return mockBind(...args); }
    search(...args) { return mockSearch(...args); }
    unbind(...args) { return mockUnbind(...args); }
  }
  return {
    Client,
    Filter: { escape: (v) => String(v).replace(/[()\\*\0]/g, (c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0')) },
    __mockBind: mockBind, __mockSearch: mockSearch, __mockUnbind: mockUnbind,
  };
});

const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

// ВАЖНО: makeDb() внутри себя вызывает jest.resetModules() (см.
// tests/helpers/makeDb.js) — это обнуляет модульный кеш, включая уже
// инстанцированный factory-мок 'ldapts' (если бы require('ldapts')
// случился ДО этой строки). Поэтому require('ldapts') — СТРОГО ПОСЛЕ
// makeDb(), иначе объект __mockBind/__mockSearch в тестах окажется другим
// экземпляром, чем тот, что реально использует server/lib/ldap.js
// (симптом: mockImplementation'ы тихо не применяются, потому что настроен
// "не тот" jest.fn()).
const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');
const ldap = require('../server/lib/ldap');
const { __mockBind: mockBind, __mockSearch: mockSearch, __mockUnbind: mockUnbind } = require('ldapts');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

beforeEach(() => {
  mockBind.mockReset();
  mockSearch.mockReset();
  mockUnbind.mockClear();
});

const BASE_CFG = {
  enabled: true, url: 'ldap://ldap.example.internal:389',
  bind_dn: 'cn=svc,dc=example,dc=com', bind_password: 'svcpass',
  base_dn: 'dc=example,dc=com', user_filter: '(uid={{username}})',
  default_role: 'viewer', auto_create_users: false,
};

describe('PROD-13: server/lib/ldap.js — authenticateAndSync()', () => {
  test('LDAP выключен — null БЕЗ единого обращения к серверу (perf/safety)', async () => {
    ldap.setConfig({ ...BASE_CFG, enabled: false });
    const res = await ldap.authenticateAndSync('someone', 'pw');
    expect(res).toBeNull();
    expect(mockBind).not.toHaveBeenCalled();
  });

  test('SEC: пустой пароль отклоняется ДО обращения к LDAP (anonymous bind protection)', async () => {
    ldap.setConfig(BASE_CFG);
    const res = await ldap.authenticateAndSync('someone', '');
    expect(res).toBeNull();
    expect(mockBind).not.toHaveBeenCalled();
  });

  test('SEC: пустой логин тоже отклоняется до LDAP', async () => {
    ldap.setConfig(BASE_CFG);
    const res = await ldap.authenticateAndSync('', 'somepassword');
    expect(res).toBeNull();
    expect(mockBind).not.toHaveBeenCalled();
  });

  test('успешный поиск + успешный бинд пользователя → существующий локальный юзер возвращается', async () => {
    ldap.setConfig(BASE_CFG);
    const existing = mockDb.createUser({ name: 'LDAP Existing', login: 'ldapexisting', role: 'operator', pin: 'somepin12' });
    mockBind.mockResolvedValue(undefined); // и сервисный, и пользовательский бинд — успех
    mockSearch.mockResolvedValue({ searchEntries: [{ dn: 'uid=ldapexisting,dc=example,dc=com', cn: 'LDAP Existing' }] });

    const res = await ldap.authenticateAndSync('ldapexisting', 'correctpassword');
    expect(res).toBeTruthy();
    expect(res.id).toBe(existing.id);
    expect(mockUnbind).toHaveBeenCalled(); // и сервисное, и пользовательское соединение закрыты
  });

  test('0 совпадений в поиске → null, бинд пользователя не пытается (fail closed)', async () => {
    ldap.setConfig(BASE_CFG);
    mockBind.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue({ searchEntries: [] });
    const res = await ldap.authenticateAndSync('nobody', 'pw');
    expect(res).toBeNull();
  });

  test('SEC: >1 совпадения в поиске (неоднозначно) → null, а не первый попавшийся', async () => {
    ldap.setConfig(BASE_CFG);
    mockBind.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue({ searchEntries: [
      { dn: 'uid=dup1,dc=example,dc=com' }, { dn: 'uid=dup2,dc=example,dc=com' },
    ] });
    const res = await ldap.authenticateAndSync('ambiguous', 'pw');
    expect(res).toBeNull();
  });

  test('найден один пользователь, но бинд с его паролем провалился (неверный пароль) → null', async () => {
    ldap.setConfig(BASE_CFG);
    mockSearch.mockResolvedValue({ searchEntries: [{ dn: 'uid=someone,dc=example,dc=com' }] });
    let call = 0;
    mockBind.mockImplementation(() => {
      call++;
      // Первый bind() — сервисная учётка (успех), второй — пользователь (провал).
      return call === 1 ? Promise.resolve() : Promise.reject(new Error('Invalid Credentials'));
    });
    const res = await ldap.authenticateAndSync('someone', 'wrongpassword');
    expect(res).toBeNull();
  });

  test('сервисный бинд (bind_dn/bind_password) сам провалился — null, не исключение наружу', async () => {
    ldap.setConfig(BASE_CFG);
    mockBind.mockRejectedValue(new Error('Invalid Credentials'));
    const res = await ldap.authenticateAndSync('someone', 'pw');
    expect(res).toBeNull();
  });

  test('SEC: значение логина, похожее на LDAP-injection, экранируется в фильтре', async () => {
    ldap.setConfig(BASE_CFG);
    mockBind.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue({ searchEntries: [] });
    await ldap.authenticateAndSync('admin)(uid=*', 'pw');
    const searchArgs = mockSearch.mock.calls[0];
    const filterUsed = searchArgs[1].filter;
    // Скобки из имени пользователя должны быть экранированы, а не
    // расширять сам фильтр — иначе это LDAP injection.
    expect(filterUsed).not.toContain('(uid=admin)(uid=*)');
    expect(filterUsed).toMatch(/\\28|\\29/); // экранированные ( и )
  });

  test('auto_create_users: false + нет локальной записи → null (не создаёт молча)', async () => {
    ldap.setConfig({ ...BASE_CFG, auto_create_users: false });
    mockBind.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue({ searchEntries: [{ dn: 'uid=newperson,dc=example,dc=com', cn: 'New Person' }] });
    const res = await ldap.authenticateAndSync('newperson', 'pw');
    expect(res).toBeNull();
  });

  test('auto_create_users: true + нет локальной записи → создаёт локального юзера с default_role', async () => {
    ldap.setConfig({ ...BASE_CFG, auto_create_users: true, default_role: 'operator' });
    mockBind.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue({ searchEntries: [{ dn: 'uid=freshuser,dc=example,dc=com', cn: 'Fresh User', mail: 'fresh@example.com' }] });
    const res = await ldap.authenticateAndSync('freshuser', 'pw');
    expect(res).toBeTruthy();
    expect(res.role).toBe('operator');
    expect(res.login).toBe('freshuser');
  });

  test('SEC: авто-созданный локальный PIN НЕ пустой (пустой PIN = вход без пароля в этой системе)', async () => {
    ldap.setConfig({ ...BASE_CFG, auto_create_users: true });
    mockBind.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue({ searchEntries: [{ dn: 'uid=pincheck,dc=example,dc=com' }] });
    await ldap.authenticateAndSync('pincheck', 'pw');
    // Локальный вход с пустым паролем НЕ должен теперь проходить для этого юзера.
    const localAuth = mockDb.authByLogin('pincheck', '');
    expect(localAuth).toBeNull();
  });
});

describe('PROD-13: интеграция с POST /api/users/login', () => {
  test('локальный логин/пароль по-прежнему работает независимо от LDAP', async () => {
    ldap.setConfig({ ...BASE_CFG, enabled: true });
    const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
    expect(res.status).toBe(200);
    expect(mockBind).not.toHaveBeenCalled(); // локальный успех — LDAP вообще не трогаем
  });

  test('локальный пароль неверный, LDAP выручает (fallback) — если включён и юзер там есть', async () => {
    ldap.setConfig({ ...BASE_CFG, enabled: true, auto_create_users: true });
    mockBind.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue({ searchEntries: [{ dn: 'uid=ldaplogintest,dc=example,dc=com', cn: 'LDAP Login Test' }] });
    const res = await request(app).post('/api/users/login').send({ login: 'ldaplogintest', password: 'anypassword' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('LDAP Login Test');
  });

  test('ни локально, ни через LDAP — 401, единое сообщение об ошибке', async () => {
    ldap.setConfig({ ...BASE_CFG, enabled: true });
    mockBind.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue({ searchEntries: [] });
    const res = await request(app).post('/api/users/login').send({ login: 'ghost', password: 'pw' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Неверный логин или пароль');
  });
});

describe('PROD-13: GET/PUT /api/settings/ldap-config, POST /api/settings/ldap-test', () => {
  test('требуют admin', async () => {
    const res = await request(app).get('/api/settings/ldap-config');
    expect(res.status).toBe(401);
  });

  test('GET отдаёт конфиг с замаскированным bind_password', async () => {
    if (!AUTH['x-user-id']) return;
    ldap.setConfig({ ...BASE_CFG, bind_password: 'realSecretValue123' });
    const res = await request(app).get('/api/settings/ldap-config').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.bind_password).not.toContain('realSecretValue123');
    expect(res.body.bind_password).toMatch(/^••••/);
  });

  test('PUT с маской вместо пароля не затирает сохранённый секрет', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/ldap-config').set(AUTH).send({ ...BASE_CFG, bind_password: 'first-real-secret' });
    const masked = await request(app).get('/api/settings/ldap-config').set(AUTH);
    await request(app).put('/api/settings/ldap-config').set(AUTH).send({ ...BASE_CFG, bind_password: masked.body.bind_password });

    mockBind.mockResolvedValue(undefined);
    // testConnection() принимает объект как есть (это ЖИВАЯ проверка "что
    // сейчас в форме", не чтение сохранённого конфига) — поэтому передаём
    // маску явно, как это сделал бы реальный фронтенд, отправляя текущее
    // состояние формы после повторного открытия панели настроек.
    await ldap.testConnection({ ...BASE_CFG, bind_password: masked.body.bind_password });
    expect(mockBind.mock.calls[0][1]).toBe('first-real-secret');
  });

  test('ldap-test успех → { ok: true }', async () => {
    if (!AUTH['x-user-id']) return;
    mockBind.mockResolvedValue(undefined);
    const res = await request(app).post('/api/settings/ldap-test').set(AUTH).send(BASE_CFG);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('ldap-test неудача → понятная ошибка, не 500-крах без сообщения', async () => {
    if (!AUTH['x-user-id']) return;
    mockBind.mockRejectedValue(new Error('Connection refused'));
    const res = await request(app).post('/api/settings/ldap-test').set(AUTH).send(BASE_CFG);
    expect(res.status).toBe(502);
    expect(res.body.error).toContain('Connection refused');
  });
});
