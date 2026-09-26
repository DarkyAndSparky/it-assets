/**
 * server/lib/notify.js
 *
 * PROD-7 + PROD-14: Webhook/Telegram/Email-уведомления при событиях
 * реестра активов — три канала доставки одной и той же системы событий
 * (не три отдельных модуля: те же события, тот же white-list, тот же
 * fire-and-forget, тот же формат сообщения — дублировать всё это ради
 * email было бы избыточно, см. решение при добавлении PROD-14).
 *
 * Область действия (осознанно ограничена, не «все возможные события»):
 * только `add` (создание), `retire` (списание), `status_change` (смена
 * статуса) — это три события из истории, для которых уже существует
 * готовый объект histEntry ДО записи в БД (единая точка входа). `move` и
 * все `bulk-*` операции (bulkMoveAssets/bulkAssignInv/bulkUpdateMeta/
 * reassignEmployeeAssets/bulkImportAssets) сюда намеренно НЕ добавлены:
 * (1) при массовой операции над сотней активов уведомление на каждый —
 * это спам, а не сигнал, разумная реализация потребовала бы отдельной
 * агрегации/дебаунса, что за рамки MVP; (2) эти функции пишут в history
 * инлайн-аргументами в stmts.historyInsert.run(...), а не через
 * промежуточный объект — подключать туда нотификацию означало бы либо
 * дублировать сборку объекта, либо трогать куда больше кода ради каждого
 * элемента пачки. Явно задокументированное ограничение, не молчаливый
 * пропуск (тот же принцип, что уже применялся в PROD-9).
 *
 * Уведомления отправляются АСИНХРОННО и НЕ БЛОКИРУЮТ ответ API — ни
 * сетевая задержка до Telegram/вебхука/SMTP, ни его сбой не должны
 * замедлять или ломать обычную работу с активами. Ошибки только
 * логируются.
 *
 * SMTP-библиотека — `nodemailer`: активно поддерживается (в отличие от
 * `ldapjs`, который был осознанно отклонён на PROD-13 именно за
 * заброшенность — здесь такой проблемы нет), фактически отраслевой
 * стандарт для Node.js, без собственных транзитивных зависимостей.
 *
 * Конфигурация — через общий settings key/value стор (db.getSetting/
 * setSetting), ключ `notify_config`, тот же подход, что уже используется
 * для field_schemas (PROD-1) — отдельная SQL-таблица ради одного
 * JSON-блока не оправдана.
 *
 * SSRF-примечание: webhook_url, Telegram- и SMTP-креды настраивает
 * ТОЛЬКО admin (requireAdmin на роутах настройки) — тот же уровень
 * доверия, что и прочие admin-only интеграции в проекте (LDAP —
 * PROD-13). Отдельный SSRF-фильтр (запрет localhost/приватных
 * диапазонов) не заводим по той же причине, по которой его нет ни у
 * одной другой admin-конфигурируемой интеграции в проекте.
 */
'use strict';

const nodemailer = require('nodemailer');
const db = require('../database');
const logger = require('../logger');

const SETTING_KEY = 'notify_config';

// action_type из history, для которых МОЖЕТ сработать уведомление —
// белый список одновременно документирует область действия (см. шапку
// файла) и защищает от опечатки в config.events на будущее.
const SUPPORTED_EVENTS = ['add', 'retire', 'status_change'];

const EVENT_LABELS = {
  add: 'Новый актив',
  retire: 'Списание',
  status_change: 'Смена статуса',
};

function getConfig() {
  return db.getSetting(SETTING_KEY) || {
    enabled: false, webhook_url: '', telegram_bot_token: '', telegram_chat_id: '',
    smtp_host: '', smtp_port: 587, smtp_secure: false, smtp_user: '', smtp_password: '',
    smtp_from: '', smtp_to: '',
    events: [], notify_on_health_issues: false,
  };
}

// Секреты (bot token, вебхук — многие сервисы кладут секрет прямо в URL,
// SMTP-пароль) НИКОГДА не уходят на фронтенд в открытом виде повторно —
// тот же принцип, что уже применяется к паролям пользователей (PUT
// /api/settings/password — write-only, значение никогда не читается
// обратно). Показываем только «замаскировано, есть значение» + последние
// 4 символа для узнаваемости.
function mask(v) {
  if (!v) return '';
  return v.length <= 4 ? '••••' : '••••' + v.slice(-4);
}
function getConfigMasked() {
  const cfg = getConfig();
  return { ...cfg, webhook_url: mask(cfg.webhook_url), telegram_bot_token: mask(cfg.telegram_bot_token), smtp_password: mask(cfg.smtp_password) };
}

function resolveSecrets(cfg) {
  const current = getConfig();
  const resolve = (incoming, existing) =>
    (typeof incoming === 'string' && incoming.startsWith('••••')) ? existing : String(incoming || '').trim();
  const port = Number(cfg.smtp_port);
  return {
    enabled: !!cfg.enabled,
    webhook_url: resolve(cfg.webhook_url, current.webhook_url),
    telegram_bot_token: resolve(cfg.telegram_bot_token, current.telegram_bot_token),
    telegram_chat_id: String(cfg.telegram_chat_id || '').trim(),
    smtp_host: String(cfg.smtp_host || '').trim(),
    smtp_port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 587,
    smtp_secure: !!cfg.smtp_secure,
    smtp_user: String(cfg.smtp_user || '').trim(),
    smtp_password: resolve(cfg.smtp_password, current.smtp_password),
    smtp_from: String(cfg.smtp_from || '').trim(),
    smtp_to: String(cfg.smtp_to || '').trim(),
    events: Array.isArray(cfg.events) ? cfg.events.filter(e => SUPPORTED_EVENTS.includes(e)) : [],
    // HEALTH-1: отдельный тумблер, не завязан на events[] (те — про
    // историю активов, health-статус — совсем другая природа сигнала).
    // По умолчанию выключено — включение проактивных пингов о состоянии
    // сервера должно быть осознанным решением админа, не сюрпризом при
    // включении обычных уведомлений о новых активах.
    notify_on_health_issues: !!cfg.notify_on_health_issues,
  };
}

function setConfig(cfg) {
  const clean = resolveSecrets(cfg);
  db.setSetting(SETTING_KEY, clean);
  return clean;
}

function formatMessage(histEntry) {
  const label = EVENT_LABELS[histEntry.action_type] || histEntry.action_type;
  const lines = [
    `🗄️ IT Assets — ${label}`,
    `${histEntry.equipment || histEntry.model || ''}`.trim(),
  ];
  if (histEntry.serial) lines.push(`S/N: ${histEntry.serial}`);
  if (histEntry.filial) lines.push(`Филиал: ${histEntry.filial}`);
  if (histEntry.reason) lines.push(histEntry.reason);
  if (histEntry.changed_by) lines.push(`Кем: ${histEntry.changed_by}`);
  return lines.filter(Boolean).join('\n');
}

// Таймаут — вебхук/Telegram/SMTP могут быть недоступны (сеть, неверный
// токен/сервер), не даём одному зависшему запросу копиться фоновым
// таймером надолго.
const SEND_TIMEOUT_MS = 8000;

// Логируют неудачу сами (нужно для fire-and-forget пути в notifyEvent, где
// никто не await'ит и не смотрит на возврат) И пробрасывают исключение
// дальше (нужно для sendTest, который явно хочет знать success/failure
// для ответа админу на кнопку «Отправить тест»). notifyEvent() ниже гасит
// это исключение через .catch(() => {}) на месте вызова — не unhandled
// rejection, а осознанно проигнорированный повторно результат.
async function sendWebhook(url, histEntry, text) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, event: histEntry.action_type, asset_id: histEntry.asset_id, details: histEntry }),
      signal: controller.signal,
    });
  } catch (e) {
    logger.warn('notify', 'webhook send failed', e.message);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

async function sendTelegram(token, chatId, text) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn('notify', 'telegram send failed', { status: res.status, body: body.slice(0, 200) });
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (e) {
    if (!/^HTTP \d+$/.test(e.message)) logger.warn('notify', 'telegram send failed', e.message);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// PROD-14: `subject` отдельно от `text` (у email, в отличие от
// webhook/Telegram, есть отдельное поле темы письма) — formatMessage()
// первая строка ("🗄️ IT Assets — <событие>") естественно ложится в
// тему, остальное — в тело.
async function sendEmail(cfg, subject, text) {
  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_secure, // true — сразу TLS (обычно порт 465), false — STARTTLS/без шифрования (587/25)
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_password } : undefined,
    connectionTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  try {
    await transporter.sendMail({
      from: cfg.smtp_from || cfg.smtp_user,
      to: cfg.smtp_to,
      subject,
      text,
    });
  } catch (e) {
    logger.warn('notify', 'email send failed', e.message);
    throw e;
  } finally {
    transporter.close();
  }
}

// Вызывается ПОСЛЕ успешного COMMIT транзакции в assets.repo.js — намеренно
// fire-and-forget (не await на стороне вызывающего кода): ошибка или
// задержка доставки уведомления не должна влиять на ответ API.
function notifyEvent(histEntry) {
  let cfg;
  try { cfg = getConfig(); } catch (e) { return; } // настройки недоступны — не роняем вызывающий код
  if (!cfg.enabled) return;
  if (!cfg.events.includes(histEntry.action_type)) return;
  const text = formatMessage(histEntry);
  if (cfg.webhook_url) sendWebhook(cfg.webhook_url, histEntry, text).catch(() => {});
  if (cfg.telegram_bot_token && cfg.telegram_chat_id) {
    sendTelegram(cfg.telegram_bot_token, cfg.telegram_chat_id, text).catch(() => {});
  }
  if (cfg.smtp_host && cfg.smtp_to) {
    const subject = text.split('\n')[0];
    sendEmail(cfg, subject, text).catch(() => {});
  }
}

// Для кнопки «Отправить тестовое сообщение» в настройках — синхронно (в
// смысле await на роуте), чтобы админ сразу увидел результат, а не гадал,
// пришло ли уведомление. cfg может содержать МАСКИРОВАННЫЕ секреты (если
// админ жмёт «Тест» не поменяв поля после сохранения) — резолвим их так
// же, как при обычном сохранении, иначе улетит буквально "••••1234".
async function sendTest(rawCfg) {
  const cfg = resolveSecrets(rawCfg);
  const text = '🗄️ IT Assets — тестовое уведомление. Если вы это видите, интеграция настроена верно.';
  const results = {};
  if (cfg.webhook_url) {
    try { await sendWebhook(cfg.webhook_url, { action_type: 'test', asset_id: null }, text); results.webhook = 'sent'; }
    catch (e) { results.webhook = 'error: ' + e.message; }
  }
  if (cfg.telegram_bot_token && cfg.telegram_chat_id) {
    try { await sendTelegram(cfg.telegram_bot_token, cfg.telegram_chat_id, text); results.telegram = 'sent'; }
    catch (e) { results.telegram = 'error: ' + e.message; }
  }
  if (cfg.smtp_host && cfg.smtp_to) {
    try { await sendEmail(cfg, '🗄️ IT Assets — тестовое письмо', text); results.email = 'sent'; }
    catch (e) { results.email = 'error: ' + e.message; }
  }
  return results;
}

// HEALTH-1: проактивные уведомления о деградации health-статуса сервера
// (БД/бэкап/сертификат/диск — см. server/lib/health.js). Раньше health
// был ЧИСТО pull-based: узнать о проблеме можно было только открыв
// вкладку с health-баром или вручную дёрнув /api/settings/health — если
// никто не смотрел в интерфейс, растущий диск/просроченный сертификат
// оставались незамеченными сколько угодно. Вызывается периодическим
// таймером из index.js, переиспользует УЖЕ настроенные каналы уведомлений
// (webhook/Telegram/email) — не отдельная система с дублирующимся
// конфигом.
//
// Дедупликация по СМЕНЕ статуса, не по каждому срабатыванию таймера:
// состояние (последний overall) хранится в settings (health_notify_state)
// — при неизменном overall между вызовами уведомление НЕ отправляется
// повторно (иначе при реальной проблеме, которая держится часами, был бы
// спам каждые N минут). Уведомляет и при УЛУЧШЕНИИ статуса (например
// error → ok) — эксплуатационно полезно знать, что проблема сама
// разрешилась (место освободили, бэкап прошёл), не только что она
// началась.
const HEALTH_STATE_KEY = 'health_notify_state';
const HEALTH_LABELS = { ok: '✅ Всё в порядке', warn: '⚠️ Внимание', error: '🛑 Проблема' };

async function checkAndNotifyHealth() {
  let cfg;
  try { cfg = getConfig(); } catch (e) { return; }
  if (!cfg.enabled || !cfg.notify_on_health_issues) return;

  const { checkHealth } = require('./health'); // ленивый require — избегаем цикличности при загрузке модулей
  let result;
  try { result = checkHealth(); } catch (e) { logger.warn('notify', 'health check itself failed', e.message); return; }

  const prevState = db.getSetting(HEALTH_STATE_KEY) || { overall: 'ok' };
  if (result.overall === prevState.overall) return; // без изменений — не спамим

  db.setSetting(HEALTH_STATE_KEY, { overall: result.overall, changed_at: new Date().toISOString() });

  const failing = Object.entries(result.checks)
    .filter(([, c]) => c.status !== 'ok')
    .map(([name, c]) => `• ${name}: ${c.detail}`)
    .join('\n');
  const text = [
    `🗄️ IT Assets — статус сервера изменился: ${HEALTH_LABELS[result.overall] || result.overall}`,
    failing || 'Все проверки в норме.',
  ].join('\n');
  const subject = `🗄️ IT Assets — статус сервера: ${HEALTH_LABELS[result.overall] || result.overall}`;

  if (cfg.webhook_url) sendWebhook(cfg.webhook_url, { action_type: 'health', asset_id: null }, text).catch(() => {});
  if (cfg.telegram_bot_token && cfg.telegram_chat_id) {
    sendTelegram(cfg.telegram_bot_token, cfg.telegram_chat_id, text).catch(() => {});
  }
  if (cfg.smtp_host && cfg.smtp_to) sendEmail(cfg, subject, text).catch(() => {});
}

module.exports = {
  getConfig, getConfigMasked, setConfig, resolveSecrets, notifyEvent, sendTest,
  checkAndNotifyHealth, SUPPORTED_EVENTS,
};
