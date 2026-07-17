/**
 * server/routes/assets.routes.js
 *
 * Фаза 4 рефакторинга: роуты активов, вынесенные из index.js без
 * изменения поведения.
 */
'use strict';

const express = require('express');
const assetsRepo = require('../repositories/assets.repo');
const { requireAuth, changedBy } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(assetsRepo.listAssets(req.query));
});

router.get('/search', (req, res) => {
  if (req.query.q === undefined) return res.status(400).json({ error: 'q required' });
  res.json(assetsRepo.searchAssets(req.query.q));
});

router.get('/:id', (req, res) => {
  const asset = assetsRepo.getAssetById(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Not found' });
  res.json(asset);
});

router.post('/', requireAuth, (req, res) => {
  try { res.json(assetsRepo.createAsset(req.body, changedBy(req))); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id', requireAuth, (req, res) => {
  try { res.json(assetsRepo.updateAsset(req.params.id, req.body, changedBy(req))); }
  catch(e) { res.status(e.notFound ? 404 : 400).json({ error: e.message }); }
});

router.delete('/:id', requireAuth, (req, res) => {
  try { res.json(assetsRepo.retireAsset(req.params.id, changedBy(req))); }
  catch(e) { res.status(e.notFound ? 404 : 400).json({ error: e.message }); }
});

router.post('/:id/move', requireAuth, (req, res) => {
  try { res.json(assetsRepo.moveAsset(req.params.id, req.body, changedBy(req))); }
  catch(e) { res.status(e.notFound ? 404 : 400).json({ error: e.message }); }
});

router.post('/bulk-move', requireAuth, (req, res) => {
  try { res.json(assetsRepo.bulkMoveAssets(req.body, changedBy(req))); }
  catch(e) { res.status(e.badRequest ? 400 : 500).json({ error: e.message }); }
});

router.post('/bulk-assign-inv', requireAuth, (req, res) => {
  try { res.json(assetsRepo.bulkAssignInv(req.body, changedBy(req))); }
  catch(e) { res.status(e.badRequest ? 400 : 400).json({ error: e.message }); }
});

module.exports = router;
