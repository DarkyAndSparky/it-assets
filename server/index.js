// OPS-2 (Track 9, найдено при аудите net-monitor, см. NETMONITOR-AUDIT.md):
// ограничиваем права по умолчанию для ВСЕХ файлов, создаваемых этим
// процессом (db.json, config.json, it-assets.sqlite — содержит хеши
// паролей/PIN, файлы логов, ZIP-бэкапы) — до владельца (600 для файлов,
// 700 для директорий), без доступа группе/остальным. Раньше права
// определялись дефолтным umask ОС (обычно 022 на Linux → 644, читаемо
// любым локальным пользователем на той же машине). Единственное
// исключение — server/cert.js явно выставляет cert.pem в 644 (публично
// читаемый по дизайну — отдаётся браузерам через TLS handshake, не через
// файловый доступ), но с этим umask запрошенные 644 всё равно урежутся
// до 600 (644 & ~077 = 600) — это НЕ проблема, ключ (key.pem, и так 600)
// и сертификат одинаково доступны только владельцу процесса, что строже
// исходного намерения, не мягче.
//
// ДОЛЖНО стоять раньше любых require() — некоторые модули могут создавать
// файлы/сокеты уже при импорте (например better-sqlite3 открывает файл БД
// сразу при require('./db/sqlite')).
process.umask(0o077);

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { v7: uuidv7 } = require('uuid');
const db       = require('./database');
const logger   = require('./logger');
const { sqlite } = require('./db/sqlite');

// Версия — единый источник правды теперь файл VERSION в корне репозитория
// (не package.json — plain-text файл проще редактировать вручную и не
// требует валидного JSON вокруг). package.json.version синхронизируется
// ОТ него через scripts/sync-version.js, не наоборот. Идея подсмотрена в
// соседнем проекте atlas-server: там ровно та же схема (VERSION в корне,
// server.js читает его напрямую, package.json — производная).
// Фолбэк на pkg.version — на случай если VERSION вдруг отсутствует
// (старый checkout без него), чтобы сервер не падал, а не для повседневного
// использования.
const pkg = (() => { try { return require('../package.json'); } catch(e) { return {}; } })();
const APP_VERSION = (() => {
  try { return require('fs').readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim(); }
  catch(e) { return pkg.version || 'unknown'; }
})();

// Человекочитаемая версия: beta-1-26w27-01 → β1 · 26w27·01
const APP_VERSION_DISPLAY = APP_VERSION
  .replace(/^alpha-(\d+)-/, 'α$1 · ')
  .replace(/^beta-(\d+)-/,  'β$1 · ')
  .replace(/-/g, '·');
// Live getters — db.ORG_CODES / db.TYPE_CODES are defineProperty getters on db object
// Do NOT cache at startup: org names can change at runtime

const app  = express();
// Не раскрываем факт использования Express (мелкое, но бесплатное закрытие
// разведочной информации для потенциального атакующего).
app.disable('x-powered-by');

// Базовые security-заголовки + CSP.
// CSP теперь можно включить: Фаза 6 рефакторинга перевела ВСЕ inline
// onclick/onchange/oninput/... на addEventListener через делегирование
// (public/js/event-delegation.js, data-action="..."). Инлайн-скриптов и
// обработчиков в разметке больше не осталось — script-src 'self' без
// unsafe-inline не должен ничего сломать.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // SEC-13 (Track 9, найдено при аудите net-monitor): мы всегда работаем
  // по HTTPS (самоподписанный сертификат, см. cert.js) — HSTS был к месту,
  // но отсутствовал. Условно на `req.secure` (не безусловно) — эта
  // проверка отражает реальный TLS-статус TCP-сокета (`trust proxy` в
  // Express здесь НЕ настроен через app.set(), TRUST_PROXY проверяется
  // вручную только в rateLimit.js для X-Forwarded-For — так что req.secure
  // не подвержен подмене через заголовки, надёжный сигнал). Не отправляем
  // HSTS на редком фолбэк-пути (TLS не поднялся, сервер отвечает по
  // голому HTTP) — было бы некорректно утверждать «всегда HTTPS», когда
  // это буквально не так прямо сейчас. 180 дней (как в net-monitor) — не
  // maximum-агрессивный год+preload, разумный компромисс для
  // самоподписанного внутреннего инструмента.
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " + // много inline style="..." в шаблонах — отдельная задача, не блокер
    "img-src 'self' data:; " +         // data: — логотип компании хранится и как base64 (см. settings-general.js)
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "object-src 'none'; " +
    "base-uri 'self'; " +
    "frame-ancestors 'none'"
  );
  next();
});

// Примечание: фактические HTTP/HTTPS порты объявлены ниже, в startServer()
// (HTTP_PORT / HTTPS_PORT), и настраиваются через process.env — см. там.

// CORS: фронтенд отдаётся тем же сервером (express.static), поэтому обычному
// использованию (открыть https://ip:3443 в браузере) кросс-origin вообще не
// нужен — такие запросы браузер не помечает Origin. Список ниже нужен только
// если API дергают с другого домена (отдельный фронтенд, реверс-прокси и т.п.).
// По умолчанию список пуст → кросс-origin запросы из браузера блокируются.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // curl, серверные вызовы, тот же origin
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, '../public')));

// OPS-4 (Track 9): общий rate-limit на все /api/* — раньше был только на
// /login. См. подробный комментарий в server/middleware/apiRateLimit.js.
app.use('/api', require('./middleware/apiRateLimit'));

// ─── AUTH ─────────────────────────────────────────────────────────────────────
// requireAuth/requireAdmin/changedBy вынесены в server/middleware/auth.js (Фаза 1/2 рефакторинга)
const { requireAuth, requireAdmin, changedBy } = require('./middleware/auth');

// ─── SETTINGS (Фаза 3 рефакторинга) ──────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/settings', require('./routes/settings.routes'));

// ─── AUTH: ПОЛЬЗОВАТЕЛИ СИСТЕМЫ (Фаза 3 рефакторинга) ────────────────────────
// rateLimitLogin вынесен в server/middleware/rateLimit.js, роуты — в users.routes.js
app.use('/api/users', require('./routes/users.routes'));

// ─── CATEGORIES (Фаза 3 рефакторинга) ────────────────────────────────────────
app.use('/api/categories', require('./routes/categories.routes'));

// ─── ASSETS (Фаза 4 рефакторинга) ────────────────────────────────────────────
app.use('/api/assets', require('./routes/assets.routes'));
// ─── INVENTORY NUMBERS (Фаза 4b рефакторинга) ────────────────────────────────
app.use('/api/inv', require('./routes/inv.routes'));

// ─── HISTORY (Фаза 4 рефакторинга) ───────────────────────────────────────────
app.use('/api/history', require('./routes/history.routes'));

// ─── STATS (Фаза 4c рефакторинга) ────────────────────────────────────────────
app.use('/api/stats', require('./routes/stats.routes'));

// ─── ACCOUNTS ─────────────────────────────────────────────────────────────────
// ─── УЧЁТНЫЕ ЗАПИСИ (Фаза 3 рефакторинга) ────────────────────────────────────
app.use('/api/accounts', require('./routes/accounts.routes'));

// ─── CSV EXPORT/IMPORT + HISTORY IMPORT (Фаза 4d рефакторинга) ───────────────
app.use('/api', require('./routes/csv.routes'));

// ─── DB DIAGNOSTICS ──────────────────────────────────────────────────────────
app.get('/api/diag', requireAdmin, (req, res) => {
  const fs2 = require('fs');
  const dbPath = require('./db/store').DB_PATH;
  let writable = false, fileSize = 0, lastWrite = null;
  try { fs2.accessSync(dbPath, fs2.constants.W_OK); writable = true; } catch(e) {}
  try { const s = fs2.statSync(dbPath); fileSize = s.size; lastWrite = s.mtime; } catch(e) {}
  let writeOk = false;
  try { db.set('_meta.diag_ping', Date.now()).write(); writeOk = true; } catch(e) {}
  const schemaVer = db.cfg.get('_meta.schema_version').value() || '?';

  // Информация о последнем бэкапе
  let lastBackup = null;
  let backupCount = 0;
  try {
    const backups = listBackups();
    backupCount = backups.length;
    if (backups.length > 0) {
      lastBackup = { file: backups[0].name, mtime: backups[0].mtime, size: backups[0].size, full: backups[0].full };
    }
  } catch(e) {}

  res.json({
    dbPath, writable, writeOk, fileSize, lastWrite,
    schema_version: schemaVer,
    assets: sqlite.prepare('SELECT COUNT(*) c FROM assets').get().c,
    history: sqlite.prepare('SELECT COUNT(*) c FROM history').get().c,
    backup: { last: lastBackup, count: backupCount, dir: BACKUP_DIR },
  });
});

// Принудительный запуск миграций (для ручного пересчёта категорий и т.д.)
app.post('/api/migrate', requireAdmin, (req, res) => {
  try {
    const migrate = require('./migrate');
    // Сбрасываем версию чтобы миграция перезапустила все шаги
    const targetVersion = parseInt(req.body.from_version || 0);
    db.cfg.set('_meta.schema_version', targetVersion).write();
    migrate(db, db.cfg);
    const newVer = db.cfg.get('_meta.schema_version').value();
    res.json({ ok: true, schema_version: newVer });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── СПРАВОЧНИК: СОТРУДНИКИ ───────────────────────────────────────────────────
// ─── СОТРУДНИКИ: CRUD + reassign-assets (Фазы 3-4 рефакторинга) ─────────────
app.use('/api/employees', require('./routes/employees.routes'));

// ─── СПРАВОЧНИК: ОРГАНИЗАЦИИ ──────────────────────────────────────────────────

// ─── СПРАВОЧНИКИ: ОРГАНИЗАЦИИ / ФИЛИАЛЫ / ЛОКАЦИИ ────────────────────────────
// Роуты вынесены в server/routes/{orgs,filials,locations}.routes.js (Фаза 1 рефакторинга)
app.use('/api/orgs', require('./routes/orgs.routes'));
app.use('/api/filials', require('./routes/filials.routes'));
app.use('/api/locations', require('./routes/locations.routes'));

// ─── КОНФИГ: ЭКСПОРТ / ИМПОРТ ────────────────────────────────────────────────

// ─── CONFIG EXPORT/IMPORT (Фаза 4b рефакторинга) ─────────────────────────────
app.use('/api/config', require('./routes/config.routes'));

// ─── TYPE CODES (Фаза 4b рефакторинга) ───────────────────────────────────────
app.use('/api', require('./routes/types.routes'));

// ─── BACKUP / QR (REF-1 рефакторинга) ────────────────────────────────────────
// Вынесены в отдельные *.routes.js — тот же паттерн, что и остальные домены
// (orgs, filials, ...). backupRoutes экспортирует не только сам роутер, но и
// makeBackup/listBackups/BACKUP_DIR — используются ниже в /api/diag.
const backupRoutes = require('./routes/backup.routes');
const { listBackups, BACKUP_DIR } = backupRoutes;
app.use('/api/backup', backupRoutes);
app.use('/api/qr', require('./routes/qr.routes'));
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html')));

// ─── Глобальный обработчик ошибок ─────────────────────────────────────────────
// Без него необработанные исключения (например, синтаксически неверный JSON
// в теле запроса — body-parser бросает SyntaxError) уходят в дефолтный
// обработчик Express, который вне NODE_ENV=production отдаёт клиенту полный
// stack trace с абсолютными путями на диске — раскрытие внутренней структуры
// сервера без какой-либо авторизации. Здесь — то же самое, но без утечки:
// подробности только в серверный лог, клиенту — краткое сообщение.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('unhandled', err.message || String(err), err.stack);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const message = status === 400 ? 'Некорректное тело запроса' : 'Внутренняя ошибка сервера';
  res.status(status).json({ error: message });
});

module.exports = app;

if (require.main === module) {
  (async function startServer() {
    const https   = require('https');
    const http    = require('http');
    const { ensureCert, getLocalIPs } = require('./cert');

    const HTTP_PORT  = process.env.PORT       || 3000;
    const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

    // OPS-1 (Track 9, найдено при аудите procure-it, см. NETMONITOR-AUDIT.md):
    // ссылки на реально запущенные http/https-серверы — нужны graceful
    // shutdown'у ниже, чтобы штатно закрыть слушающие сокеты перед выходом
    // (какая из веток запустится — зависит от того, удалось ли получить
    // TLS-сертификат, поэтому храним в let, не const).
    let httpServer  = null;
    let httpsServer = null;

    // OPS-1: раньше SIGTERM/SIGINT никак не обрабатывались — `docker stop`
    // (или Ctrl+C) слал сигнал, Node его игнорировал, и по истечении
    // stop_grace_period (Docker-дефолт 10 сек, если не задан явно) процесс
    // получал SIGKILL — потенциально посреди записи в SQLite. WAL-режим
    // устойчивее к абортам, чем rollback-journal, но резкий kill — риск,
    // которого легко избежать. Закрываем слушающие сокеты (не принимаем
    // новые соединения, но НЕ рвём уже открытые keep-alive на середине),
    // затем WAL-чекпоинт + закрытие SQLite, затем выход. Таймаут-предохранитель
    // на случай подвисшего keep-alive-соединения, которое никогда не закроется
    // само — не ждём его вечно.
    let shuttingDown = false;
    function gracefulShutdown(signal) {
      if (shuttingDown) return; // повторный сигнал во время shutdown — не запускаем второй раз
      shuttingDown = true;
      logger.info('shutdown', `${signal} получен, завершаю работу штатно`);
      console.log(`\n[${signal}] Завершение работы...`);

      const forceExitTimer = setTimeout(() => {
        logger.warn('shutdown', 'таймаут 5с — принудительный выход (не все соединения закрылись)');
        process.exit(1);
      }, 5000);
      forceExitTimer.unref(); // сам по себе не должен удерживать процесс живым

      const closers = [httpServer, httpsServer]
        .filter(Boolean)
        .map(s => new Promise(resolve => s.close(resolve)));

      Promise.all(closers).finally(() => {
        try {
          sqlite.exec('PRAGMA wal_checkpoint(TRUNCATE);');
          sqlite.close();
          logger.info('shutdown', 'SQLite закрыта штатно');
        } catch(e) {
          logger.error('shutdown', 'ошибка при закрытии БД', e.message);
        }
        clearTimeout(forceExitTimer);
        process.exit(0);
      });
    }
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

    // OPS-3 (Track 9, найдено при аудите net-monitor + procure-it, см.
    // NETMONITOR-AUDIT.md): раньше не было ни одного глобального
    // обработчика — необработанный reject/исключение либо ронял процесс
    // Node-дефолтом (Node 15+ делает process.exit(1) на unhandledRejection),
    // либо (для uncaughtException) вообще без единого лога о причине.
    //
    // Два источника предлагали противоположные подходы — решение принято
    // осознанно, не скопировано:
    //   - net-monitor: и rejection, и exception — логирует и продолжает
    //     работать (выше доступность, риск — жить в потенциально
    //     неконсистентном состоянии).
    //   - procure-it: оба случая завершают процесс после cleanup (следует
    //     официальной рекомендации Node.js — после uncaughtException
    //     состояние процесса не гарантированно безопасно для продолжения).
    //
    // У нас уже есть gracefulShutdown() (OPS-1) и `restart: unless-stopped`
    // в docker-compose.yml — значит "завершиться безопасно" обходится
    // почти бесплатно, Docker поднимет заново за секунды. Разделяем по
    // серьёзности, а не копируем один источник целиком:
    //   - unhandledRejection — обычно восстановимо (одна упавшая async-
    //     операция, не обязательно ломает остальной процесс) — логируем,
    //     НЕ завершаемся (как net-monitor). У нас и так мало async-
    //     хендлеров (риск уже ниже, чем у обоих источников).
    //   - uncaughtException — серьёзнее (могло прерваться в середине
    //     синхронной операции с сайд-эффектом) — завершаемся штатно через
    //     уже готовый gracefulShutdown() (как procure-it).
    process.on('unhandledRejection', (reason) => {
      logger.error('process', 'Unhandled promise rejection', String(reason));
      console.error('[UNHANDLED REJECTION]', reason);
    });
    process.on('uncaughtException', (err) => {
      logger.error('process', 'Uncaught exception — завершаю работу штатно', err.message);
      console.error('[UNCAUGHT EXCEPTION]', err);
      gracefulShutdown('uncaughtException');
    });

    function printStartInfo(ips) {
      const fs2    = require('fs');
      const dbPath = require('./db/store').DB_PATH;

      // INFRA-4/9 (взято на заметку из соседнего atlas-server): обрамляем
      // вывод рамкой из '─', как там сделано в server.js/printBanner —
      // визуально проще выцепить блок старта среди прочих логов в
      // консоли/PM2. Сама диагностика (проверка прав на запись, размер БД,
      // самопроверка записи в SQLite) — оставлена как была, только обёрнута.
      const rule = '─'.repeat(60);
      console.log('\n' + rule);
      console.log(' 🗄️  IT ASSETS ' + APP_VERSION_DISPLAY + ' — сервер запущен');
      console.log(rule);
      console.log('DB path: ' + dbPath);

      if (fs2.existsSync(dbPath)) {
        const stat = fs2.statSync(dbPath);
        console.log('DB size: ' + (stat.size/1024).toFixed(1) + ' KB  | modified: ' + stat.mtime.toLocaleString('ru-RU'));
      } else {
        console.log('DB: file will be created on first write');
      }

      try {
        fs2.accessSync(require('path').dirname(dbPath), fs2.constants.W_OK);
      } catch(e) {
        console.error('\n!!! CRITICAL: no write permission for data/ folder');
        console.error('!!! Move it-assets folder to Desktop and restart!\n');
        logger.error('startup', 'no write permission for data/ folder', e.message);
      }

      // Фаза 7c-8b: assets/history переехали в SQLite — db.json больше не
      // отражает их состояние (пишется, только пока там ещё остаются
      // organizations/filials/... до их будущей миграции, если будет).
      // Проверяем реальную запись через SQLite: heartbeat-таймстамп в
      // settings + перечитываем — если файл недоступен на запись, это
      // выбросит исключение так же надёжно, как раньше делала db.write().
      try {
        db.set('_meta.last_start', new Date().toISOString()).write();
        db.setSetting('_last_start_check', new Date().toISOString());
        const check = db.getSetting('_last_start_check');
        const assetsCount  = sqlite.prepare('SELECT COUNT(*) c FROM assets').get().c;
        const historyCount = sqlite.prepare('SELECT COUNT(*) c FROM history').get().c;
        if (!check) {
          console.error('!!! WARNING: SQLite write check failed (readback empty)');
          logger.warn('startup', 'SQLite write check failed: readback empty after write');
        } else {
          console.log('DB write: OK (' + assetsCount + ' assets, ' + historyCount + ' history)');
        }
      } catch(e) {
        console.error('!!! db write ERROR:', e.message);
        logger.error('startup', 'db write ERROR', e.message);
      }

      const total = sqlite.prepare("SELECT COUNT(*) c FROM assets WHERE status != 'списан'").get().c;
      console.log('Assets: ' + total);
      console.log('');
      console.log('HTTP  (redirect to HTTPS):');
      console.log('  http://localhost:' + HTTP_PORT);
      console.log('');
      console.log('HTTPS (main):');
      console.log('  https://localhost:' + HTTPS_PORT);
      for (const ip of ips.filter(i => i !== '127.0.0.1'))
        console.log('  https://' + ip + ':' + HTTPS_PORT + '  <-- colleagues');
      console.log('');
      console.log('  [WARNING] Self-signed certificate');
      console.log('  Chrome:  click "Advanced" -> "Proceed to localhost"');
      console.log('  Firefox: click "Accept the Risk and Continue"');
      console.log('  Edge:    click "Advanced" -> "Continue to localhost"');
      console.log('\n  Чтобы остановить сервер — нажмите Ctrl+C.\n');
      console.log(rule + '\n');
    }

    // HTTP -> HTTPS redirect
    const httpApp = require('express')();
    httpApp.use((req, res) => {
      const host = req.hostname || 'localhost';
      res.redirect(301, 'https://' + host + ':' + HTTPS_PORT + req.originalUrl);
    });
    httpServer = http.createServer(httpApp).listen(HTTP_PORT, '0.0.0.0', () => {
      console.log('[HTTP]  :' + HTTP_PORT + ' -> redirect to HTTPS :' + HTTPS_PORT);
    });

    // HTTPS server
    let tlsOptions;
    try {
      tlsOptions = await ensureCert();
    } catch(e) {
      console.error('[TLS] Failed to get certificate:', e.message);
      console.error('[TLS] Starting HTTP only on port ' + HTTP_PORT);
      logger.error('TLS', 'Failed to get certificate, falling back to HTTP only', e.message);
      app.listen(HTTP_PORT, '0.0.0.0', () => {
        const ips = getLocalIPs();
        const rule = '─'.repeat(60);
        console.log('\n' + rule);
        console.log(' 🗄️  IT ASSETS ' + APP_VERSION_DISPLAY + ' — сервер запущен (HTTP, без TLS)');
        console.log(rule);
        console.log('  http://localhost:' + HTTP_PORT);
        for (const ip of ips.filter(i => i !== '127.0.0.1'))
          console.log('  http://' + ip + ':' + HTTP_PORT);
        console.log(rule + '\n');
      });
      return;
    }

    const ips = getLocalIPs();
    httpsServer = https.createServer(tlsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      printStartInfo(ips);
    });
  })();
}
