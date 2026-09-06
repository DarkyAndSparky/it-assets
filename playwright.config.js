// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

// Сервер отдаёт только HTTPS (self-signed сертификат), HTTP только редиректит.
// Поднимаем на отдельном порту с ИЗОЛИРОВАННОЙ data-директорией (IT_ASSETS_DATA_DIR),
// чтобы E2E-тесты не трогали реальные данные и не зависели от их состояния.
const HTTPS_PORT = process.env.E2E_HTTPS_PORT || 3543;
const E2E_DATA_DIR = path.join(__dirname, '.e2e-data');

// Найдено при разборе бага после этой сессии: global-setup.js меняет
// дефолтный пароль admin (admn0000 → ADMIN_PIN) один раз при первом
// прогоне, но ничего не удаляло .e2e-data/ между прогонами — вопреки
// комментарию в global-setup.js, обещающему "изолированную свежую
// .e2e-data/ каждый прогон". Второй и последующие локальные запуски
// TEST-E2E.bat находили УЖЕ смёненный пароль и падали на самом первом
// логине в global-setup ("Неверный логин или пароль"), потому что тот
// пробует именно дефолтный admn0000. Чистим директорию здесь — на
// момент загрузки конфига, ДО того как Playwright поднимет webServer
// (globalSetup выполняется уже после старта сервера, там чистить поздно
// — сервер к тому моменту уже прочитал/создал файлы по старому пути).
//
// EPERM на Windows: если предыдущий прогон завершился аварийно (Ctrl+C,
// упавший тест) и процесс `node server/index.js` не успел закрыть
// SQLite/WAL-файл, Windows держит его залоченным ЭКСКЛЮЗИВНО (в отличие
// от POSIX, где rm спокойно удаляет файл, даже если он ещё открыт) —
// rmSync падает с EPERM/EBUSY. Ретраим с паузой: в большинстве случаев
// файл освобождается за 1-2 секунды (ОС и антивирус донащёлкивают
// хендлы); если не отпустило за отведённое время — не блокируем весь
// прогон, а идём дальше с тем, что есть (тесты либо пройдут на чуть
// более старых данных, либо упадут понятной ошибкой, а не тут).
function _sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function _rmE2eDataSync(dir) {
  const MAX_ATTEMPTS = 5;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if ((e.code !== 'EPERM' && e.code !== 'EBUSY') || i === MAX_ATTEMPTS - 1) {
        console.warn(`[playwright.config] Не удалось удалить ${dir}: ${e.message}. ` +
          'Возможно, файл занят процессом от предыдущего прогона (Windows) — ' +
          'закройте его вручную и запустите ещё раз, если тесты ниже упадут на старых данных.');
        return;
      }
      _sleepSync(800); // не busy-wait — Atomics.wait не грузит CPU во время паузы
    }
  }
}
_rmE2eDataSync(E2E_DATA_DIR);

module.exports = defineConfig({
  testDir: './tests-e2e',
  fullyParallel: false,     // один сервер, один набор данных — тесты по очереди
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: require.resolve('./tests-e2e/global-setup.js'),
  use: {
    baseURL: `https://localhost:${HTTPS_PORT}`,
    ignoreHTTPSErrors: true, // самоподписанный сертификат
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node server/index.js',
    url: `https://localhost:${HTTPS_PORT}`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      HTTPS_PORT: String(HTTPS_PORT),
      PORT: String(Number(HTTPS_PORT) - 1000), // просто чтобы не пересекался с обычным 3000
      IT_ASSETS_DATA_DIR: E2E_DATA_DIR, // изолированная БД
      // Найдено по логу с Windows: без этого общий API-лимитер
      // (server/middleware/apiRateLimit.js, 300 GET/мин на IP) реально
      // срабатывал при быстрой автоматизированной навигации Playwright по
      // вкладкам — 58 тестов подряд на одном IP (127.0.0.1) в общем
      // 60-секундном окне легко превышают лимит, рассчитанный на
      // человеческую скорость кликов. Тот же самый механизм отключения,
      // которым apiRateLimit.js уже пользуется для jest (NODE_ENV=test) —
      // просто не был прокинут сюда для e2e-сервера.
      RATE_LIMIT_DISABLED: '1',
    },
  },
});
