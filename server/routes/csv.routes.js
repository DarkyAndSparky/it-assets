/**
 * server/routes/csv.routes.js
 *
 * Фаза 4d рефакторинга: роуты CSV-экспорта/импорта и импорта истории,
 * вынесенные из index.js без изменения поведения. Пути смешанные
 * (/api/export/csv, /api/import/*), поэтому монтируется на /api.
 */
'use strict';

const express = require('express');
const csvRepo = require('../repositories/csv.repo');
const { requireAuth, changedBy } = require('../middleware/auth');

const router = express.Router();

router.get('/export/csv', (req, res) => {
  const { tab } = req.query;
  const csv = csvRepo.exportCsv(tab);
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="IT_assets${tab?'_'+tab:''}.csv"`);
  res.send(csv);
});

router.post('/import/history', requireAuth, (req, res) => {
  try { res.json(csvRepo.importHistory(req.body?.rows, changedBy(req))); }
  catch(e) { res.status(e.badRequest ? 400 : 500).json({ error: e.message }); }
});

router.post('/import/csv/preview', requireAuth, (req, res) => {
  try { res.json(csvRepo.previewCsvImport(req.body?.rows)); }
  catch(e) { res.status(e.badRequest ? 400 : 500).json({ error: e.message }); }
});

router.post('/import/csv', requireAuth, (req, res) => {
  try {
    const { rows, create_orgs, create_employees } = req.body || {};
    res.json(csvRepo.importCsv(rows, { create_orgs, create_employees }, changedBy(req)));
  } catch(e) { res.status(e.badRequest ? 400 : 500).json({ error: e.message }); }
});

module.exports = router;
