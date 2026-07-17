/**
 * server/middleware/rateLimit.js
 *
 * Фаза 3 рефакторинга: rate limiter для /api/users/auth и /api/users/login,
 * вынесенный из index.js без изменения поведения.
 *
 * Состояние (_loginAttempts) — in-memory Map в замыкании модуля. Это НЕ
 * зависит от database.js, так что мокинг тестов тут ни при чём — модуль
 * можно смело импортировать напрямую.
 */
'use strict';

const _loginAttempts = new Map(); // ip → { count, resetAt }
const RATE_LIMIT_MAX    = 10;
const RATE_LIMIT_WINDOW = 5 * 60 * 1000;  // 5 минут
const RATE_LIMIT_BLOCK  = 15 * 60 * 1000; // блокировка 15 минут после превышения

function rateLimitLogin(req, res, next) {
  // X-Forwarded-For — заголовок, который клиент может подделать сам (это не
  // TCP-адрес соединения). Доверяем ему только если сервер явно развёрнут за
  // реверс-прокси (TRUST_PROXY=1), который сам проставляет/перезаписывает этот
  // заголовок. Без этого флага атакующий мог бы обходить rate-limit, посылая
  // случайный X-Forwarded-For на каждый запрос.
  const ip = (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for']?.split(',')[0]?.trim())
    || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = _loginAttempts.get(ip);

  if (entry) {
    // Сбрасываем окно если время вышло
    if (now > entry.resetAt) {
      _loginAttempts.delete(ip);
    } else if (entry.count >= RATE_LIMIT_MAX) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        error: `Слишком много попыток входа. Повторите через ${Math.ceil(retryAfter/60)} мин.`,
        retry_after: retryAfter
      });
    }
  }

  // Записываем попытку — только после провала (в middleware next, затем перехватим ответ)
  const origJson = res.json.bind(res);
  res.json = function(body) {
    if (res.statusCode === 401) {
      const cur = _loginAttempts.get(ip);
      if (cur && now <= cur.resetAt) {
        cur.count++;
        if (cur.count >= RATE_LIMIT_MAX) cur.resetAt = now + RATE_LIMIT_BLOCK;
      } else {
        _loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
      }
    } else if (res.statusCode === 200) {
      // Успешный вход — сбрасываем счётчик
      _loginAttempts.delete(ip);
    }
    return origJson(body);
  };

  next();
}

// Чистим старые записи раз в 10 минут
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _loginAttempts.entries()) {
    if (now > entry.resetAt) _loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000);

module.exports = { rateLimitLogin };
