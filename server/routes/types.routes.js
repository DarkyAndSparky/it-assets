/**
 * server/routes/types.routes.js
 *
 * Фаза 4b рефакторинга: справочник типов устройств, вынесенный из index.js
 * без изменения поведения. Монтируется на /api (не /api/type-codes),
 * т.к. содержит два независимых пути: /type-codes и /type-mapping.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth, requireLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { setTypeCodesSchema, setFieldSchemaSchema } = require('../validation/schemas');
const { META_KEYS } = require('../db/sqlite');

const router = express.Router();

// INFRA-7: раньше открыты без авторизации.
router.get('/type-codes', requireLogin, (req, res) => res.json(db.getTypeCodes()));

router.get('/type-mapping', requireLogin, (req, res) => {
  // Возвращает {name_lower: tab} для быстрого поиска в парсере CSV
  const map = {};
  for (const t of db.getTypeCodes()) {
    if (t.name && t.tab) map[t.name.trim().toLowerCase()] = t.tab;
  }
  res.json(map);
});

router.put('/type-codes', requireAuth, validate(setTypeCodesSchema), (req, res) => {
  db.setTypeCodes(req.body.codes);
  res.json({ ok: true });
});

// PROD-1: схема типизированных полей по type_code (какие meta_* поля
// показывать для данного типа устройства, каким типом ввода и с какими
// вариантами). GET отдаёт весь набор сразу (используется фронтом при
// рендере формы актива — один запрос вместо одного на каждый актив).
// PROD-4: канонический список ключей meta-полей — источник истины
// server/db/sqlite.js::META_KEYS, фронт (редактор схемы в types-admin.js)
// берёт его отсюда вместо второй копии в JS-константе, чтобы не разойтись,
// как уже бывало в этом проекте (cfg vs SQL, см. Track 0 находки).
router.get('/meta-keys', requireLogin, (req, res) => res.json(META_KEYS));

router.get('/field-schemas', requireLogin, (req, res) => res.json(db.getFieldSchemas()));

router.put('/field-schemas/:type_code', requireAuth, validate(setFieldSchemaSchema), (req, res) => {
  const saved = db.setFieldSchema(req.params.type_code, req.body.fields);
  res.json({ ok: true, fields: saved });
});

// Сброс на дефолт (категорийный fallback, см. meta-fields.js) — убирает
// кастомную схему для этого типа, а не сохраняет пустой массив полей
// (пустой массив = "у этого типа осознанно нет доп.полей", другой смысл).
router.delete('/field-schemas/:type_code', requireAuth, (req, res) => {
  db.setFieldSchema(req.params.type_code, null);
  res.json({ ok: true });
});

module.exports = router;
