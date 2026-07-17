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
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/type-codes', (req, res) => res.json(db.getTypeCodes()));

router.get('/type-mapping', (req, res) => {
  // Возвращает {name_lower: tab} для быстрого поиска в парсере CSV
  const map = {};
  for (const t of db.getTypeCodes()) {
    if (t.name && t.tab) map[t.name.trim().toLowerCase()] = t.tab;
  }
  res.json(map);
});

router.put('/type-codes', requireAuth, (req, res) => {
  if (!Array.isArray(req.body?.codes)) return res.status(400).json({ error: 'Array expected' });
  db.setTypeCodes(req.body.codes);
  res.json({ ok: true });
});

module.exports = router;
