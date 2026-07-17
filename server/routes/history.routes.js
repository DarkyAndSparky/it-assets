/**
 * server/routes/history.routes.js
 *
 * Фаза 4 рефакторинга: роут истории, вынесенный из index.js без
 * изменения поведения.
 */
'use strict';

const express = require('express');
const historyRepo = require('../repositories/history.repo');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(historyRepo.listHistory(req.query));
});

module.exports = router;
