/**
 * server/routes/categories.routes.js
 *
 * Фаза 3 рефакторинга: категории оборудования, вынесенные из index.js
 * без изменения поведения. Отдельный роутер, т.к. путь /api/categories,
 * а не /api/settings/categories.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { setCategoriesSchema } = require('../validation/schemas');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.getCategories());
});

router.put('/:tab', requireAuth, validate(setCategoriesSchema), (req, res) => {
  const { tab } = req.params;
  db.setCategories(tab, req.body.categories);
  res.json({ ok: true });
});

module.exports = router;
