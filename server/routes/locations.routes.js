/**
 * server/routes/locations.routes.js
 *
 * Фаза 1 рефакторинга: роуты локаций, вынесенные из index.js
 * без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.config.getLocations(req.query.filial_id||null, req.query.system==='true'));
});
router.post('/', requireAuth, (req, res) => {
  try { res.json(db.config.createLocation(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id', requireAuth, (req, res) => {
  try { res.json(db.config.updateLocation(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/close', requireAuth, (req, res) => {
  try { res.json(db.config.closeLocation(req.params.id)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
