'use strict';
/**
 * Тесты: настройки, категории, type-codes, аккаунты
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login:'admin', password:'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

// ─── Предупреждение о дефолтном пароле ───────────────────────────────────────
describe('POST /api/users/login — warn_default_pin', () => {
  // makeDb создаёт пользователя с паролем 'test123' (не дефолтный)
  test('warn_default_pin=false при нестандартном пароле', async () => {
    const res = await request(app).post('/api/users/login')
      .send({ login: 'admin', password: 'test123' });
    expect(res.status).toBe(200);
    expect(res.body.warn_default_pin).toBe(false);
  });

  test('warn_default_pin=false для тестового admin (не sys-user-admin)', async () => {
    // Тестовый mock пользователь имеет id='test-user-admin', а не 'sys-user-admin'
    // поэтому предупреждение не срабатывает — это поведение по дизайну:
    // warn_default_pin проверяется только у системного администратора
    const res = await request(app).post('/api/users/login')
      .send({ login: 'admin', password: 'test123' });
    expect(res.status).toBe(200);
    expect(res.body.warn_default_pin).toBe(false);
  });
});

// ─── Смена пароля ─────────────────────────────────────────────────────────────
describe('PUT /api/settings/password', () => {
  afterEach(async () => {
    // Возвращаем пароль обратно после каждого теста
    await request(app).put('/api/settings/password')
      .set({ 'x-edit-password': 'newpass123' })
      .send({ newPassword: 'test123' });
  });

  test('меняет пароль', async () => {
    const res = await request(app).put('/api/settings/password').set(AUTH)
      .send({ newPassword: 'newpass123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('старый пароль перестаёт работать после смены', async () => {
    await request(app).put('/api/settings/password').set(AUTH)
      .send({ newPassword: 'newpass123' });
    const res = await request(app).post('/api/users/login').send({ login:'admin', password:'test123' });
    expect(res.status).toBe(401);
  });

  test('новый пароль работает после смены', async () => {
    await request(app).put('/api/settings/password').set(AUTH)
      .send({ newPassword: 'newpass123' });
    const res = await request(app).post('/api/users/login').send({ login:'admin', password:'newpass123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('без авторизации → 401', async () => {
    const res = await request(app).put('/api/settings/password')
      .send({ newPassword: 'hack' });
    expect(res.status).toBe(401);
  });
});

// ─── Категории ────────────────────────────────────────────────────────────────
describe('PUT /api/categories/:tab', () => {
  test('обновляет категории для tab=os', async () => {
    const newCats = ['Ноутбуки', 'ПК', 'Серверы'];
    const res = await request(app).put('/api/categories/os').set(AUTH)
      .send({ categories: newCats });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const get = await request(app).get('/api/categories');
    expect(get.body.os).toEqual(newCats);
  });

  test('обновляет категории для tab=infra', async () => {
    const newCats = ['Сетевое', 'Серверы', 'ИБП'];
    const res = await request(app).put('/api/categories/infra').set(AUTH)
      .send({ categories: newCats });
    expect(res.status).toBe(200);
    const get = await request(app).get('/api/categories');
    expect(get.body.infra).toEqual(newCats);
  });

  test('без авторизации → 401', async () => {
    const res = await request(app).put('/api/categories/os')
      .send({ categories: ['Хак'] });
    expect(res.status).toBe(401);
  });
});

// ─── Type codes ───────────────────────────────────────────────────────────────
describe('PUT /api/type-codes', () => {
  test('обновляет список type_codes', async () => {
    const newCodes = [
      { code: 'NB', name: 'Ноутбук' },
      { code: 'PC', name: 'Системный блок' },
      { code: 'MON', name: 'Монитор' },
    ];
    const res = await request(app).put('/api/type-codes').set(AUTH)
      .send({ codes: newCodes });
    expect(res.status).toBe(200);
    const get = await request(app).get('/api/type-codes');
    expect(get.body).toHaveLength(3);
    expect(get.body.find(t => t.code === 'NB').name).toBe('Ноутбук');
  });

  test('без авторизации → 401', async () => {
    const res = await request(app).put('/api/type-codes')
      .send({ codes: [] });
    expect(res.status).toBe(401);
  });
});

// ─── Аккаунты ─────────────────────────────────────────────────────────────────
describe('GET /api/accounts', () => {
  test('требует авторизации', async () => {
    const res = await request(app).get('/api/accounts');
    expect(res.status).toBe(401);
  });

  test('возвращает массив с авторизацией', async () => {
    const res = await request(app).get('/api/accounts').set(AUTH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/accounts', () => {
  test('создаёт аккаунт', async () => {
    const res = await request(app).post('/api/accounts').set(AUTH)
      .send({ name: 'Тест Пользователь', login: 'testuser', password: '12345' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBeTruthy();
  });

  test('без name → 400', async () => {
    const res = await request(app).post('/api/accounts').set(AUTH)
      .send({ login: 'noname' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/accounts/:id', () => {
  let accountId;
  beforeAll(async () => {
    const r = await request(app).post('/api/accounts').set(AUTH)
      .send({ name: 'Обновляемый', login: 'updatable' });
    accountId = r.body.id;
  });

  test('обновляет поля аккаунта', async () => {
    const res = await request(app).put(`/api/accounts/${accountId}`).set(AUTH)
      .send({ name: 'Новое имя', note: 'Заметка' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const accounts = await request(app).get('/api/accounts').set(AUTH);
    const updated = accounts.body.find(a => a.id === accountId);
    expect(updated.name).toBe('Новое имя');
    expect(updated.note).toBe('Заметка');
  });

  test('404 для несуществующего аккаунта', async () => {
    const res = await request(app).put('/api/accounts/fake-id').set(AUTH)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/accounts/:id', () => {
  let accountId;
  beforeAll(async () => {
    const r = await request(app).post('/api/accounts').set(AUTH)
      .send({ name: 'Удаляемый', login: 'deleteme' });
    accountId = r.body.id;
  });

  test('удаляет аккаунт', async () => {
    const res = await request(app).delete(`/api/accounts/${accountId}`).set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const accounts = await request(app).get('/api/accounts').set(AUTH);
    expect(accounts.body.find(a => a.id === accountId)).toBeUndefined();
  });

  test('404 для несуществующего', async () => {
    const res = await request(app).delete('/api/accounts/fake-id').set(AUTH);
    expect(res.status).toBe(404);
  });
});
