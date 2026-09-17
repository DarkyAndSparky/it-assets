'use strict';
/**
 * Тесты: PROD-12 — PWA/manifest. Проверяем только то, что реально можно
 * проверить статически (валидность manifest.json, наличие иконок,
 * отсутствие /api/* в зоне действия service worker) — рендеринг иконок и
 * реальную установку PWA браузером тестами не покрыть, это внешняя среда.
 */
const request = require('supertest');
const makeDb  = require('./helpers/makeDb');

const mockDb = makeDb();
jest.mock('../server/database', () => mockDb);
const app = require('../server/index');

describe('PROD-12: /manifest.json', () => {
  test('отдаётся и является валидным JSON с обязательными PWA-полями', async () => {
    const res = await request(app).get('/manifest.json');
    expect(res.status).toBe(200);
    const m = JSON.parse(res.text);
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    expect(Array.isArray(m.icons)).toBe(true);
    expect(m.icons.length).toBeGreaterThanOrEqual(2);
  });

  test('иконки, перечисленные в manifest.json, реально существуют и отдаются', async () => {
    const manifestRes = await request(app).get('/manifest.json');
    const m = JSON.parse(manifestRes.text);
    const uniqueSrcs = [...new Set(m.icons.map(i => i.src))];
    for (const src of uniqueSrcs) {
      const res = await request(app).get(src);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
    }
  });
});

describe('PROD-12: /sw.js — service worker', () => {
  test('отдаётся с корректным JS content-type', async () => {
    const res = await request(app).get('/sw.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
  });

  test('содержит явную защиту от кеширования /api/* — регрессия, критично для корректности данных', async () => {
    const res = await request(app).get('/sw.js');
    expect(res.text).toMatch(/pathname\.startsWith\(['"]\/api\/['"]\)/);
  });

  test('CACHE_NAME синхронизирован со списком статических файлов оболочки (не пустой, включает index.html)', async () => {
    const res = await request(app).get('/sw.js');
    expect(res.text).toContain('CACHE_NAME');
    expect(res.text).toContain("'/index.html'");
  });
});

describe('PROD-12: index.html подключает manifest и SW-регистрацию', () => {
  test('<link rel="manifest"> присутствует', async () => {
    const res = await request(app).get('/index.html');
    expect(res.text).toContain('<link rel="manifest" href="/manifest.json">');
  });

  test('подключён скрипт регистрации service worker', async () => {
    const res = await request(app).get('/index.html');
    expect(res.text).toContain('/js/pwa.js');
  });
});
