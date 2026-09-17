/**
 * server/middleware/auth.js
 *
 * Фаза 2 рефакторинга (начата раньше срока — понадобилась роутам из Фазы 1,
 * чтобы избежать циклического require на index.js). Поведение не меняется.
 *
 * ВАЖНО: db берём через require('../database'), а не напрямую через
 * server/db/store.js. Тесты делают jest.mock('../server/database', ...) —
 * прямой импорт store.js обошёл бы мок и полез бы в реальные файлы на диске.
 */
'use strict';

const db = require('../database');
const { verifyPin, isEmpty } = require('../pin');
const apiKeysRepo = require('../repositories/apikeys.repo');

// PROD-11: REST API-ключи — альтернативный способ пройти requireAuth/
// requireLogin, минуя x-user-id/x-edit-password. Заголовок
// `Authorization: Bearer itak_...`. Ключ действует КАК владеющий им
// пользователь (наследует роль целиком, см. обоснование в sqlite.js) —
// один резолвер, используемый в обоих guard'ах ниже.
function _userFromApiKey(req) {
  const authz = req.headers['authorization'] || '';
  const m = /^Bearer\s+(itak_[A-Za-z0-9_-]+)/.exec(authz);
  if (!m) return null;
  const userId = apiKeysRepo.authenticateApiKey(m[1]);
  if (!userId) return null;
  const user = db.getUser(userId);
  return (user && user.active) ? user : null;
}

// SEC-1: пользователи, у которых при заводском создании PIN известен всем
// (используется, чтобы заблокировать привилегированные действия, пока не сменят).
const DEFAULT_PINS = { 'sys-user-admin': 'admn0000' };

function hasDefaultPin(user) {
  const def = DEFAULT_PINS[user.id];
  return def != null && verifyPin(def, user.pin);
}

function requireAuth(req, res, next) {
  // PROD-11: API-ключ — отдельная, более короткая ветка. Сам факт владения
  // ключом уже И ЕСТЬ пароль (ключ — высокоэнтропийный секрет, в отличие
  // от короткого PIN) — поэтому здесь НЕТ проверки x-edit-password и НЕТ
  // gate'а "смените дефолтный PIN" (тот гейт защищает интерактивный вход
  // по слабому заводскому PIN, к API-ключу отношения не имеет). Роль
  // по-прежнему проверяется — viewer через API-ключ так же не пройдёт
  // requireAuth, как и через обычный логин.
  const apiUser = _userFromApiKey(req);
  if (apiUser) {
    const effectiveRole = (isEmpty(apiUser.pin) && apiUser.role !== 'viewer') ? 'viewer' : apiUser.role;
    if (effectiveRole === 'viewer')
      return res.status(403).json({ error: 'Недостаточно прав (viewer)' });
    req.currentUser = { ...apiUser, role: effectiveRole };
    return next();
  }

  const userId = req.headers['x-user-id'];
  const pwd    = req.headers['x-edit-password'] || '';

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = db.getUser(userId);
  if (!user || !user.active)
    return res.status(401).json({ error: 'Пользователь не найден или неактивен' });

  // SEC-2: пустой PIN не даёт прав выше viewer, даже если сохранённая роль выше.
  const effectiveRole = (isEmpty(user.pin) && user.role !== 'viewer') ? 'viewer' : user.role;
  if (effectiveRole === 'viewer')
    return res.status(403).json({ error: 'Недостаточно прав (viewer)' });
  if (!db.authUser(userId, pwd))
    return res.status(401).json({ error: 'Неверный пароль' });

  // SEC-1: пока не сменил дефолтный PIN — можно только менять свой же PIN
  // (через PUT /api/users/:id или PUT /api/settings/password), остальные
  // привилегированные действия блокируются.
  if (hasDefaultPin(user)) {
    const isOwnPinChange =
      (req.method === 'PUT' && req.params?.id === user.id) ||
      (req.method === 'PUT' && req.baseUrl === '/api/settings' && req.path === '/password');
    if (!isOwnPinChange)
      return res.status(428).json({ error: 'Смените PIN по умолчанию перед продолжением', must_change_pin: true });
  }

  req.currentUser = { ...user, role: effectiveRole };
  return next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.currentUser?.role !== 'admin')
      return res.status(403).json({ error: 'Требуются права администратора' });
    next();
  });
}

// INFRA-7: requireAuth (выше) на самом деле проверяет доступ на РЕДАКТИРОВАНИЕ —
// пароль (x-edit-password) и роль не ниже operator, плюс блокирует viewer.
// Для чтения (GET активов/истории/справочников) это неверный чек — он бы
// заблокировал легитимный viewer от простого просмотра. requireLogin —
// облегчённая версия: только "пользователь существует и активен", без
// проверки пароля и роли. Именно она годится для гейтинга read-only
// роутов, которые раньше были открыты вообще без авторизации.
function requireLogin(req, res, next) {
  const apiUser = _userFromApiKey(req);
  if (apiUser) { req.currentUser = { ...apiUser }; return next(); }

  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const user = db.getUser(userId);
  if (!user || !user.active)
    return res.status(401).json({ error: 'Пользователь не найден или неактивен' });
  req.currentUser = { ...user };
  return next();
}

function changedBy(req) {
  return req.currentUser?.name || 'редактор';
}

// PROD-9 (лёгкая версия доступа по организации): применяется ПОСЛЕ
// requireAuth — currentUser.org_id === null/не задан означает "без
// ограничения" (обратная совместимость: все существующие пользователи и
// админы по умолчанию видят/пишут по всем организациям, как раньше).
// getTargetOrgIds получает req и возвращает org_id (строку) или массив
// org_id затрагиваемых записей, либо null, если проверять нечего
// (например, актив создаётся вообще без указания организации) — в этом
// случае НЕ блокируем: это light-версия, не строгая многоарендная модель,
// у неё есть известные границы (см. SCHEMA.md/роадмап), а не полная
// изоляция данных по организациям.
function requireOrgAccess(getTargetOrgIds) {
  return async (req, res, next) => {
    const restrictTo = req.currentUser?.org_id;
    if (!restrictTo) return next();
    try {
      let ids = await getTargetOrgIds(req);
      if (ids == null) return next();
      if (!Array.isArray(ids)) ids = [ids];
      const violating = ids.filter(id => id && id !== restrictTo);
      if (violating.length) {
        return res.status(403).json({ error: 'Доступ ограничен вашей организацией' });
      }
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { requireAuth, requireAdmin, requireLogin, requireOrgAccess, changedBy };
