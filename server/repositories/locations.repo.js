/**
 * server/repositories/locations.repo.js
 *
 * Фаза 1 рефакторинга: методы локаций, вынесенные из database.js
 * без изменения поведения.
 * Фаза 7c-3: переведено с lowdb (config.json) на SQLite.
 */
'use strict';

const { v7: uuidv7 } = require('uuid');
const { sqlite } = require('../db/sqlite');

const stmts = {
  selectAllIncl:  sqlite.prepare('SELECT * FROM locations ORDER BY created_at'),
  selectActive:   sqlite.prepare('SELECT * FROM locations WHERE system = 0 ORDER BY created_at'),
  selectByFilial: sqlite.prepare('SELECT * FROM locations WHERE filial_id = ? ORDER BY created_at'),
  selectActiveByFilial: sqlite.prepare('SELECT * FROM locations WHERE system = 0 AND filial_id = ? ORDER BY created_at'),
  selectOne:      sqlite.prepare('SELECT * FROM locations WHERE id = ?'),
  insert:         sqlite.prepare('INSERT INTO locations (id, name, filial_id, type, status, system, created_at, closed_at, responsible_id, responsible) VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)'),
  updateName:     sqlite.prepare('UPDATE locations SET name = ? WHERE id = ?'),
  updateType:     sqlite.prepare('UPDATE locations SET type = ? WHERE id = ?'),
  updateFilialId: sqlite.prepare('UPDATE locations SET filial_id = ? WHERE id = ?'),
  updateResponsible: sqlite.prepare('UPDATE locations SET responsible_id = ?, responsible = ? WHERE id = ?'),
  close:          sqlite.prepare('UPDATE locations SET status = ?, closed_at = ? WHERE id = ?'),
};

function toBool(row) {
  return row && { ...row, system: !!row.system };
}

function getLocations(filialId = null, includeSystem = false) {
  let rows;
  if (filialId && includeSystem)      rows = stmts.selectByFilial.all(filialId);
  else if (filialId)                  rows = stmts.selectActiveByFilial.all(filialId);
  else if (includeSystem)             rows = stmts.selectAllIncl.all();
  else                                rows = stmts.selectActive.all();
  return rows.map(toBool);
}

function getLocation(id) {
  return toBool(stmts.selectOne.get(id)) || null;
}

function createLocation({ name, filial_id, type = 'office', responsible_id }) {
  if (!name || !filial_id) throw new Error('name и filial_id обязательны');
  const id = uuidv7();
  const created_at = new Date().toISOString();
  const { respId, respName } = _resolveResponsible(responsible_id);
  stmts.insert.run(id, name, filial_id, type, 'active', created_at, respId, respName);
  return getLocation(id);
}

// WH-1: снапшот имени сотрудника рядом с id — тот же паттерн, что уже
// применяется для org/filial/location/responsible на самих активах
// (assets.repo.js) — читать список локаций не нужно джойнить с
// employees на каждый запрос, имя уже лежит рядом. Несуществующий
// employeeId — не ошибка, просто трактуется как "без держателя"
// (id и имя очищаются) — держатель склада это необязательный атрибут.
function _resolveResponsible(employeeId) {
  if (!employeeId) return { respId: null, respName: '' };
  const employeesRepo = require('./employees.repo');
  const emp = employeesRepo.getEmployee(employeeId);
  return emp ? { respId: employeeId, respName: emp.name || '' } : { respId: null, respName: '' };
}

function updateLocation(id, fields) {
  const l = stmts.selectOne.get(id);
  if (!l)       throw new Error('Локация не найдена');
  if (l.system) throw new Error('Нельзя изменить системную запись');
  if (fields.name !== undefined)      stmts.updateName.run(fields.name, id);
  if (fields.type !== undefined)      stmts.updateType.run(fields.type, id);
  if (fields.filial_id !== undefined) stmts.updateFilialId.run(fields.filial_id, id);
  if (fields.responsible_id !== undefined) {
    const { respId, respName } = _resolveResponsible(fields.responsible_id);
    stmts.updateResponsible.run(respId, respName, id);
  }
  return getLocation(id);
}

function closeLocation(id) {
  const l = stmts.selectOne.get(id);
  if (!l)       throw new Error('Локация не найдена');
  if (l.system) throw new Error('Нельзя закрыть системную запись');
  stmts.close.run('closed', new Date().toISOString(), id);
  return { closed: true };
}

module.exports = { getLocations, getLocation, createLocation, updateLocation, closeLocation };
