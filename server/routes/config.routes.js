/**
 * server/routes/config.routes.js
 *
 * Фаза 4b рефакторинга: экспорт/импорт конфига, вынесенный из index.js
 * без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/export', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=config.json');
  res.send(JSON.stringify(db.config.exportConfig(), null, 2));
});

router.post('/import/diff', requireAuth, (req, res) => {
  const incoming = req.body?.config;
  if (!incoming) return res.status(400).json({ error: 'Ожидается { config: {...} }' });
  const missing = ['organizations','filials','locations'].filter(k => !Array.isArray(incoming[k]));
  if (missing.length) return res.status(400).json({ error: 'Отсутствуют поля: ' + missing.join(', ') });
  try { res.json(db.config.diffConfig(incoming)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/import/apply', requireAuth, (req, res) => {
  const { clean, resolutions, incoming, changedBy } = req.body || {};
  if (!clean || !incoming) return res.status(400).json({ error: 'Ожидается { clean, resolutions, incoming }' });
  try { res.json(db.config.applyImport(clean, resolutions||[], incoming, changedBy||'admin')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
