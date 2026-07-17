/**
 * server/routes/filials.routes.js
 *
 * Фаза 1 рефакторинга: роуты филиалов, вынесенные из index.js
 * без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.config.getFilials(req.query.system === 'true'));
});
router.post('/', requireAuth, (req, res) => {
  try { res.json(db.config.createFilial(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id', requireAuth, (req, res) => {
  try { res.json(db.config.updateFilial(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/close', requireAuth, (req, res) => {
  try { res.json(db.config.closeFilial(req.params.id, req.body?.changedBy||'admin')); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
