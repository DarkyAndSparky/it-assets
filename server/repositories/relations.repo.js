/**
 * server/repositories/relations.repo.js
 *
 * Универсальные связи между активами (asset_relations) — см. подробное
 * архитектурное обоснование над CREATE TABLE в server/db/sqlite.js:
 * почему универсальная таблица вместо meta-поля со ссылкой или отдельной
 * bespoke-таблицы под каждый тип связи, почему кардинальность НЕ
 * универсальна для всей таблицы, почему циклы проверяются только на
 * глубину 1, почему списание не блокируется и не каскадит.
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');

// Белый список типов связи — тот же паттерн, что SUPPORTED_EVENTS в
// notify.js (PROD-7). Новый тип связи = осознанное решение разработчика,
// не автоматическое расширение через UI/API.
const SUPPORTED_RELATION_TYPES = ['component_of'];

// Кардинальность — специфична для КАЖДОГО relation_type, не универсальна
// для таблицы целиком (см. обоснование в sqlite.js). 'one-parent-per-child'
// значит: to_asset_id может участвовать максимум в одной активной связи
// этого типа одновременно — обеспечено частичным UNIQUE-индексом в БД
// (idx_asset_relations_component_unique), здесь — только для быстрой,
// понятной ошибки ДО обращения к БД (defense in depth: два слоя защиты,
// а не один).
const CARDINALITY = { component_of: 'one-parent-per-child' };

const stmts = {
  insert: sqlite.prepare(`INSERT INTO asset_relations
    (id, from_asset_id, to_asset_id, relation_type, slot_label, note, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: sqlite.prepare('SELECT * FROM asset_relations WHERE id = ?'),
  del: sqlite.prepare('DELETE FROM asset_relations WHERE id = ?'),
  existingComponentLink: sqlite.prepare(
    "SELECT id FROM asset_relations WHERE to_asset_id = ? AND relation_type = 'component_of'"),
  reverseLink: sqlite.prepare(
    'SELECT id FROM asset_relations WHERE from_asset_id = ? AND to_asset_id = ? AND relation_type = ?'),
  assetExists: sqlite.prepare("SELECT id, status FROM assets WHERE id = ?"),
  assetForHistory: sqlite.prepare('SELECT id, model, type, serial, filial, location FROM assets WHERE id = ?'),
  historyInsert: sqlite.prepare(`INSERT INTO history
    (id, asset_id, action_type, date, from_who, to_who, filial, location, equipment, model, type, serial, reason, changed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  // JOIN на assets с ОБЕИХ сторон — одним запросом отдаём готовые для UI
  // подписи (модель/инв/серийник/статус) второго участника связи, без
  // отдельного N+1 похода в assets.repo.js на каждую связь.
  forAssetAsFrom: sqlite.prepare(`
    SELECT r.*, a.model AS other_model, a.inv AS other_inv, a.serial AS other_serial, a.status AS other_status
    FROM asset_relations r JOIN assets a ON a.id = r.to_asset_id
    WHERE r.from_asset_id = ?`),
  forAssetAsTo: sqlite.prepare(`
    SELECT r.*, a.model AS other_model, a.inv AS other_inv, a.serial AS other_serial, a.status AS other_status
    FROM asset_relations r JOIN assets a ON a.id = r.from_asset_id
    WHERE r.to_asset_id = ?`),
};

function _err(message, status) {
  const e = new Error(message);
  e.badRequest = status !== 404;
  e.notFound = status === 404;
  return e;
}

// История пишется СИММЕТРИЧНО move/status_change (пользователь явно
// подтвердил такое решение): по ОДНОЙ записи на КАЖДУЮ сторону связи
// (history скопирована per-asset_id, не per-событие) — привязка/отвязка
// видна и в истории компонента, и в истории того, к чему он привязан.
// Отдельная prepared statement, не переиспользует stmts.historyInsert из
// assets.repo.js — осознанно, чтобы не создавать связь repo↔repo в эту
// сторону (relations.repo.js не должен требовать assets.repo.js: в
// следующем шаге, наоборот, assets.repo.js будет знать про relations.repo.js
// для интеграции с полем типа asset_ref в схеме типов).
function _writeHistoryPair(actionType, fromRow, toRow, relationType, changedBy) {
  const now = new Date().toISOString();
  const describe = (row) => `${row.model || ''}${row.serial ? ' (S/N ' + row.serial + ')' : ''}`.trim();
  const verb = actionType === 'relation_add' ? 'Привязан к' : 'Отвязан от';
  stmts.historyInsert.run(uuidv7(), fromRow.id, actionType, now, '', '',
    fromRow.filial || '', fromRow.location || '', describe(fromRow),
    fromRow.model || '', fromRow.type || '', fromRow.serial || '',
    `${verb === 'Привязан к' ? 'Привязан компонент' : 'Отвязан компонент'}: ${describe(toRow)} (${relationType})`,
    changedBy || '');
  stmts.historyInsert.run(uuidv7(), toRow.id, actionType, now, '', '',
    toRow.filial || '', toRow.location || '', describe(toRow),
    toRow.model || '', toRow.type || '', toRow.serial || '',
    `${verb} ${describe(fromRow)} (${relationType})`,
    changedBy || '');
}

// createRelation — единственная точка входа для создания связи, все
// проверки внутри (валидация типа, существование обеих сторон, защита от
// прямого цикла A↔B, кардинальность для типов, где она задана).
function createRelation({ from_asset_id, to_asset_id, relation_type, slot_label, note }, createdBy) {
  if (!SUPPORTED_RELATION_TYPES.includes(relation_type)) {
    throw _err(`Неизвестный тип связи: ${relation_type}`, 400);
  }
  if (!from_asset_id || !to_asset_id) throw _err('from_asset_id и to_asset_id обязательны', 400);
  if (from_asset_id === to_asset_id) throw _err('Актив не может быть связан сам с собой', 400);

  const from = stmts.assetExists.get(from_asset_id);
  const to = stmts.assetExists.get(to_asset_id);
  if (!from) throw _err(`Актив from_asset_id не найден: ${from_asset_id}`, 404);
  if (!to) throw _err(`Актив to_asset_id не найден: ${to_asset_id}`, 404);

  // Прямой цикл (A→B уже есть, пытаемся создать B→A того же типа) —
  // глубже 1 шага не проверяем осознанно, см. обоснование в sqlite.js.
  if (stmts.reverseLink.get(to_asset_id, from_asset_id, relation_type)) {
    throw _err('Такая связь уже существует в обратном направлении', 400);
  }

  if (CARDINALITY[relation_type] === 'one-parent-per-child') {
    const existing = stmts.existingComponentLink.get(to_asset_id);
    if (existing) throw _err('Этот актив уже привязан как компонент к другому активу', 400);
  }

  const id = uuidv7();
  sqlite.exec('BEGIN');
  try {
    stmts.insert.run(id, from_asset_id, to_asset_id, relation_type,
      String(slot_label || ''), String(note || ''), new Date().toISOString(), createdBy || '');
    const fromFull = stmts.assetForHistory.get(from_asset_id);
    const toFull = stmts.assetForHistory.get(to_asset_id);
    _writeHistoryPair('relation_add', fromFull, toFull, relation_type, createdBy);
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return stmts.byId.get(id);
}

function deleteRelation(id, changedBy) {
  const row = stmts.byId.get(id);
  if (!row) throw _err('Связь не найдена', 404);
  sqlite.exec('BEGIN');
  try {
    stmts.del.run(id);
    const fromFull = stmts.assetForHistory.get(row.from_asset_id);
    const toFull = stmts.assetForHistory.get(row.to_asset_id);
    // Активы могли быть физически удалены (не просто списаны) — крайне
    // маловероятно в этом приложении (assets никогда не удаляются
    // хардово в обычном UI-flow), но на всякий случай не роняем отвязку
    // из-за отсутствующей строки для истории.
    if (fromFull && toFull) _writeHistoryPair('relation_remove', fromFull, toFull, row.relation_type, changedBy);
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return { ok: true };
}

// Все связи, где актив участвует ЛЮБОЙ стороной — для карточки актива,
// которая должна показать и «мои компоненты» (я — from), и «я сам
// компонент чего-то» (я — to), в одном ответе.
function listRelationsForAsset(assetId) {
  const asFrom = stmts.forAssetAsFrom.all(assetId).map(r => ({
    id: r.id, relation_type: r.relation_type, slot_label: r.slot_label, note: r.note,
    direction: 'from', // «я — источник», другая сторона в other_*
    other_asset_id: r.to_asset_id,
    other: { model: r.other_model, inv: r.other_inv, serial: r.other_serial, status: r.other_status },
    created_at: r.created_at, created_by: r.created_by,
  }));
  const asTo = stmts.forAssetAsTo.all(assetId).map(r => ({
    id: r.id, relation_type: r.relation_type, slot_label: r.slot_label, note: r.note,
    direction: 'to', // «я — цель», другая сторона в other_*
    other_asset_id: r.from_asset_id,
    other: { model: r.other_model, inv: r.other_inv, serial: r.other_serial, status: r.other_status },
    created_at: r.created_at, created_by: r.created_by,
  }));
  return [...asFrom, ...asTo];
}

module.exports = { createRelation, deleteRelation, listRelationsForAsset, SUPPORTED_RELATION_TYPES };
