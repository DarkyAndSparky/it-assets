/**
 * server/routes/apikeys.routes.js
 *
 * PROD-11: самообслуживание REST API-ключами — каждый пользователь
 * создаёт/видит/отзывает СВОИ ключи; admin дополнительно может отозвать
 * ЛЮБОЙ чужой ключ (security-операция — скомпрометированный ключ должен
 * быть отзываем не только тем, у кого угнали сессию). Список чужих
 * ключей admin НЕ видит — самого значения ключа нигде не хранится, но
 * даже метаданные (имя, дата) чужих ключей — не его дело; только отзыв.
 */
'use strict';

const express = require('express');
const apiKeysRepo = require('../repositories/apikeys.repo');
const auditRepo = require('../repositories/audit.repo');
const { requireAuth, requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, (req, res) => {
  res.json(apiKeysRepo.listApiKeys(req.currentUser.id));
});

router.post('/', requireAuth, (req, res) => {
  const name = (req.body && req.body.name) || '';
  if (!name.trim()) return res.status(400).json({ error: 'name required' });
  const created = apiKeysRepo.createApiKey(req.currentUser.id, name);
  auditRepo.logAction(req.currentUser, 'apikey.create', 'apikey', created.id, { name: created.name });
  res.status(201).json(created);
});

router.delete('/:id', requireAuth, (req, res) => {
  const ownerId = apiKeysRepo.getApiKeyOwner(req.params.id);
  if (!ownerId) return res.status(404).json({ error: 'Not found' });
  if (ownerId !== req.currentUser.id && req.currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Можно отозвать только свой ключ' });
  }
  apiKeysRepo.revokeApiKey(req.params.id);
  auditRepo.logAction(req.currentUser, 'apikey.revoke', 'apikey', req.params.id, { revoked_owner_id: ownerId });
  res.json({ ok: true });
});

module.exports = router;
