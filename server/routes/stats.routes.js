/**
 * server/routes/stats.routes.js
 *
 * Фаза 4c рефакторинга: роут статистики, вынесенный из index.js без
 * изменения поведения.
 */
'use strict';

const express = require('express');
const statsRepo = require('../repositories/stats.repo');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(statsRepo.getStats());
});

module.exports = router;
