/**
 * server/routes/relations.routes.js
 *
 * Создание/отзыв связей между активами (asset_relations). Чтение связей
 * конкретного актива — отдельный вложенный роут в assets.routes.js
 * (GET /api/assets/:id/relations), симметрично /api/assets/:id/versions
 * и /api/assets/:id/photos.
 */
'use strict';

const express = require('express');
const relationsRepo = require('../repositories/relations.repo');
const { requireAuth, changedBy } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createRelationSchema } = require('../validation/schemas');

const router = express.Router();

router.post('/', requireAuth, validate(createRelationSchema), (req, res) => {
  try {
    const row = relationsRepo.createRelation(req.body || {}, changedBy(req));
    res.status(201).json(row);
  } catch (e) {
    res.status(e.notFound ? 404 : 400).json({ error: e.message });
  }
});

router.delete('/:id', requireAuth, (req, res) => {
  try {
    res.json(relationsRepo.deleteRelation(req.params.id, changedBy(req)));
  } catch (e) {
    res.status(e.notFound ? 404 : 400).json({ error: e.message });
  }
});

module.exports = router;
