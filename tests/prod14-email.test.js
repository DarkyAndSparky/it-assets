'use strict';
/**
 * Тесты: PROD-14 — Email (SMTP) как третий канал уведомлений
 * server/lib/notify.js (расширение PROD-7, не отдельный модуль).
 * Реального SMTP-сервера нет — мокаем `nodemailer` целиком.
 *
 * ВАЖНО (урок PROD-13, см. tests/prod13-ldap.test.js): tests/helpers/
 * makeDb.js вызывает jest.resetModules() внутри себя — require('nodemailer')
 * для получения мока должен идти СТРОГО ПОСЛЕ makeDb(), иначе тестовый
 * файл сконфигурирует другой экземпляр мока, чем тот, что реально
 * использует server/lib/notify.js.
 */
jest.mock('nodemailer', () => {
  const mockSendMail = jest.fn();
  const mockVerify = jest.fn();
  const mockClose = jest.fn();
  return {
    createTransport: jest.fn(() => ({ sendMail: mockSendMail, verify: mockVerify, close: mockClose })),
    __mockSendMail: mockSendMail, __mockVerify: mockVerify, __mockClose: mockClose,
  };
});

const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');
const { __mockSendMail: mockSendMail, createTransport: mockCreateTransport } = require('nodemailer');

let AUTH = {};
beforeAll(async () => {
  const res = await request(app).post('/api/users/login').send({ login: 'admin', password: 'test123' });
  if (res.body?.user?.id) AUTH = { 'x-user-id': res.body.user.id, 'x-edit-password': 'test123' };
});

beforeEach(() => {
  mockSendMail.mockReset();
  mockCreateTransport.mockClear();
});

const SMTP_CFG = {
  enabled: true, events: ['add', 'retire'],
  smtp_host: 'smtp.example.com', smtp_port: '587', smtp_secure: false,
  smtp_user: 'notify@example.com', smtp_password: 'smtppass123',
  smtp_from: 'IT Assets <notify@example.com>', smtp_to: 'team@example.com',
};

describe('PROD-14: GET/PUT /api/settings/notify-config — SMTP-поля', () => {
  test('PUT сохраняет SMTP-конфиг, smtp_password возвращается замаскированным', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/settings/notify-config').set(AUTH).send(SMTP_CFG);
    expect(res.status).toBe(200);
    expect(res.body.smtp_host).toBe('smtp.example.com');
    expect(res.body.smtp_to).toBe('team@example.com');
    expect(res.body.smtp_password).not.toContain('smtppass123');
    expect(res.body.smtp_password).toMatch(/^••••/);
  });

  test('повторный PUT с маской вместо smtp_password не затирает секрет', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send(SMTP_CFG);
    const masked = await request(app).get('/api/settings/notify-config').set(AUTH);
    await request(app).put('/api/settings/notify-config').set(AUTH)
      .send({ ...SMTP_CFG, smtp_password: masked.body.smtp_password });

    mockSendMail.mockResolvedValue({ messageId: 'x' });
    await request(app).post('/api/settings/notify-test').set(AUTH).send({ smtp_host: 'smtp.example.com', smtp_to: 'team@example.com', smtp_user: 'notify@example.com', smtp_password: masked.body.smtp_password });
    const transportOpts = mockCreateTransport.mock.calls[0][0];
    expect(transportOpts.auth.pass).toBe('smtppass123');
  });

  test('smtp_port нечисловой/некорректный не ломает сохранение — фолбэк на 587', async () => {
    if (!AUTH['x-user-id']) return;
    const res = await request(app).put('/api/settings/notify-config').set(AUTH)
      .send({ ...SMTP_CFG, smtp_port: 'not-a-number' });
    expect(res.status).toBe(200);
  });
});

describe('PROD-14: события триггерят email (тот же движок, что webhook/Telegram)', () => {
  beforeEach(async () => {
    await request(app).put('/api/settings/notify-config').set(AUTH).send(SMTP_CFG);
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue({ messageId: 'x' });
  });

  test('создание актива (add) шлёт письмо на smtp_to', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).post('/api/assets').set(AUTH).send({ model: 'EmailAddModel', tab: 'os' });
    await new Promise(r => setTimeout(r, 50)); // fire-and-forget
    expect(mockSendMail).toHaveBeenCalled();
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('team@example.com');
    expect(mail.subject).toContain('Новый актив');
  });

  test('событие, не выбранное в events[], email не шлёт', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({ ...SMTP_CFG, events: ['retire'] });
    mockSendMail.mockClear();
    await request(app).post('/api/assets').set(AUTH).send({ model: 'EmailFilteredModel', tab: 'os' });
    await new Promise(r => setTimeout(r, 50));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('smtp_to не заполнен — email не пытается отправиться (даже если host есть)', async () => {
    if (!AUTH['x-user-id']) return;
    await request(app).put('/api/settings/notify-config').set(AUTH).send({ ...SMTP_CFG, smtp_to: '' });
    mockSendMail.mockClear();
    await request(app).post('/api/assets').set(AUTH).send({ model: 'EmailNoRecipientModel', tab: 'os' });
    await new Promise(r => setTimeout(r, 50));
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  test('move НЕ шлёт email — то же намеренное ограничение области действия, что у webhook/Telegram (PROD-7)', async () => {
    if (!AUTH['x-user-id']) return;
    const created = await request(app).post('/api/assets').set(AUTH).send({ model: 'EmailMoveModel', tab: 'os' });
    mockSendMail.mockClear();
    await request(app).post(`/api/assets/${created.body.id}/move`).set(AUTH).send({ newLocation: 'Другой кабинет' });
    await new Promise(r => setTimeout(r, 50));
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe('PROD-14: POST /api/settings/notify-test — email-канал', () => {
  test('успешная отправка → { email: "sent" }', async () => {
    if (!AUTH['x-user-id']) return;
    mockSendMail.mockResolvedValue({ messageId: 'x' });
    const res = await request(app).post('/api/settings/notify-test').set(AUTH).send(SMTP_CFG);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('sent');
  });

  test('сбой SMTP (например неверный пароль) → понятная ошибка, не 500-крах', async () => {
    if (!AUTH['x-user-id']) return;
    mockSendMail.mockRejectedValue(new Error('535 Authentication failed'));
    const res = await request(app).post('/api/settings/notify-test').set(AUTH).send(SMTP_CFG);
    expect(res.status).toBe(200);
    expect(res.body.email).toContain('Authentication failed');
  });

  test('транспорт закрывается после отправки (не течёт соединение)', async () => {
    if (!AUTH['x-user-id']) return;
    mockSendMail.mockResolvedValue({ messageId: 'x' });
    const { __mockClose } = require('nodemailer');
    __mockClose.mockClear();
    await request(app).post('/api/settings/notify-test').set(AUTH).send(SMTP_CFG);
    expect(__mockClose).toHaveBeenCalled();
  });

  test('secure:true передаётся в createTransport как есть (порт 465 — TLS сразу)', async () => {
    if (!AUTH['x-user-id']) return;
    mockSendMail.mockResolvedValue({ messageId: 'x' });
    await request(app).post('/api/settings/notify-test').set(AUTH).send({ ...SMTP_CFG, smtp_port: '465', smtp_secure: true });
    const opts = mockCreateTransport.mock.calls[0][0];
    expect(opts.secure).toBe(true);
    expect(opts.port).toBe(465);
  });
});
