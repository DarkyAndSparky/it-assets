/**
 * server/repositories/apikeys.repo.js
 *
 * PROD-11: REST API-ключи. Подробное обоснование модели (ключ = алиас
 * пользователя, key_prefix для быстрого поиска, bcrypt для хранения) —
 * см. комментарий над CREATE TABLE api_keys в server/db/sqlite.js.
 */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');

const SALT_ROUNDS = 10; // тот же параметр, что у PIN (server/pin.js) — согласованность
const KEY_PREFIX_LEN = 12; // "itak_" (5) + 7 символов — см. обоснование в sqlite.js

const stmts = {
  insert:        sqlite.prepare('INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
  byUser:        sqlite.prepare('SELECT id, name, key_prefix, created_at, last_used_at, revoked FROM api_keys WHERE user_id = ? ORDER BY created_at DESC'),
  byId:          sqlite.prepare('SELECT * FROM api_keys WHERE id = ?'),
  byPrefix:      sqlite.prepare('SELECT * FROM api_keys WHERE key_prefix = ? AND revoked = 0'),
  touchLastUsed: sqlite.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?'),
  revoke:        sqlite.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?'),
};

function _generateRawKey() {
  // base64url — без +/=, безопасен для заголовков/URL без доп.кодирования.
  return 'itak_' + crypto.randomBytes(32).toString('base64url');
}

// Создаёт ключ для указанного пользователя. ВАЖНО: сырой (полный) ключ
// возвращается ОДИН ЕДИНСТВЕННЫЙ РАЗ, в этом ответе — дальше в системе
// хранится только bcrypt-хеш, повторно получить значение ключа неоткуда
// (тот же write-only принцип, что у пароля/секретов PROD-7). Если
// пользователь потерял ключ — остаётся только отозвать и создать новый.
function createApiKey(userId, name) {
  const raw = _generateRawKey();
  const prefix = raw.slice(0, KEY_PREFIX_LEN);
  const hash = bcrypt.hashSync(raw, SALT_ROUNDS);
  const id = uuidv7();
  const now = new Date().toISOString();
  stmts.insert.run(id, userId, String(name || '').trim().slice(0, 100), hash, prefix, now);
  return { id, name: String(name || '').trim().slice(0, 100), key: raw, created_at: now };
}

function listApiKeys(userId) {
  return stmts.byUser.all(userId).map(r => ({
    id: r.id, name: r.name, key_prefix: r.key_prefix,
    created_at: r.created_at, last_used_at: r.last_used_at, revoked: !!r.revoked,
  }));
}

function getApiKeyOwner(id) {
  const row = stmts.byId.get(id);
  return row ? row.user_id : null;
}

function revokeApiKey(id) {
  stmts.revoke.run(id);
}

// Аутентификация по сырому ключу из заголовка Authorization. Возвращает
// user_id владельца при успехе, иначе null — НЕ throw, вызывающий код
// (auth.js) должен просто продолжить обычный auth-флоу при null (ключ
// невалиден/не такого формата — не обязательно ошибка запроса, запрос
// мог просто использовать обычную куки/пароль-авторизацию).
//
// Префикс сужает кандидатов почти всегда до 0-1 строки (см. обоснование
// в sqlite.js) — bcrypt.compareSync вызывается на единицы записей, не на
// весь api_keys целиком.
function authenticateApiKey(raw) {
  if (!raw || typeof raw !== 'string' || !raw.startsWith('itak_')) return null;
  const prefix = raw.slice(0, KEY_PREFIX_LEN);
  const candidates = stmts.byPrefix.all(prefix);
  for (const row of candidates) {
    if (bcrypt.compareSync(raw, row.key_hash)) {
      // best-effort — не должно блокировать сам запрос, если запись вдруг
      // не прошла (например конкурентный revoke только что удалил строку).
      try { stmts.touchLastUsed.run(new Date().toISOString(), row.id); } catch (e) {}
      return row.user_id;
    }
  }
  return null;
}

module.exports = { createApiKey, listApiKeys, getApiKeyOwner, revokeApiKey, authenticateApiKey };
