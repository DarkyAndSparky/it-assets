/**
 * server/routes/orgs.routes.js
 *
 * Фаза 1 рефакторинга: роуты организаций, вынесенные из index.js
 * без изменения поведения. db — через require('../database'),
 * чтобы не ломать jest.mock('../server/database', ...) в тестах.
 */
'use strict';

const express = require('express');
const db = require('../database');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.config.getOrgs(req.query.system === 'true'));
});
router.get('/:id', (req, res) => {
  const org = db.config.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Не найдено' });
  res.json(org);
});
router.post('/', requireAuth, (req, res) => {
  try { res.json(db.config.createOrg(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id', requireAuth, (req, res) => {
  try { res.json(db.config.updateOrg(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/rename', requireAuth, (req, res) => {
  const { newName, changedBy } = req.body || {};
  if (!newName) return res.status(400).json({ error: 'newName required' });
  try { res.json(db.config.renameOrg(req.params.id, newName, changedBy||'admin')); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/liquidate', requireAuth, (req, res) => {
  const { targetOrgId, changedBy, renumberInv } = req.body || {};
  if (!targetOrgId) return res.status(400).json({ error: 'targetOrgId required' });
  try { res.json(db.config.liquidateOrg(req.params.id, targetOrgId, changedBy||'admin', !!renumberInv)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.get('/:id/inv-rules', (req, res) => {
  const org = db.config.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Не найдено' });
  res.json(org.inv_rules || []);
});
router.post('/:id/inv-rules', requireAuth, (req, res) => {
  try { res.json(db.config.addInvRule(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.patch('/:id/inv-rules/:typeCode', requireAuth, (req, res) => {
  try { res.json(db.config.toggleInvRule(req.params.id, req.params.typeCode, !!req.body.active)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.put('/:id/inv-rules/:typeCode', requireAuth, (req, res) => {
  try { res.json(db.config.renameInvRule(req.params.id, req.params.typeCode, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.delete('/:id/inv-rules/:typeCode', requireAuth, (req, res) => {
  try { res.json(db.config.deleteInvRule(req.params.id, req.params.typeCode)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.post('/:id/inv-rules/:typeCode/delete-force', requireAuth, (req, res) => {
  const { action, targetTypeCode } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action required (reset|transfer)' });
  try { res.json(db.config.deleteInvRuleForce(req.params.id, req.params.typeCode, action, targetTypeCode)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
router.get('/:id/inv-next', requireAuth, (req, res) => {
  if (!req.query.type) return res.status(400).json({ error: 'type required' });
  try { res.json(db.config.nextInv(req.params.id, req.query.type)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
