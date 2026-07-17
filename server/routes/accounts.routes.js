/**
 * server/routes/accounts.routes.js
 *
 * Фаза 3 рефакторинга: роуты учётных записей, вынесенные из index.js
 * без изменения поведения.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json(db.config.getAccounts());
});
router.post('/', requireAuth, (req, res) => {
  const { name='', login='', password='', note='', category='' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  try { res.json(db.config.addAccount({ name, login, password, note, category })); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id', requireAuth, (req, res) => {
  const { name, login, password, note, category } = req.body || {};
  try { res.json(db.config.updateAccount(req.params.id, { name, login, password, note, category })); }
  catch(e) { res.status(404).json({ error: e.message }); }
});
router.delete('/:id', requireAuth, (req, res) => {
  try { res.json(db.config.deleteAccount(req.params.id)); }
  catch(e) { res.status(404).json({ error: e.message }); }
});

module.exports = router;
