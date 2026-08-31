/**
 * server/middleware/apiRateLimit.js
 *
 * OPS-4 (Track 9, найдено при аудите net-monitor, см. NETMONITOR-AUDIT.md):
 * раньше лимитирован был только вход (`server/middleware/rateLimit.js`,
 * `rateLimitLogin`) — остальные эндпоинты, включая теперь публично читаемые
 * после INFRA-7 `requireLogin`-роуты и оставшиеся полностью публичными
 * `/api/stats`/`/api/history` (нужны dashboard), не были защищены от
 * злоупотребления вообще. Любой залогиненный (даже viewer) или, где
 * публично, кто угодно, мог долбить API без ограничений.
 *
 * Два профиля (как в net-monitor, без их третьего "scan"-профиля — у нас
 * нет сканирования сети):
 *   - read  — GET-запросы, 300/мин на IP
 *   - write — POST/PUT/DELETE/PATCH, 60/мин на IP
 *
 * `/api/health` (публичный, используется Docker HEALTHCHECK — см.
 * Track 8/INFRA-11) исключён из лимита явно: healthcheck дёргается раз в
 * 30 сек, но исключение на будущее — если кто-то настроит более частый
 * внешний мониторинг, он не должен упереться в лимит.
 *
 * `RATE_LIMIT_DISABLED=1` — ручное отключение (для отладки прод-проблем);
 * `NODE_ENV=test` — отключено автоматически (Jest выставляет это значение
 * сам), иначе supertest-тесты, которые дёргают один и тот же эндпоинт в
 * цикле в рамках одного прогона, упирались бы в лимит и падали не из-за
 * реального бага, а из-за самого факта частых вызовов в тестах.
 */
'use strict';

const rateLimit = require('express-rate-limit');

function isDisabled() {
  return process.env.NODE_ENV === 'test' ||
         process.env.RATE_LIMIT_DISABLED === '1' ||
         process.env.RATE_LIMIT_DISABLED === 'true';
}

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDisabled(),
  message: { error: 'Слишком много запросов, попробуйте позже' },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDisabled(),
  message: { error: 'Слишком много запросов, попробуйте позже' },
});

// Единый middleware — выбирает лимитер по методу запроса. GET/HEAD — read,
// остальное (POST/PUT/DELETE/PATCH) — write. Монтируется в server/index.js
// через `app.use('/api', apiRateLimit)` — Express при этом отрезает
// префикс '/api' из req.path внутри самого middleware (стандартное
// поведение для app.use с mount-путём), поэтому здесь сравниваем с
// '/health', не '/api/health'.
function apiRateLimit(req, res, next) {
  if (req.path === '/health') return next(); // публичный healthcheck — без лимита
  if (req.method === 'GET' || req.method === 'HEAD') return readLimiter(req, res, next);
  return writeLimiter(req, res, next);
}

module.exports = apiRateLimit;
