/**
 * server/repositories/settings.repo.js
 *
 * Фаза 3 рефакторинга: настройки, категории, справочник типов устройств.
 * Внимание: здесь два РАЗНЫХ метода про "типы кодов" с разной логикой —
 * getTypeCodesMap() (для db.TYPE_CODES getter, простой code→name словарь,
 * с фоллбэком на TYPE_CODES_MAP) и getTypeCodes() (для db.getTypeCodes(),
 * возвращает полные записи с гарантированным полем tab). Это не дубли,
 * так было в оригинале — сохраняю оба имени как есть.
 *
 * Фаза 7c-4: settings/categories/type_codes переведены на SQLite.
 * Фаза 7c-8b: getOrgCodesMap() переключён на реальный orgs.repo.js —
 * organizations в SQL с Фазы 7c-7, cfg.get('organizations') с тех пор
 * заморожен (тот же класс бага, что нашёлся в 7c-5/7c-8b: код продолжал
 * читать lowdb-коллекцию, которую никто больше не обновляет).
 */
'use strict';

const { TYPE_CODES_MAP } = require('../db/store');
const orgsRepo = require('./orgs.repo');
const { sqlite } = require('../db/sqlite');

const stmts = {
  getSetting:    sqlite.prepare('SELECT value FROM settings WHERE key = ?'),
  getAllSettings:sqlite.prepare('SELECT key, value FROM settings'),
  setSetting:    sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
  getAllCategories: sqlite.prepare('SELECT tab, items FROM categories'),
  setCategory:      sqlite.prepare('INSERT INTO categories (tab, items) VALUES (?, ?) ON CONFLICT(tab) DO UPDATE SET items = excluded.items'),
  getAllTypeCodes:  sqlite.prepare('SELECT code, name, tab FROM type_codes'),
  clearTypeCodes:   sqlite.prepare('DELETE FROM type_codes'),
  insertTypeCode:   sqlite.prepare('INSERT INTO type_codes (code, name, tab) VALUES (?, ?, ?)'),
};

function getOrgCodesMap() {
  const orgs = orgsRepo.getOrgs(false); // getOrgs(false) уже исключает системные
  return Object.fromEntries(orgs.map(o => [o.short_code, o.name]));
}

function getTypeCodesMap() {
  const rows = stmts.getAllTypeCodes.all();
  if (rows.length) return Object.fromEntries(rows.map(t => [t.code, t.name]));
  return TYPE_CODES_MAP;
}

function getSettings() {
  const rows = stmts.getAllSettings.all();
  return Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
}
function getSetting(key) {
  const row = stmts.getSetting.get(key);
  return row ? JSON.parse(row.value) : undefined;
}
function setSetting(key, value) {
  stmts.setSetting.run(key, JSON.stringify(value));
  return getSettings();
}
function getCategories() {
  const rows = stmts.getAllCategories.all();
  return Object.fromEntries(rows.map(r => [r.tab, JSON.parse(r.items)]));
}
function setCategories(tab, value) {
  stmts.setCategory.run(tab, JSON.stringify(value));
  return getCategories();
}
function getTypeCodes() {
  // Гарантируем поле tab (для старых записей без него) — уже гарантировано
  // схемой (NOT NULL DEFAULT 'os'), но оставляем явным для симметрии со
  // старым поведением на случай данных, занесённых в обход этого repo.
  return stmts.getAllTypeCodes.all().map(c => ({ tab: 'os', ...c }));
}
function setTypeCodes(codes) {
  // Полная замена набора — как и в оригинале (cfg.set('type_codes', codes)),
  // не merge по одному коду. В транзакции: без неё clear+вставки по одному
  // не атомарны (в отличие от одной lowdb-записи в оригинале) — при сбое
  // посреди цикла можно было бы потерять часть type_codes.
  sqlite.exec('BEGIN');
  try {
    stmts.clearTypeCodes.run();
    for (const c of codes) stmts.insertTypeCode.run(c.code, c.name || '', c.tab || 'os');
    sqlite.exec('COMMIT');
  } catch (e) {
    sqlite.exec('ROLLBACK');
    throw e;
  }
  return getTypeCodes();
}

// PROD-1: схема типизированных полей по type_code. Хранится через общий
// key/value settings-стор (та же таблица, что и обычные настройки) —
// не заводим отдельную SQL-таблицу ради одного JSON-блоба, ровно тот же
// подход, что уже используют getSetting/setSetting для прочих настроек.
const FIELD_SCHEMAS_KEY = 'field_schemas';

function getFieldSchemas() {
  return getSetting(FIELD_SCHEMAS_KEY) || {};
}

function getFieldSchema(typeCode) {
  const all = getFieldSchemas();
  return all[typeCode] || null;
}

function setFieldSchema(typeCode, fields) {
  const all = getFieldSchemas();
  if (fields === null) delete all[typeCode];   // сброс на дефолт (категорийный fallback)
  else all[typeCode] = fields;
  setSetting(FIELD_SCHEMAS_KEY, all);
  return all[typeCode] || null;
}

// ARCH (REL-6, составные активы): «слоты компонентов» — НЕ часть
// field_schemas/META_KEYS осознанно. field_schemas — про meta_* колонки
// в таблице assets (PROD-1: каждый key там — реальная SQL-колонка),
// слоты компонентов же вообще ничего не пишут в meta — значение живёт в
// asset_relations (Track 11). Заводить фиктивный META_KEY, который
// никогда не пишется в свою колонку, означало бы либо мусорить схему
// БД, либо учить createAsset/updateAsset специально пропускать этот тип
// поля везде, где перебирается meta, — больше риска для отлаженной
// системы PROD-1..4, чем отдельный маленький settings-ключ рядом.
//
// Формат: { [type_code]: [{ slot_label, target_type_codes: [] }] }.
// target_type_codes — МЯГКОЕ ограничение (подсказка/фильтр в UI-пикере
// на карточке актива), не проверяется на сервере при создании связи —
// relations.repo.js::createRelation ничего не знает о слотах и типах,
// это осознанно остаётся так (см. REL-6 в roadmap: кардинальность и
// защита от циклов — это про целостность данных и проверяется всегда;
// «допустимый тип цели» — это подсказка при выборе, не гарантия
// целостности, и её отсутствие на сервере не пробел в безопасности).
const COMPONENT_SLOTS_KEY = 'component_slots';

function getComponentSlots() {
  return getSetting(COMPONENT_SLOTS_KEY) || {};
}

function getComponentSlotsForType(typeCode) {
  const all = getComponentSlots();
  return all[typeCode] || [];
}

function setComponentSlotsForType(typeCode, slots) {
  const all = getComponentSlots();
  if (!slots || !slots.length) delete all[typeCode];
  else all[typeCode] = slots;
  setSetting(COMPONENT_SLOTS_KEY, all);
  return all[typeCode] || [];
}

module.exports = {
  getOrgCodesMap, getTypeCodesMap,
  getSettings, getSetting, setSetting,
  getCategories, setCategories,
  getTypeCodes, setTypeCodes,
  getFieldSchemas, getFieldSchema, setFieldSchema,
  getComponentSlots, getComponentSlotsForType, setComponentSlotsForType,
};
