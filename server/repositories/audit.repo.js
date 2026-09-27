/**
 * server/repositories/audit.repo.js
 *
 * Общесистемный аудит-лог действий (не путать с history.repo.js — тот
 * хранит только историю перемещений/версии конкретных активов). Этот
 * репозиторий — про действия пользователей и системы в целом: вход,
 * управление API-ключами, изменение настроек/LDAP, restore из бэкапа.
 *
 * Перенесено по мотивам аудита Procure-IT (соседний проект той же
 * команды) — там аналогичный модуль уже отловил реальный баг с
 * неограниченным limit в выдаче, здесь та же защита сразу заложена
 * в listAudit (см. clampLimit).
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const stmts = {
  insert: sqlite.prepare(
    'INSERT INTO audit_log (id, ts, actor_id, actor_name, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ),
};

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_LIMIT) : DEFAULT_LIMIT;
}

// actor — обычно req.user ({id, name/login}) или null для системных
// действий (например fail-логин ещё до идентификации пользователя).
// detail — любой JSON-сериализуемый объект с деталями события; проходит
// через JSON.stringify здесь, вызывающему коду думать об этом не нужно.
function logAction(actor, action, entity, entityId, detail) {
  const id = uuidv7();
  const ts = new Date().toISOString();
  const actorId = actor && actor.id ? String(actor.id) : '';
  const actorName = actor && (actor.name || actor.login) ? String(actor.name || actor.login) : '';
  let detailJson = null;
  if (detail !== undefined && detail !== null) {
    try { detailJson = JSON.stringify(detail); } catch (e) { detailJson = String(detail); }
  }
  stmts.insert.run(id, ts, actorId, actorName, String(action), String(entity || ''), String(entityId || ''), detailJson);
}

// query: { limit, actor_id, entity, entity_id, from, to } — все опциональны.
function listAudit(query = {}) {
  const conditions = [];
  const params = [];

  if (query.actor_id) { conditions.push('actor_id = ?'); params.push(String(query.actor_id)); }
  if (query.entity)   { conditions.push('entity = ?');   params.push(String(query.entity)); }
  if (query.entity_id){ conditions.push('entity_id = ?');params.push(String(query.entity_id)); }
  if (query.from)      { conditions.push('ts >= ?');      params.push(String(query.from)); }
  if (query.to)        { conditions.push('ts <= ?');      params.push(String(query.to)); }

  let sql = 'SELECT * FROM audit_log';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY ts DESC, id DESC LIMIT ?';
  params.push(clampLimit(query.limit));

  return sqlite.prepare(sql).all(...params).map(r => ({
    id: r.id,
    ts: r.ts,
    actor_id: r.actor_id,
    actor_name: r.actor_name,
    action: r.action,
    entity: r.entity,
    entity_id: r.entity_id,
    detail: r.detail ? safeParse(r.detail) : null,
  }));
}

function safeParse(json) {
  try { return JSON.parse(json); } catch (e) { return json; }
}

module.exports = { logAction, listAudit };
