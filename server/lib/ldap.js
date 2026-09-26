/**
 * server/lib/ldap.js
 *
 * PROD-13: аутентификация через LDAP/Active Directory, как альтернатива
 * локальному логину/PIN (не замена — локальные учётки продолжают
 * работать как раньше, LDAP — дополнительный путь).
 *
 * БИБЛИОТЕКА: используем `ldapts`, НЕ `ldapjs`. `ldapjs` — исторически
 * самый популярный LDAP-клиент для Node.js, но официально
 * decommissioned (автор прямо пометил пакет как заброшенный после
 * инцидента с агрессивным пользователем, не обновлялся 2+ года — см.
 * https://socket.dev/blog/ldapjs-open-source-project-decommissioned-after-maintainer-receives-abusive-email).
 * `ldapts` — активно поддерживаемый (обновления идут постоянно),
 * минимальный dependency footprint (один крошечный транзитивный пакет),
 * тот же паттерн решения, что уже был на PROD-6 (xlsx vs exceljs) —
 * не тащить в проект зависимость с историей заброшенности/уязвимостей,
 * когда есть живая альтернатива.
 *
 * ПОТОК АУТЕНТИФИКАЦИИ — классический search+bind (единственный
 * надёжный способ для AD, где DN пользователя заранее не известен по
 * одному только логину):
 *   1. Бинд сервисной учёткой (bind_dn/bind_password) — только чтобы
 *      искать.
 *   2. Поиск по base_dn с фильтром user_filter, {{username}} подставляется
 *      ЭКРАНИРОВАННЫМ (см. escapeFilter ниже) — без экранирования это
 *      LDAP injection, ровно тот же класс уязвимости, что SQL injection.
 *   3. Ровно ОДНА найденная запись — бинд НАЙДЕННЫМ DN с паролем,
 *      который ввёл пользователь. 0 или >1 совпадений — отказ (fail
 *      closed, никогда не гадаем).
 *   4. Успешный бинд под DN пользователя = аутентификация подтверждена.
 *
 * КРИТИЧНО (SEC): пустой пароль ОТКЛОНЯЕТСЯ ДО любого обращения к LDAP.
 * Почему: LDAP-серверы по стандарту трактуют BIND с пустым паролем как
 * "anonymous bind" — он УСПЕШЕН независимо от того, существует ли
 * пользователь и какой у него пароль на самом деле. Без этой проверки
 * пустая строка в поле пароля была бы универсальным ключом от любого
 * LDAP-аккаунта, чей DN удалось найти на шаге 2. Это не гипотетический
 * риск — классическая, регулярно встречающаяся ошибка LDAP-интеграций.
 */
'use strict';

const { Client, Filter } = require('ldapts');
const { v7: uuidv7 } = require('uuid');
const db = require('../database');
const logger = require('../logger');

const SETTING_KEY = 'ldap_config';
const BIND_TIMEOUT_MS = 8000; // сервер недоступен/неверный адрес — не подвешиваем /login навсегда

function getConfig() {
  return db.getSetting(SETTING_KEY) || {
    enabled: false, url: '', bind_dn: '', bind_password: '',
    base_dn: '', user_filter: '(uid={{username}})',
    default_role: 'viewer', auto_create_users: false,
  };
}

// Тот же принцип, что у notify.js (PROD-7) и паролей пользователей:
// bind_password — секрет, никогда не возвращается в открытом виде
// повторно.
function mask(v) {
  if (!v) return '';
  return v.length <= 4 ? '••••' : '••••' + v.slice(-4);
}
function getConfigMasked() {
  const cfg = getConfig();
  return { ...cfg, bind_password: mask(cfg.bind_password) };
}

function resolveSecrets(cfg) {
  const current = getConfig();
  const resolve = (incoming, existing) =>
    (typeof incoming === 'string' && incoming.startsWith('••••')) ? existing : String(incoming || '').trim();
  return {
    enabled: !!cfg.enabled,
    url: String(cfg.url || '').trim(),
    bind_dn: String(cfg.bind_dn || '').trim(),
    bind_password: resolve(cfg.bind_password, current.bind_password),
    base_dn: String(cfg.base_dn || '').trim(),
    user_filter: String(cfg.user_filter || '(uid={{username}})').trim(),
    default_role: ['admin', 'operator', 'viewer'].includes(cfg.default_role) ? cfg.default_role : 'viewer',
    auto_create_users: !!cfg.auto_create_users,
  };
}

function setConfig(cfg) {
  const clean = resolveSecrets(cfg);
  db.setSetting(SETTING_KEY, clean);
  return clean;
}

function _buildFilter(userFilterTemplate, username) {
  // Filter.escape() — экранирование значения по RFC2254 §4, ровно как
  // параметризованный SQL-запрос защищает от SQL injection. Шаблон сам
  // (скобки/операторы фильтра) НЕ экранируется — только подставляемое
  // значение.
  return userFilterTemplate.replace('{{username}}', Filter.escape(username));
}

// Ищет пользователя сервисной учёткой, возвращает его DN или null (0 или
// >1 совпадений — null, см. обоснование в шапке файла). Отдельная функция
// от bind-проверки пароля — так тестируется независимо и переиспользуется
// тестовым POST /ldap-test (проверка конфигурации без готового пароля
// живого пользователя под рукой).
async function _findUserDn(cfg, username) {
  const client = new Client({ url: cfg.url, connectTimeout: BIND_TIMEOUT_MS, timeout: BIND_TIMEOUT_MS });
  try {
    await client.bind(cfg.bind_dn, cfg.bind_password);
    const { searchEntries } = await client.search(cfg.base_dn, {
      scope: 'sub',
      filter: _buildFilter(cfg.user_filter, username),
      attributes: ['dn', 'cn', 'mail'],
    });
    if (searchEntries.length !== 1) return null;
    return searchEntries[0];
  } finally {
    await client.unbind().catch(() => {});
  }
}

// Главная функция: аутентифицирует по LDAP и возвращает ЛОКАЛЬНЫЙ объект
// пользователя (для унификации с authByLogin() — вызывающий код в
// users.routes.js не должен знать, откуда пришла аутентификация). null —
// либо LDAP выключен, либо неверные креды, либо любая ошибка сети/сервера
// (fail closed во всех случаях — разница между "сервер недоступен" и
// "неверный пароль" наружу не просачивается, тот же принцип, что и у
// локального логина).
async function authenticateAndSync(username, password) {
  let cfg;
  try { cfg = getConfig(); } catch (e) { return null; }
  if (!cfg.enabled || !cfg.url || !cfg.base_dn) return null;
  if (!username || !password) return null; // см. КРИТИЧНО в шапке файла — пустой пароль отклоняем ДО LDAP

  let entry;
  try {
    entry = await _findUserDn(cfg, username);
  } catch (e) {
    logger.warn('ldap', 'user search failed', e.message);
    return null;
  }
  if (!entry) return null;

  const userClient = new Client({ url: cfg.url, connectTimeout: BIND_TIMEOUT_MS, timeout: BIND_TIMEOUT_MS });
  try {
    await userClient.bind(entry.dn, password);
  } catch (e) {
    return null; // неверный пароль — обычный, ожидаемый случай, не логируем как warning
  } finally {
    await userClient.unbind().catch(() => {});
  }

  // Пароль подтверждён LDAP-сервером. Дальше — найти/создать ЛОКАЛЬНУЮ
  // запись пользователя (роли/права в этом приложении по-прежнему
  // локальные, LDAP отвечает только за "это точно тот человек").
  const users = db.getUsers(false);
  const loginLc = String(username).trim().toLowerCase();
  let localUser = users.find(u => u.active && u.login && u.login.toLowerCase() === loginLc);
  if (localUser) return localUser;

  if (!cfg.auto_create_users) return null; // юзер аутентифицирован LDAP, но нет локальной записи и авто-создание выключено

  // Случайный, НИКОМУ не известный локальный PIN — НЕ пустая строка.
  // Пустой PIN в этой системе — особый случай «вход без пароля» (см.
  // server/pin.js) — если бы мы поставили '', LDAP-пользователь мог бы
  // ЗАТЕМ войти локально вообще без пароля. uuidv7() как значение PIN
  // гарантирует, что локальный вход остаётся практически невозможным —
  // единственный путь входа для этой записи остаётся LDAP.
  const name = entry.cn || username;
  const email = entry.mail || '';
  try {
    return db.createUser({ name: String(name), login: String(username).trim(), role: cfg.default_role, pin: uuidv7(), email: String(email) });
  } catch (e) {
    logger.warn('ldap', 'auto-create user failed', e.message);
    return null;
  }
}

// Для кнопки «Проверить подключение» в настройках — проверяет ТОЛЬКО
// бинд сервисной учётки (без пароля реального пользователя под рукой в
// момент настройки эту часть проверить и так возможно).
async function testConnection(rawCfg) {
  const cfg = resolveSecrets(rawCfg);
  if (!cfg.url || !cfg.bind_dn) throw new Error('url и bind_dn обязательны');
  const client = new Client({ url: cfg.url, connectTimeout: BIND_TIMEOUT_MS, timeout: BIND_TIMEOUT_MS });
  try {
    await client.bind(cfg.bind_dn, cfg.bind_password);
    return { ok: true };
  } finally {
    await client.unbind().catch(() => {});
  }
}

module.exports = { getConfig, getConfigMasked, setConfig, authenticateAndSync, testConnection };
