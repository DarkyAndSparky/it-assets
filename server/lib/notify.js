/**
 * server/lib/notify.js
 *
 * PROD-7: Webhook/Telegram-уведомления при событиях реестра активов.
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
 * сетевая задержка до Telegram/вебхука, ни его сбой не должны замедлять
 * или ломать обычную работу с активами. Ошибки только логируются.
 *
 * Конфигурация — через общий settings key/value стор (db.getSetting/
 * setSetting), ключ `notify_config`, тот же подход, что уже используется
 * для field_schemas (PROD-1) — отдельная SQL-таблица ради одного
 * JSON-блока не оправдана.
 *
 * SSRF-примечание: webhook_url и Telegram-креды настраивает ТОЛЬКО admin
 * (requireAdmin на роутах настройки) — тот же уровень доверия, что и
 * прочие admin-only интеграции в проекте (например LDAP/SMTP, если бы
 * были). Отдельный SSRF-фильтр (запрет localhost/приватных диапазонов)
 * не заводим по той же причине, по которой его нет ни у одной другой
 * admin-конфигурируемой интеграции в проекте.
 */
'use strict';

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
    events: [],
  };
}

// Секреты (bot token, вебхук — многие сервисы кладут секрет прямо в URL)
// НИКОГДА не уходят на фронтенд в открытом виде повторно — тот же принцип,
// что уже применяется к паролям пользователей (PUT /api/settings/password
// — write-only, значение никогда не читается обратно). Показываем только
// «замаскировано, есть значение» + последние 4 символа для узнаваемости.
function mask(v) {
  if (!v) return '';
  return v.length <= 4 ? '••••' : '••••' + v.slice(-4);
}
function getConfigMasked() {
  const cfg = getConfig();
  return { ...cfg, webhook_url: mask(cfg.webhook_url), telegram_bot_token: mask(cfg.telegram_bot_token) };
}

function resolveSecrets(cfg) {
  const current = getConfig();
  const resolve = (incoming, existing) =>
    (typeof incoming === 'string' && incoming.startsWith('••••')) ? existing : String(incoming || '').trim();
  return {
    enabled: !!cfg.enabled,
    webhook_url: resolve(cfg.webhook_url, current.webhook_url),
    telegram_bot_token: resolve(cfg.telegram_bot_token, current.telegram_bot_token),
    telegram_chat_id: String(cfg.telegram_chat_id || '').trim(),
    events: Array.isArray(cfg.events) ? cfg.events.filter(e => SUPPORTED_EVENTS.includes(e)) : [],
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

// Таймаут — вебхук/Telegram могут быть недоступны (сеть, неверный токен),
// не даём одному зависшему запросу копиться фоновым таймером надолго.
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
  return results;
}

module.exports = { getConfig, getConfigMasked, setConfig, resolveSecrets, notifyEvent, sendTest, SUPPORTED_EVENTS };
