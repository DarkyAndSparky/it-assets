const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');
const db       = require('./database');
const { hashPin, verifyPin } = require('./pin');

// Версия из package.json — единый источник правды
const pkg = (() => { try { return require('../package.json'); } catch(e) { return {}; } })();
const APP_VERSION = pkg.version || 'unknown';

// Человекочитаемая версия: beta-1-26w27-01 → β1 · 26w27·01
const APP_VERSION_DISPLAY = APP_VERSION
  .replace(/^alpha-(\d+)-/, 'α$1 · ')
  .replace(/^beta-(\d+)-/,  'β$1 · ')
  .replace(/-/g, '·');
// Live getters — db.ORG_CODES / db.TYPE_CODES are defineProperty getters on db object
// Do NOT cache at startup: org names can change at runtime
function getOrgCodes()  { return db.ORG_CODES  || {}; }
function getTypeCodes() { return db.TYPE_CODES || {}; }

const app  = express();
// Не раскрываем факт использования Express (мелкое, но бесплатное закрытие
// разведочной информации для потенциального атакующего).
app.disable('x-powered-by');

// Базовые security-заголовки. CSP сознательно не выставляем: фронтенд —
// один HTML-файл с обилием inline onclick/<script> (см. public/index.html),
// строгий CSP сломает его целиком; вводить CSP имеет смысл только вместе
// с рефакторингом фронтенда на внешние файлы. Остальные заголовки безопасны
// и ничего не ломают.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Примечание: фактические HTTP/HTTPS порты объявлены ниже, в startServer()
// (HTTP_PORT / HTTPS_PORT), и настраиваются через process.env — см. там.

// CORS: фронтенд отдаётся тем же сервером (express.static), поэтому обычному
// использованию (открыть https://ip:3443 в браузере) кросс-origin вообще не
// нужен — такие запросы браузер не помечает Origin. Список ниже нужен только
// если API дергают с другого домена (отдельный фронтенд, реверс-прокси и т.п.).
// По умолчанию список пуст → кросс-origin запросы из браузера блокируются.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true); // curl, серверные вызовы, тот же origin
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
}));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.static(path.join(__dirname, '../public')));

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const userId = req.headers['x-user-id'];
  const pwd    = req.headers['x-edit-password'] || '';

  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const user = db.getUser(userId);
  if (!user || !user.active)
    return res.status(401).json({ error: 'Пользователь не найден или неактивен' });
  if (user.role === 'viewer')
    return res.status(403).json({ error: 'Недостаточно прав (viewer)' });
  if (!db.authUser(userId, pwd))
    return res.status(401).json({ error: 'Неверный пароль' });

  req.currentUser = user;
  return next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.currentUser?.role !== 'admin')
      return res.status(403).json({ error: 'Требуются права администратора' });
    next();
  });
}

function changedBy(req) {
  return req.currentUser?.name || 'редактор';
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/api/settings', (req, res) => {
  res.json({
    company_name: db.getSetting('company_name') || 'IT ASSETS',
    logo_svg:     db.getSetting('logo_svg')     || '',
    styles:       db.getSetting('styles')       || {},
    version:      APP_VERSION,
  });
});

app.put('/api/settings/styles', requireAuth, (req, res) => {
  const { styles } = req.body || {};
  if (typeof styles !== 'object') return res.status(400).json({ error: 'object expected' });
  db.setSetting('styles', styles);
  res.json({ ok: true });
});

app.put('/api/settings/logo_svg', requireAuth, (req, res) => {
  const { svg } = req.body || {};
  if (typeof svg !== 'string') return res.status(400).json({ error: 'svg string expected' });

  const val = svg.trim();

  // Допустимые форматы:
  // 1. SVG разметка: начинается с <svg
  // 2. base64 data URL: data:image/...
  // 3. Пустая строка — сброс логотипа
  const isSvg    = val.toLowerCase().startsWith('<svg');
  const isBase64 = val.startsWith('data:image/');
  const isEmpty  = val === '';

  if (!isSvg && !isBase64 && !isEmpty) {
    return res.status(400).json({ error: 'Unsupported logo format. Expected SVG markup or image data URL.' });
  }

  // Проверяем размер (макс 512 KB)
  if (val.length > 512 * 1024) {
    return res.status(400).json({ error: 'Logo too large (max 512 KB)' });
  }

  db.setSetting('logo_svg', val);
  res.json({ ok: true });
});

// ─── AUTH: ПОЛЬЗОВАТЕЛИ СИСТЕМЫ ──────────────────────────────────────────────

// Rate limiter для попыток входа: макс 10 попыток за 5 минут с одного IP
const _loginAttempts = new Map(); // ip → { count, resetAt }
const RATE_LIMIT_MAX      = 10;
const RATE_LIMIT_WINDOW   = 5 * 60 * 1000; // 5 минут
const RATE_LIMIT_BLOCK    = 15 * 60 * 1000; // блокировка 15 минут после превышения

function rateLimitLogin(req, res, next) {
  // X-Forwarded-For — заголовок, который клиент может подделать сам (это не
  // TCP-адрес соединения). Доверяем ему только если сервер явно развёрнут за
  // реверс-прокси (TRUST_PROXY=1), который сам проставляет/перезаписывает этот
  // заголовок. Без этого флага атакующий мог бы обходить rate-limit, посылая
  // случайный X-Forwarded-For на каждый запрос.
  const ip = (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for']?.split(',')[0]?.trim())
    || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = _loginAttempts.get(ip);

  if (entry) {
    // Сбрасываем окно если время вышло
    if (now > entry.resetAt) {
      _loginAttempts.delete(ip);
    } else if (entry.count >= RATE_LIMIT_MAX) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        error: `Слишком много попыток входа. Повторите через ${Math.ceil(retryAfter/60)} мин.`,
        retry_after: retryAfter
      });
    }
  }

  // Записываем попытку — только после провала (в middleware next, затем перехватим ответ)
  const origJson = res.json.bind(res);
  res.json = function(body) {
    if (res.statusCode === 401) {
      const cur = _loginAttempts.get(ip);
      if (cur && now <= cur.resetAt) {
        cur.count++;
        if (cur.count >= RATE_LIMIT_MAX) cur.resetAt = now + RATE_LIMIT_BLOCK;
      } else {
        _loginAttempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
      }
    } else if (res.statusCode === 200) {
      // Успешный вход — сбрасываем счётчик
      _loginAttempts.delete(ip);
    }
    return origJson(body);
  };

  next();
}

// Чистим старые записи раз в 10 минут
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _loginAttempts.entries()) {
    if (now > entry.resetAt) _loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000);

app.get('/api/users', (req, res) => {
  // Список пользователей (без PIN) — доступен всем залогиненным
  const pwd = req.headers['x-edit-password'];
  const userId = req.headers['x-user-id'];
  if (!db.getUser(userId)?.active) return res.status(401).json({ error: 'Unauthorized' });
  res.json(db.getUsers().map(u => ({ id:u.id, name:u.name, role:u.role, active:u.active })));
});

app.get('/api/users/list', (req, res) => {
  // Публичный список для экрана входа (только id + name + role)
  res.json(db.getUsers().map(u => ({ id:u.id, name:u.name, role:u.role })));
});

app.post('/api/users/auth', rateLimitLogin, (req, res) => {
  const { user_id, pin } = req.body || {};
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  const user = db.authUser(user_id, pin || '');
  if (!user) return res.status(401).json({ error: 'Неверный PIN или пользователь не найден' });
  res.json({ ok:true, user:{ id:user.id, name:user.name, role:user.role } });
});

app.post('/api/users/login', rateLimitLogin, (req, res) => {
  const { login, password } = req.body || {};
  if (!login) return res.status(400).json({ error: 'login required' });
  const user = db.authByLogin(login, password || '');
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

  // Предупреждаем, если admin всё ещё использует дефолтный PIN
  const DEFAULT_PINS = ['admn0000'];
  const isDefaultPin = user.id === 'sys-user-admin' &&
    DEFAULT_PINS.some(p => verifyPin(p, user.pin));

  res.json({ ok:true, user:{ id:user.id, name:user.name, role:user.role }, warn_default_pin: isDefaultPin });
});

app.post('/api/users', requireAdmin, (req, res) => {
  try { res.json(db.createUser(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/users/:id', requireAdmin, (req, res) => {
  try { res.json(db.updateUser(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  try { res.json(db.deleteUser(req.params.id)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// /api/auth removed
app.put('/api/settings/company_name', requireAuth, (req, res) => {
  const { company_name } = req.body || {};
  if (!company_name || !company_name.trim())
    return res.status(400).json({ error: 'company_name required' });
  db.setSetting('company_name', company_name.trim());
  res.json({ ok: true, company_name: company_name.trim() });
});

// ─── USERS ────────────────────────────────────────────────────────────────────
app.put('/api/settings/password', (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || !newPassword.trim())
    return res.status(400).json({ error: 'newPassword required' });

  const userId  = req.headers['x-user-id'];
  const currPwd = req.headers['x-edit-password'] || '';

  const users = db.cfg.get('users').value() || [];

  // Находим пользователя: по id или по текущему паролю (fallback для afterEach теста)
  let idx = userId ? users.findIndex(u => u.id === userId) : -1;
  if (idx === -1) idx = users.findIndex(u => verifyPin(currPwd, u.pin));
  if (idx === -1) return res.status(401).json({ error: 'Unauthorized' });

  users[idx].pin = hashPin(newPassword.trim());
  db.cfg.set('users', users).write();
  res.json({ ok: true });
});

// ─── CATEGORIES ───────────────────────────────────────────────────────────────
app.get('/api/categories', (req, res) => {
  res.json(db.getCategories());
});
app.put('/api/categories/:tab', requireAuth, (req, res) => {
  const { tab } = req.params;
  const { categories } = req.body || {};
  if (!Array.isArray(categories)) return res.status(400).json({ error: 'Array expected' });
  db.setCategories(tab, categories);
  res.json({ ok: true });
});

// ─── ASSETS — GET ─────────────────────────────────────────────────────────────
app.get('/api/assets', (req, res) => {
  const { tab, category, org, filial, status, search, no_responsible, no_inv, no_serial, stale_days } = req.query;
  let items = db.get('assets').value().filter(a => a.status !== 'списан');

  // Строим маппинг org_id → name для фильтрации и вывода
  const orgMap = Object.fromEntries(db.config.getOrgs(true).map(o => [o.id, o.name]));
  const SYS_ORG = new Set(['sys-org-unk', '', undefined, null]);
  const resolveOrgName = a => {
    if (a.org_id && !SYS_ORG.has(a.org_id)) return orgMap[a.org_id] || a.org || '—';
    return (a.org && a.org !== '—' && a.org !== '?') ? a.org : '—';
  };

  if (tab)      items = items.filter(a => a.tab === tab);
  if (category && category !== 'Все') items = items.filter(a => a.category === category);
  if (org      && org      !== 'Все') items = items.filter(a => resolveOrgName(a) === org);
  if (filial   && filial   !== 'Все') items = items.filter(a => a.filial === filial);
  if (status   && status   !== 'Все') items = items.filter(a => a.status === status);
  if (no_responsible === '1') items = items.filter(a => !a.responsible || a.responsible === '?' || a.responsible === '—');
  if (no_inv    === '1') items = items.filter(a => !a.inv    || a.inv    === '—');
  if (no_serial === '1') items = items.filter(a => !a.serial || a.serial === '—');
  if (stale_days) {
    const cutoff = new Date(Date.now() - parseInt(stale_days)*24*60*60*1000).toISOString();
    items = items.filter(a => !a.updated_at || a.updated_at < cutoff);
  }
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(a => {
      const metaStr = JSON.stringify(a.meta||{}).toLowerCase();
      return [a.responsible,a.model,a.serial,a.inv,a.location,a.org,a.note,a.type,a.category]
        .some(v => v && v.toLowerCase().includes(q)) || metaStr.includes(q);
    });
  }
  items.sort((a,b) =>
    (a.filial||'').localeCompare(b.filial||'') ||
    (a.location||'').localeCompare(b.location||'') ||
    (a.model||'').localeCompare(b.model||'')
  );

  // Пагинация
  const total = items.length;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const page  = Math.max(parseInt(req.query.page)  || 1, 1);
  const pages = Math.ceil(total / limit) || 1;
  // Обогащаем ответ: проставляем resolved org в поле org
  const slice = items.slice((page - 1) * limit, page * limit).map(a => ({
    ...a,
    org: resolveOrgName(a),
  }));

  res.json({ items: slice, total, page, pages, limit });
});


// ─── ГЛОБАЛЬНЫЙ ПОИСК ────────────────────────────────────────────────────────
app.get('/api/assets/search', (req, res) => {
  if (req.query.q === undefined) return res.status(400).json({ error: 'q required' });
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q || q.length < 2) return res.json([]);

  const FIELDS = ['model','serial','inv','responsible','org','filial','location','type','note'];
  // Строим map org_id → name для поиска по организации
  const orgMap = Object.fromEntries(
    db.config.getOrgs(true).map(o => [o.id, o.name.toLowerCase()])
  );
  const items = db.get('assets').value()
    .filter(a => a.status !== 'списан')
    .filter(a => FIELDS.some(f => (a[f]||'').toLowerCase().includes(q))
      || (a.org_id && (orgMap[a.org_id]||'').includes(q)))
    .slice(0, 100); // не больше 100 на поиск
  res.json(items);
});

app.get('/api/assets/:id', (req, res) => {
  const asset = db.get('assets').find({ id: req.params.id }).value();
  if (!asset) return res.status(404).json({ error: 'Not found' });
  res.json(asset);
});

// ─── ASSETS — CREATE ──────────────────────────────────────────────────────────
app.post('/api/assets', requireAuth, (req, res) => {
  const { tab='os', category='', filial='', address='', location='',
          responsible='', type='', model='', serial='', status='используется',
          org='', note='', inv='', meta={} } = req.body || {};
  if (!model) return res.status(400).json({ error: 'Model required' });
  const now = new Date().toISOString();
  const asset = { id:uuidv4(), tab, category, filial, address, location,
    responsible, type, model, serial, status, org, note, inv: inv||'', meta,
    created_at:now, updated_at:now };
  const existAssets = db.get('assets').value();
  const histEntry = { id:uuidv4(), asset_id:asset.id,
    action_type:'add', date:now, from_who:'', to_who:responsible||'Склад',
    filial:filial||'', location:location||'',
    equipment:`${type} ${model}`, model, type, serial,
    reason:'Добавление в реестр', changed_by:changedBy(req) };
  db.set('assets', [...existAssets, asset])
    .set('history', [...db.get('history').value(), histEntry])
    .write();
  res.json({ id:asset.id, ok:true });
});

// ─── ASSETS — UPDATE ──────────────────────────────────────────────────────────
app.put('/api/assets/:id', requireAuth, (req, res) => {
  const asset = db.get('assets').find({ id: req.params.id }).value();
  if (!asset) return res.status(404).json({ error: 'Not found' });
  const allowed = ['tab','category','filial','address','location','responsible',
                   'type','model','serial','status','org','note','inv','meta',
                   'org_id','filial_id','location_id','responsible_id'];
  const now = new Date().toISOString();
  const update = { updated_at: now };
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  db.get('assets').find({ id: req.params.id }).assign(update).write();

  // Пишем в историю если статус изменился
  const STATUS_LABELS = {
    'используется': 'Статус: Используется',
    'резерв':       'Статус: Резерв',
    'ремонт':       'Статус: Ремонт',
  };
  if (update.status && update.status !== asset.status && update.status !== 'списан') {
    const histEntry = {
      id: uuidv4(), asset_id: req.params.id,
      action_type: 'status_change', date: now,
      from_who: asset.responsible || '',
      to_who:   update.responsible || asset.responsible || '',
      filial:   update.filial  || asset.filial  || '',
      location: update.location || asset.location || '',
      equipment: `${asset.type} ${asset.model}`,
      model: asset.model, type: asset.type, serial: asset.serial,
      reason: STATUS_LABELS[update.status] || `Статус: ${update.status}`,
      changed_by: changedBy(req),
    };
    db.set('history', [...db.get('history').value(), histEntry]).write();
  }

  res.json({ ok:true });
});

// ─── ASSETS — DELETE ──────────────────────────────────────────────────────────
app.delete('/api/assets/:id', requireAuth, (req, res) => {
  const asset = db.get('assets').find({ id: req.params.id }).value();
  if (!asset) return res.status(404).json({ error: 'Not found' });
  const retireNow = new Date().toISOString();
  db.get('assets').find({ id: req.params.id })
    .assign({ status:'списан', updated_at:retireNow }).write();
  const retireHist = { id:uuidv4(), asset_id:req.params.id,
    action_type:'retire', date:retireNow,
    from_who:asset.responsible, to_who:'',
    filial:asset.filial||'', location:asset.location||'',
    equipment:`${asset.type} ${asset.model}`, model:asset.model, type:asset.type, serial:asset.serial,
    reason:'Списание', changed_by:changedBy(req) };
  db.set('history', [...db.get('history').value(), retireHist]).write();
  res.json({ ok:true });
});

// ─── MOVE ─────────────────────────────────────────────────────────────────────
app.post('/api/assets/:id/move', requireAuth, (req, res) => {
  const asset = db.get('assets').find({ id: req.params.id }).value();
  if (!asset) return res.status(404).json({ error: 'Not found' });
  const { newResponsible, newOrg, newFilial, newAddress, newLocation, reason } = req.body || {};
  const now = new Date().toISOString();
  // Используем || вместо ?? чтобы пустые строки не затирали существующие данные
  const pick = (newVal, old) => (newVal !== undefined && newVal !== null && newVal !== '') ? newVal : old;
  db.get('assets').find({ id: req.params.id }).assign({
    responsible: pick(newResponsible, asset.responsible),
    org:         pick(newOrg,         asset.org),
    filial:      pick(newFilial,      asset.filial),
    address:     pick(newAddress,     asset.address),
    location:    pick(newLocation,    asset.location),
    updated_at:  now,
  }).write();
  // Пишем запись в историю с полным контекстом до и после
  const histReason = [
    reason || 'Перемещение',
    newOrg    && newOrg    !== asset.org    ? `орг: ${asset.org||'—'} → ${newOrg}`       : '',
    newFilial && newFilial !== asset.filial ? `филиал: ${asset.filial||'—'} → ${newFilial}` : '',
  ].filter(Boolean).join(' | ');
  const existHist = db.get('history').value();
  db.set('history', [...existHist, {
    id: uuidv4(), asset_id: req.params.id,
    action_type: 'move', date: now,
    from_who: asset.responsible||'',
    to_who:   pick(newResponsible, asset.responsible) ?? '',
    filial:   pick(newFilial,   asset.filial)   ?? '',
    location: pick(newLocation, asset.location) ?? '',
    equipment: `${asset.type} ${asset.model}`,
    model: asset.model, type: asset.type, serial: asset.serial,
    reason: histReason, changed_by: changedBy(req),
  }]).write();
  res.json({ ok:true });
});


// ─── BULK MOVE ────────────────────────────────────────────────────────────────
app.post('/api/assets/bulk-move', requireAuth, (req, res) => {
  const { ids, newResponsible, newFilial, newAddress, newLocation, reason } = req.body || {};
  if (!Array.isArray(ids) || !ids.length)
    return res.status(400).json({ error: 'ids[] required' });

  const now = new Date().toISOString();
  const pick = (newVal, old) => (newVal !== undefined && newVal !== null && newVal !== '') ? newVal : old;
  const results = { ok: 0, failed: [] };
  const existHist = db.get('history').value().slice();

  ids.forEach(id => {
    const asset = db.get('assets').find({ id }).value();
    if (!asset) { results.failed.push(id); return; }

    db.get('assets').find({ id }).assign({
      responsible: pick(newResponsible, asset.responsible),
      filial:      pick(newFilial,      asset.filial),
      address:     pick(newAddress,     asset.address),
      location:    pick(newLocation,    asset.location),
      updated_at:  now,
    }).write();

    const histReason = [
      reason || 'Массовое перемещение',
      newFilial      && newFilial !== asset.filial           ? `филиал: ${asset.filial||'—'} → ${newFilial}`               : '',
      newLocation    && newLocation !== asset.location       ? `место: ${asset.location||'—'} → ${newLocation}`             : '',
      newResponsible && newResponsible !== asset.responsible ? `ответственный: ${asset.responsible||'—'} → ${newResponsible}` : '',
    ].filter(Boolean).join(' | ');

    existHist.push({
      id: uuidv4(), asset_id: id,
      action_type: 'move', date: now,
      from_who: asset.responsible || '',
      to_who:   pick(newResponsible, asset.responsible) ?? '',
      filial:   pick(newFilial,   asset.filial)   ?? '',
      location: pick(newLocation, asset.location) ?? '',
      equipment: `${asset.type} ${asset.model}`,
      model: asset.model, type: asset.type, serial: asset.serial,
      reason: histReason, changed_by: changedBy(req),
    });
    results.ok++;
  });

  db.set('history', existHist).write();
  res.json(results);
});

// ─── BULK ASSIGN INVENTORY NUMBERS ───────────────────────────────────────────
app.post('/api/assets/bulk-assign-inv', requireAuth, (req, res) => {
  const { ids, org_id, type_code } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] required' });
  if (!org_id || !type_code) return res.status(400).json({ error: 'org_id и type_code обязательны' });

  const now = new Date().toISOString();
  let assigned = 0, skipped = 0;
  const histItems = [];

  for (const id of ids) {
    const asset = db.get('assets').find({ id }).value();
    if (!asset) { skipped++; continue; }
    if (asset.inv && asset.inv.trim()) { skipped++; continue; } // уже есть

    let inv;
    try {
      const result = db.config.nextInv(org_id, type_code.toUpperCase());
      inv = result.inv;
    } catch(e) { return res.status(400).json({ error: e.message }); }

    db.get('assets').find({ id }).assign({
      inv, org_id,
      org: (db.config.getOrgs().find(o=>o.id===org_id)||{}).name || asset.org || '',
      updated_at: now,
    }).write();

    histItems.push({
      id: uuidv4(), asset_id: id,
      action_type: 'inv_assigned', date: now,
      from_who: '', to_who: asset.responsible || '',
      filial: asset.filial || '', location: asset.location || '',
      equipment: `${asset.type} ${asset.model}`,
      model: asset.model, type: asset.type, serial: asset.serial,
      reason: `Присвоен инв. номер: ${inv}`,
      changed_by: changedBy(req),
    });
    assigned++;
  }

  if (histItems.length) {
    const hist = db.get('history').value().slice();
    db.set('history', [...hist, ...histItems]).write();
  }

  res.json({ ok: true, assigned, skipped });
});
// GET /api/inv/codes — return org and type code dictionaries
app.get('/api/inv/codes', (req, res) => {
  res.json({ orgs: getOrgCodes(), types: getTypeCodes() });
});

// GET /api/inv/next — только показать следующий номер, БЕЗ инкремента счётчика
app.get('/api/inv/next', (req, res) => {
  const { org_id, org, type } = req.query;
  if (!type) return res.status(400).json({ error: 'type required' });
  let orgId = org_id;
  if (!orgId && org) {
    const found = db.config.getOrgs().find(o => o.short_code === org.toUpperCase());
    if (!found) return res.status(404).json({ error: `Организация ${org} не найдена` });
    orgId = found.id;
  }
  if (!orgId) return res.status(400).json({ error: 'org_id or org required' });
  try { res.json(db.config.nextInv(orgId, type, { reserve: false })); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// POST /api/inv/reserve — зарезервировать номер (инкрементирует счётчик)
app.post('/api/inv/reserve', requireAuth, (req, res) => {
  const { org_id, org, type } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type required' });
  let orgId = org_id;
  if (!orgId && org) {
    const found = db.config.getOrgs().find(o => o.short_code === (org||'').toUpperCase());
    if (!found) return res.status(404).json({ error: `Организация ${org} не найдена` });
    orgId = found.id;
  }
  if (!orgId) return res.status(400).json({ error: 'org_id or org required' });
  try { const result = db.config.nextInv(orgId, type, { reserve: true }); res.json({ ok:true, ...result }); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// ─── HISTORY ──────────────────────────────────────────────────────────────────
app.get('/api/history', (req, res) => {
  const { limit=500, offset=0, asset_id, action_type, filial, org, changed_by, search, from_date, to_date } = req.query;
  let items = db.get('history').value().slice().reverse();

  // Строим карту asset_id → org_name для резолвинга
  const orgMap = Object.fromEntries(
    db.config.getOrgs(true).map(o => [o.id, o.name])
  );
  const assetOrgMap = {};
  db.get('assets').value().forEach(a => {
    if (a.id) {
      assetOrgMap[a.id] = (a.org_id && orgMap[a.org_id]) ? orgMap[a.org_id] : (a.org || '');
    }
  });

  // Обогащаем каждую запись истории названием организации
  items = items.map(h => ({
    ...h,
    org_name: h.org_snapshot || h.org || (h.asset_id ? assetOrgMap[h.asset_id] : '') || '',
  }));

  if (asset_id)    items = items.filter(h => h.asset_id === asset_id);
  if (action_type) items = items.filter(h => h.action_type === action_type);
  if (filial)      items = items.filter(h => h.filial === filial);
  if (org)         items = items.filter(h => h.org_name === org);
  if (changed_by)  items = items.filter(h => h.changed_by === changed_by);
  if (from_date)   items = items.filter(h => h.date >= from_date);
  if (to_date)     items = items.filter(h => h.date <= to_date + 'T23:59:59');
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(h =>
      (h.equipment||'').toLowerCase().includes(q) ||
      (h.from_who||'').toLowerCase().includes(q) ||
      (h.to_who||'').toLowerCase().includes(q) ||
      (h.reason||'').toLowerCase().includes(q) ||
      (h.serial||'').toLowerCase().includes(q) ||
      (h.org_name||'').toLowerCase().includes(q)
    );
  }
  const total = items.length;

  // Собираем уникальные значения для фильтров — ДО пагинации
  const filterOptions = {
    filials:    [...new Set(items.map(h => h.filial).filter(Boolean))].sort(),
    orgs:       [...new Set(items.map(h => h.org_name).filter(Boolean))].sort(),
    authors:    [...new Set(items.map(h => h.changed_by).filter(Boolean))].sort(),
  };

  const off = parseInt(offset) || 0;
  const lim = parseInt(limit);
  items = items.slice(off, off + lim);
  // stats
  const all = db.get('history').value();
  const stats = {
    total: all.length,
    today: all.filter(h => h.date && h.date.slice(0,10) === new Date().toISOString().slice(0,10)).length,
    moves: all.filter(h => !h.action_type || h.action_type === 'move').length,
    adds:  all.filter(h => h.action_type === 'add').length,
    retires: all.filter(h => h.action_type === 'retire').length,
    imports: all.filter(h => h.action_type === 'import').length,
  };
  res.json({ items, total, stats, filterOptions });
});

// ─── STATS ────────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const all     = db.get('assets').value().filter(a => a.status !== 'списан');
  const active  = all.filter(a => a.status === 'используется').length;
  const reserve = all.filter(a => a.status === 'резерв').length;
  const noResp  = all.filter(a => !a.responsible||a.responsible==='?'||a.responsible==='—').length;
  const noInv   = all.filter(a => !a.inv || a.inv === '—').length;
  const noSerial= all.filter(a => !a.serial || a.serial === '—').length;
  const count   = arr => arr.reduce((m,a) => { m[a] = (m[a]||0)+1; return m; }, {});
  const toArr   = (obj, key) => Object.entries(obj).map(([k,n]) => ({[key]:k,n})).sort((a,b)=>b.n-a.n);

  // Разрешаем org_id → name через справочник, fallback на строковое поле org
  const orgMap = Object.fromEntries(
    db.config.getOrgs(true).map(o => [o.id, o.name])
  );
  const SYS_ORG = new Set(['sys-org-unk', '', undefined, null]);
  const orgNames = all.map(a => {
    // Если есть реальный org_id — берём из справочника
    if (a.org_id && !SYS_ORG.has(a.org_id)) return orgMap[a.org_id] || a.org || '—';
    // Иначе — строковое поле org из импорта
    return (a.org && a.org !== '—' && a.org !== '?') ? a.org : '—';
  });

  res.json({
    total:all.length, active, reserve, noResp, noInv, noSerial,
    byFilial:   toArr(count(all.map(a=>a.filial)),   'filial'),
    byOrg:      toArr(count(orgNames), 'org').filter(o=>o.org!=='—'),
    byType:     toArr(count(all.map(a=>a.type)),     'type').slice(0,10),
    byTab:      toArr(count(all.map(a=>a.tab)),      'tab'),
    byCategory: toArr(count(all.map(a=>a.category)), 'category'),
  });
});

// ─── ACCOUNTS ─────────────────────────────────────────────────────────────────
app.get('/api/accounts', requireAuth, (req, res) => {
  res.json(db.config.getAccounts());
});
app.post('/api/accounts', requireAuth, (req, res) => {
  const { name='', login='', password='', note='', category='' } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  try { res.json(db.config.addAccount({ name, login, password, note, category })); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/accounts/:id', requireAuth, (req, res) => {
  const { name, login, password, note, category } = req.body || {};
  try { res.json(db.config.updateAccount(req.params.id, { name, login, password, note, category })); }
  catch(e) { res.status(404).json({ error: e.message }); }
});
app.delete('/api/accounts/:id', requireAuth, (req, res) => {
  try { res.json(db.config.deleteAccount(req.params.id)); }
  catch(e) { res.status(404).json({ error: e.message }); }
});

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
app.get('/api/export/csv', (req, res) => {
  const { tab } = req.query;
  let items = db.get('assets').value().filter(a => a.status !== 'списан');
  if (tab) items = items.filter(a => a.tab === tab);
  items.sort((a,b) => (a.filial||'').localeCompare(b.filial||''));
  const headers = ['Инв. номер','Вкладка','Коллекция','Филиал','Расположение','Ответственный',
                   'Тип','Модель','Серийный №','Статус','Организация','Примечание',
                   'IP','MAC','Подсеть','WinBox/URL','Логин','Пароль','Hostname','Картриджи','Прошивка','ИНВ шкаф'];
  const csv = [headers, ...items.map(r => [
    r.inv||'',r.tab,r.category,r.filial,r.location,r.responsible,r.type,r.model,r.serial,r.status,r.org,r.note,
    r.meta?.ip||'',r.meta?.mac||'',r.meta?.subnet||'',r.meta?.winbox||r.meta?.controller||'',
    r.meta?.login||'',r.meta?.password||'',r.meta?.hostname||'',
    r.meta?.cartridge||'',r.meta?.firmware||'',r.meta?.cabinet||r.meta?.inv||''
  ])].map(r => r.map(c => `"${String(c||'').replace(/"/g,'""')}"`).join(';')).join('\n');
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="IT_assets${tab?'_'+tab:''}.csv"`);
  res.send('\uFEFF'+csv);
});

// ─── HISTORY IMPORT ───────────────────────────────────────────────────────────
app.post('/api/import/history', requireAuth, (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows)||!rows.length) return res.status(400).json({ error: 'No data' });
  let added=0, skipped=0;
  const toAdd = [];
  // build dedup keys from existing history
  const existing = new Set(
    db.get('history').value().map(h => `${h.date&&h.date.slice(0,10)}|${h.equipment&&h.equipment}|${h.from_who}`)
  );
  rows.forEach(r => {
    if (!r.date && !r.equipment) { skipped++; return; }
    const key = `${r.date&&r.date.slice(0,10)}|${r.equipment&&r.equipment}|${r.from_who||''}`;
    if (existing.has(key)) { skipped++; return; }
    existing.add(key);
    // normalize Excel date serials (e.g. 46182) to ISO string
    let dateVal = r.date || new Date().toISOString();
    if (dateVal && /^\d{4,5}$/.test(dateVal.trim())) {
      const excelEpoch = new Date(1899, 11, 30);
      excelEpoch.setDate(excelEpoch.getDate() + parseInt(dateVal));
      dateVal = excelEpoch.toISOString().slice(0,10);
    }
    toAdd.push({
      id: uuidv4(),
      asset_id: r.asset_id||'',
      action_type: r.action_type||'move',
      date: dateVal,
      from_who: r.from_who||'',
      to_who: r.to_who||'',
      filial: r.filial||'',
      location: r.location||'',
      equipment: r.equipment||'',
      model: r.model||'',
      type: r.type||'',
      serial: r.serial||'',
      reason: r.reason||'Перемещение',
      changed_by: r.changed_by||changedBy(req)
    });
    added++;
  });
  if (toAdd.length) {
    const existHist = db.get('history').value();
    db.set('history', [...existHist, ...toAdd]).write();
  }
  res.json({ ok:true, added, skipped });
});

// ─── CSV IMPORT PREVIEW — проверка новых организаций ─────────────────────────
app.post('/api/import/csv/preview', requireAuth, (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No data' });

  const existingOrgs = db.config.getOrgs(true);
  const existingMap  = new Map(existingOrgs.map(o => [o.name.trim().toLowerCase(), o]));

  const unknownOrgs = new Map(); // name → {count, example_type, example_model}
  rows.forEach(r => {
    const name = (r.org || '').trim();
    if (!name || name === '—' || name === '?') return;
    const key = name.toLowerCase();
    if (existingMap.has(key)) return;
    if (!unknownOrgs.has(key)) {
      unknownOrgs.set(key, { name, count: 0, example: `${r.type||''} ${r.model||''}`.trim() });
    }
    unknownOrgs.get(key).count++;
  });

  res.json({
    ok: true,
    unknown_orgs: [...unknownOrgs.values()],
    total_rows: rows.length,
  });
});

// ─── CSV IMPORT ───────────────────────────────────────────────────────────────
app.post('/api/import/csv', requireAuth, (req, res) => {
  const { rows } = req.body || {};
  if (!Array.isArray(rows)||!rows.length) return res.status(400).json({ error: 'No data' });
  let added=0, skipped=0;
  const skipReasons = { dupe_serial:0, dupe_key:0, no_model:0 };
  const now = new Date().toISOString();
  const existingBySerial = new Set(db.get('assets').value().map(a => a.serial).filter(s => s && s.trim() && !['−','-','—','–'].includes(s.trim())));
  const existingByKey = new Set(db.get('assets').value()
    .filter(a => !a.serial || !a.serial.trim())
    .map(a => `${a.model}|${a.filial}|${a.location}|${a.responsible}`.toLowerCase()));

  // ── Вспомогательная функция: найти или создать филиал/локацию ─────────────
  function resolveFilial(name) {
    if (!name || !name.trim()) return 'sys-filial-unk';
    const key = name.trim().toLowerCase();
    const existing = db.config.getFilials(true).find(f => f.name.trim().toLowerCase() === key);
    if (existing) return existing.id;
    // Создаём новый филиал
    const created = db.config.createFilial({ name: name.trim(), address: '' });
    return created.id;
  }

  function resolveLocation(name, filial_id) {
    if (!name || !name.trim()) return 'sys-location-unk';
    const key = name.trim().toLowerCase();
    const existing = db.config.getLocations(filial_id, true)
      .find(l => l.name.trim().toLowerCase() === key);
    if (existing) return existing.id;
    // Создаём новую локацию
    const created = db.config.createLocation({ name: name.trim(), filial_id, type: 'office' });
    return created.id;
  }

  // ── Резолвим организации: строка → id ─────────────────────────────────────
  const createOrgsAuto = req.body.create_orgs !== false; // по умолчанию создаём
  const orgCache = new Map(); // name.lower → id (кэш для этого импорта)

  function resolveOrg(name) {
    if (!name || !name.trim() || ['—','?','-'].includes(name.trim())) return 'sys-org-unk';
    const key = name.trim().toLowerCase();
    if (orgCache.has(key)) return orgCache.get(key);

    const existing = db.config.getOrgs(true).find(o => o.name.trim().toLowerCase() === key);
    if (existing) { orgCache.set(key, existing.id); return existing.id; }

    if (!createOrgsAuto) { orgCache.set(key, 'sys-org-unk'); return 'sys-org-unk'; }

    // Создаём новую организацию автоматически
    let short_code = name.trim().replace(/[^A-ZА-ЯЁa-zа-яё0-9]/g,'').slice(0,5).toUpperCase() || 'ORG';
    const allOrgs  = db.config.getOrgs(true);
    let suffix = 1;
    while (allOrgs.find(o => o.short_code === short_code)) short_code = short_code.slice(0,4) + suffix++;
    try {
      const created = db.config.createOrg({ name: name.trim(), short_code });
      orgCache.set(key, created.id);
      return created.id;
    } catch(e) {
      // Если гонка — пробуем найти снова
      const retry = db.config.getOrgs(true).find(o => o.name.trim().toLowerCase() === key);
      const id = retry ? retry.id : 'sys-org-unk';
      orgCache.set(key, id);
      return id;
    }
  }

  // ── Резолвим сотрудников: строка → id ────────────────────────────────────
  const createEmpAuto = req.body.create_employees !== false; // по умолчанию создаём
  const empCache = new Map(); // name.lower → id (кэш для этого импорта)

  function resolveEmployee(name) {
    if (!name || !name.trim() || ['—','?','-'].includes(name.trim())) return '';
    const key = name.trim().toLowerCase();
    if (empCache.has(key)) return empCache.get(key);

    // Ищем среди employees в cfg
    const existing = (db.cfg.get('employees').value() || [])
      .find(e => e.name && e.name.trim().toLowerCase() === key);
    if (existing) { empCache.set(key, existing.id); return existing.id; }

    if (!createEmpAuto) { empCache.set(key, ''); return ''; }

    // Создаём нового сотрудника автоматически
    try {
      const newEmp = {
        id: uuidv4(),
        name: name.trim(),
        department: '',
        phone: '',
        email: '',
        active: true,
        created_at: new Date().toISOString()
      };
      const allEmps = db.cfg.get('employees').value() || [];
      db.cfg.set('employees', [...allEmps, newEmp]).write();
      empCache.set(key, newEmp.id);
      return newEmp.id;
    } catch(e) {
      // Если гонка — пробуем найти снова
      const retry = (db.cfg.get('employees').value() || [])
        .find(e => e.name && e.name.trim().toLowerCase() === key);
      const id = retry ? retry.id : '';
      empCache.set(key, id);
      return id;
    }
  }

  // Маппинг тип → категория из справочника и конфига
  const typeCodes = db.getTypeCodes();
  const typeTabMap = {};
  typeCodes.forEach(t => { typeTabMap[t.name.trim().toLowerCase()] = t.tab || 'os'; });

  const catsByTab = db.getCategories(); // {os:[...], small:[...], infra:[...]}

  // Тип → категория: инфра-типы разбиваем по подкатегориям
  const TYPE_CAT_MAP = {
    // infra
    'коммутатор':'Сетевое оборудование','маршрутизатор':'Сетевое оборудование',
    'точка доступа':'Wi-Fi','радиомост':'Сетевое оборудование',
    'poe инжектор':'Сетевое оборудование','poe hub':'Сетевое оборудование',
    'видеорегистратор':'Видеонаблюдение','камера':'Видеонаблюдение',
    'ибп':'ИБП','сервер':'Серверы','nas':'Серверы',
    'вызывная панель':'Видеонаблюдение','видеодомофон':'Видеонаблюдение',
    // os — оргтехника
    'мфу':'Оргтехника','принтер':'Оргтехника','сканер штрихкода':'Оргтехника',
    // os — пользовательское
    'ноутбук':'Оборудование пользователей','системный блок':'Оборудование пользователей',
    'монитор':'Оборудование пользователей','телевизор':'Оборудование пользователей',
    'мини пк':'Мини ПК',
    // small
    'компьютерная мышь':'Периферия','клавиатура':'Периферия','usb-hub':'Периферия',
    'патч-корд':'Периферия','сетевой фильтр':'Периферия','адаптер':'Периферия',
    'кронштейн':'Периферия','ssd/hdd':'Периферия','web камера':'Периферия',
    'стилус':'Периферия','сумка':'Периферия','защитное стекло':'Периферия',
    'смартфон':'Периферия','планшет':'Периферия',
    'тсд':'Периферия','сканер':'Периферия',
    'гарнитура':'Гарнитуры','наушники':'Гарнитуры','спикерфон':'Гарнитуры',
    'колонки':'Колонки','яндекс.станция':'Колонки',
  };

  function resolveCategory(type, tab) {
    // 1. Прямое совпадение из маппинга
    const typeKey = (type||'').trim().toLowerCase();
    const mapped  = TYPE_CAT_MAP[typeKey];
    if (mapped) {
      // Проверяем что такая категория есть в конфиге вкладки
      const tabCats = catsByTab[tab] || [];
      if (tabCats.includes(mapped)) return mapped;
    }
    // 2. Первая категория вкладки
    const tabCats = catsByTab[tab] || [];
    return tabCats[0] || '';
  }

  // Маппинг тип → type_code для инв. номеров (по справочнику)
  const typeCodeMap = {}; // name.lower → code
  typeCodes.forEach(t => { typeCodeMap[t.name.trim().toLowerCase()] = t.code; });

  // ИТ-организация как fallback для инв. номеров
  const IT_ORG_CODES = ['ит', 'it', 'ит-склад', 'its'];
  const allOrgs = db.config.getOrgs(true).filter(o => !o.system);
  const itOrg   = allOrgs.find(o => IT_ORG_CODES.includes((o.short_code||'').toLowerCase())) || null;

  function resolveTypeCode(typeName) {
    // Ищем type_code по имени типа
    return typeCodeMap[(typeName||'').trim().toLowerCase()] || null;
  }

  function tryAssignInv(asset) {
    // Пробуем присвоить инв. номер при импорте для устройств без серийника
    if (asset.inv && asset.inv.trim()) return asset.inv; // уже есть
    // Определяем организацию: указанная → ИТ-склад → ничего
    let orgId = asset.org_id;
    if (!orgId || orgId === 'sys-org-unk') {
      if (itOrg) orgId = itOrg.id;
      else return '';
    }
    const org = db.config.getOrgs(true).find(o => o.id === orgId);
    if (!org || !org.inv_rules || !org.inv_rules.length) {
      // Нет правил у указанной орг — пробуем ИТ-склад
      if (itOrg && itOrg.id !== orgId && itOrg.inv_rules && itOrg.inv_rules.length) {
        orgId = itOrg.id;
      } else return '';
    }
    const typeCode = resolveTypeCode(asset.type);
    if (!typeCode) return '';
    try {
      const result = db.config.nextInv(orgId, typeCode, { reserve: true });
      // Обновляем org_id ассета если использовали ИТ-склад
      if (orgId !== asset.org_id) {
        asset.org_id = orgId;
        asset.org    = (db.config.getOrgs(true).find(o=>o.id===orgId)||{}).name || asset.org;
      }
      return result.inv;
    } catch(e) { return ''; }
  }

  const toAdd = [];
  rows.forEach(r => {
    if (!r.model) { skipped++; skipReasons.no_model++; return; }
    if (r.serial && existingBySerial.has(r.serial)) { skipped++; skipReasons.dupe_serial++; return; }
    if (!r.serial) {
      const key = `${r.model}|${r.filial||''}|${r.location||''}|${r.responsible||''}`.toLowerCase();
      if (existingByKey.has(key)) { skipped++; skipReasons.dupe_key++; return; }
      existingByKey.add(key);
    }
    if (r.serial) existingBySerial.add(r.serial);

    const filial_id   = resolveFilial(r.filial);
    const location_id = resolveLocation(r.location, filial_id);
    const org_id      = resolveOrg(r.org);
    const responsible_id = resolveEmployee(r.responsible);
    const tab         = r.tab || 'os';
    const category    = r.category || resolveCategory(r.type, tab);

    const asset = { id:uuidv4(), inv:r.inv||'', tab, category,
      filial:r.filial||'', address:r.address||'', location:r.location||'',
      filial_id, location_id, org_id, responsible_id,
      responsible:r.responsible||'', type:r.type||'', model:r.model,
      serial:r.serial||'', status:r.status||'используется',
      org:r.org||'', note:r.note||'',
      meta:{ ip:r.ip||'', mac:r.mac||'', subnet:r.subnet||'',
             login:r.login||'', password:r.password||'',
             hostname:r.hostname||'', firmware:r.firmware||'', cabinet:r.cabinet||'' },
      created_at:now, updated_at:now };

    // Авто-присвоение инв. номера для устройств без серийника
    if (!asset.serial) {
      const autoInv = tryAssignInv(asset);
      if (autoInv) asset.inv = autoInv;
    }

    toAdd.push(asset);
    added++;
  });
  const inv_assigned = toAdd.filter(a => a.inv && a.inv.trim() && !a.serial).length;
  const created_orgs = [...orgCache.entries()]
    .filter(([,id]) => id !== 'sys-org-unk')
    .map(([name]) => name);
  if (toAdd.length) {
    const now2 = new Date().toISOString();
    const histItems = toAdd.map(item => ({ id:uuidv4(), asset_id:item.id,
      action_type:'import',
      date:now2, from_who:'', to_who:item.responsible||'Склад',
      filial:item.filial||'', location:item.location||'',
      equipment:`${item.type} ${item.model}`, model:item.model, type:item.type, serial:item.serial,
      reason: item.inv ? `Импорт CSV · инв.№ ${item.inv}` : 'Импорт CSV',
      changed_by:changedBy(req) }));
    const existAssets = db.get('assets').value();
    const existHistory = db.get('history').value();
    db.set('assets', [...existAssets, ...toAdd])
      .set('history', [...existHistory, ...histItems])
      .write();
  }
  res.json({ ok:true, added, skipped, skipReasons, inv_assigned, created_orgs,
    message: skipped > 0
      ? `Добавлено: ${added}. Пропущено: ${skipped} (серийник уже есть: ${skipReasons.dupe_serial}, дубль без серийника: ${skipReasons.dupe_key}, нет модели: ${skipReasons.no_model})`
      : `Успешно добавлено: ${added} единиц оборудования`
  });
});

// ─── DB DIAGNOSTICS ──────────────────────────────────────────────────────────
app.get('/api/diag', (req, res) => {
  const fs2 = require('fs');
  const dbPath = require('path').join(__dirname, '..', 'data', 'db.json');
  let writable = false, fileSize = 0, lastWrite = null;
  try { fs2.accessSync(dbPath, fs2.constants.W_OK); writable = true; } catch(e) {}
  try { const s = fs2.statSync(dbPath); fileSize = s.size; lastWrite = s.mtime; } catch(e) {}
  let writeOk = false;
  try { db.set('_meta.diag_ping', Date.now()).write(); writeOk = true; } catch(e) {}
  const schemaVer = db.cfg.get('_meta.schema_version').value() || '?';

  // Информация о последнем бэкапе
  let lastBackup = null;
  let backupCount = 0;
  try {
    const backups = listBackups();
    backupCount = backups.length;
    if (backups.length > 0) {
      lastBackup = { file: backups[0].name, mtime: backups[0].mtime, size: backups[0].size, full: backups[0].full };
    }
  } catch(e) {}

  res.json({
    dbPath, writable, writeOk, fileSize, lastWrite,
    schema_version: schemaVer,
    assets: db.get('assets').value().length,
    history: db.get('history').value().length,
    backup: { last: lastBackup, count: backupCount, dir: BACKUP_DIR },
  });
});

// Принудительный запуск миграций (для ручного пересчёта категорий и т.д.)
app.post('/api/migrate', requireAdmin, (req, res) => {
  try {
    const migrate = require('./migrate');
    // Сбрасываем версию чтобы миграция перезапустила все шаги
    const targetVersion = parseInt(req.body.from_version || 0);
    db.cfg.set('_meta.schema_version', targetVersion).write();
    migrate(db, db.cfg);
    const newVer = db.cfg.get('_meta.schema_version').value();
    res.json({ ok: true, schema_version: newVer });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ─── СПРАВОЧНИК: СОТРУДНИКИ ───────────────────────────────────────────────────
app.get('/api/employees', (req, res) => {
  if (!db.getUser(req.headers['x-user-id'])?.active)
    return res.status(401).json({ error: 'Unauthorized' });
  const { q, active } = req.query;
  if (q) return res.json(db.searchEmployees(q));
  res.json(db.getEmployees(active !== 'false'));
});

app.get('/api/employees/:id', (req, res) => {
  if (!db.getUser(req.headers['x-user-id'])?.active)
    return res.status(401).json({ error: 'Unauthorized' });
  const emp = db.getEmployee(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Не найден' });
  res.json(emp);
});

app.post('/api/employees', requireAuth, (req, res) => {
  try { res.json(db.createEmployee(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/employees/:id', requireAuth, (req, res) => {
  try { res.json(db.updateEmployee(req.params.id, req.body)); }
  catch(e) { res.status(e.message.includes('не найден') ? 404 : 400).json({ error: e.message }); }
});

app.delete('/api/employees/:id', requireAuth, (req, res) => {
  try { res.json(db.deleteEmployee(req.params.id)); }
  catch(e) { res.status(e.message.includes('не найден') ? 404 : 409).json({ error: e.message }); }
});

// ─── Переместить оборудование при увольнении сотрудника ───
app.post('/api/employees/:id/reassign-assets', requireAuth, (req, res) => {
  try {
    const employeeId = req.params.id;
    const { to_employee_id } = req.body || {};
    
    const emp = db.getEmployee(employeeId);
    if (!emp) return res.status(404).json({ error: 'Сотрудник не найден' });
    
    // Получаем активы сотрудника
    const assets = db.get('assets').value()
      .filter(a => a.status !== 'списан' && a.responsible === emp.name);
    
    if (assets.length === 0) {
      return res.json({ ok: true, moved: 0, left_unassigned: 0 });
    }
    
    const now = new Date().toISOString();
    const allAssets = db.get('assets').value();
    const historyItems = [];
    
    assets.forEach(asset => {
      const idx = allAssets.findIndex(a => a.id === asset.id);
      if (idx !== -1) {
        const oldResp = allAssets[idx].responsible;
        
        if (to_employee_id) {
          // Переместить на другого сотрудника
          const toEmp = db.getEmployee(to_employee_id);
          if (toEmp) {
            allAssets[idx].responsible = toEmp.name;
            allAssets[idx].responsible_id = toEmp.id;
            allAssets[idx].updated_at = now;
            
            historyItems.push({
              id: uuidv4(),
              asset_id: asset.id,
              action_type: 'reassign',
              date: now,
              from_who: oldResp || '',
              to_who: toEmp.name,
              filial: asset.filial || '',
              location: asset.location || '',
              equipment: `${asset.type} ${asset.model}`,
              model: asset.model,
              type: asset.type,
              serial: asset.serial,
              reason: `Переместить при увольнении ${emp.name}`,
              changed_by: changedBy(req)
            });
          }
        } else {
          // Оставить без ответственного, но в той же организации
          allAssets[idx].responsible = '';
          allAssets[idx].responsible_id = '';
          allAssets[idx].updated_at = now;
          
          historyItems.push({
            id: uuidv4(),
            asset_id: asset.id,
            action_type: 'reassign',
            date: now,
            from_who: oldResp || '',
            to_who: 'Без ответственного',
            filial: asset.filial || '',
            location: asset.location || '',
            equipment: `${asset.type} ${asset.model}`,
            model: asset.model,
            type: asset.type,
            serial: asset.serial,
            reason: `Оставлено без ответственного при увольнении ${emp.name}`,
            changed_by: changedBy(req)
          });
        }
      }
    });
    
    db.set('assets', allAssets)
      .set('history', [...db.get('history').value(), ...historyItems])
      .write();
    
    res.json({ 
      ok: true, 
      moved: to_employee_id ? assets.length : 0,
      left_unassigned: !to_employee_id ? assets.length : 0
    });
  } catch(e) { 
    res.status(400).json({ error: e.message }); 
  }
});

// ─── СПРАВОЧНИК: ОРГАНИЗАЦИИ ──────────────────────────────────────────────────

app.get('/api/orgs', (req, res) => {
  res.json(db.config.getOrgs(req.query.system === 'true'));
});
app.get('/api/orgs/:id', (req, res) => {
  const org = db.config.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Не найдено' });
  res.json(org);
});
app.post('/api/orgs', requireAuth, (req, res) => {
  try { res.json(db.config.createOrg(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/orgs/:id', requireAuth, (req, res) => {
  try { res.json(db.config.updateOrg(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/orgs/:id/rename', requireAuth, (req, res) => {
  const { newName, changedBy } = req.body || {};
  if (!newName) return res.status(400).json({ error: 'newName required' });
  try { res.json(db.config.renameOrg(req.params.id, newName, changedBy||'admin')); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/orgs/:id/liquidate', requireAuth, (req, res) => {
  const { targetOrgId, changedBy, renumberInv } = req.body || {};
  if (!targetOrgId) return res.status(400).json({ error: 'targetOrgId required' });
  try { res.json(db.config.liquidateOrg(req.params.id, targetOrgId, changedBy||'admin', !!renumberInv)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/orgs/:id/inv-rules', (req, res) => {
  const org = db.config.getOrg(req.params.id);
  if (!org) return res.status(404).json({ error: 'Не найдено' });
  res.json(org.inv_rules || []);
});
app.post('/api/orgs/:id/inv-rules', requireAuth, (req, res) => {
  try { res.json(db.config.addInvRule(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.patch('/api/orgs/:id/inv-rules/:typeCode', requireAuth, (req, res) => {
  try { res.json(db.config.toggleInvRule(req.params.id, req.params.typeCode, !!req.body.active)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/orgs/:id/inv-rules/:typeCode', requireAuth, (req, res) => {
  try { res.json(db.config.renameInvRule(req.params.id, req.params.typeCode, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.delete('/api/orgs/:id/inv-rules/:typeCode', requireAuth, (req, res) => {
  try { res.json(db.config.deleteInvRule(req.params.id, req.params.typeCode)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/orgs/:id/inv-rules/:typeCode/delete-force', requireAuth, (req, res) => {
  const { action, targetTypeCode } = req.body || {};
  if (!action) return res.status(400).json({ error: 'action required (reset|transfer)' });
  try { res.json(db.config.deleteInvRuleForce(req.params.id, req.params.typeCode, action, targetTypeCode)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/orgs/:id/inv-next', requireAuth, (req, res) => {
  if (!req.query.type) return res.status(400).json({ error: 'type required' });
  try { res.json(db.config.nextInv(req.params.id, req.query.type)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// ─── СПРАВОЧНИК: ФИЛИАЛЫ ──────────────────────────────────────────────────────

app.get('/api/filials', (req, res) => {
  res.json(db.config.getFilials(req.query.system === 'true'));
});
app.post('/api/filials', requireAuth, (req, res) => {
  try { res.json(db.config.createFilial(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/filials/:id', requireAuth, (req, res) => {
  try { res.json(db.config.updateFilial(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/filials/:id/close', requireAuth, (req, res) => {
  try { res.json(db.config.closeFilial(req.params.id, req.body?.changedBy||'admin')); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// ─── СПРАВОЧНИК: ЛОКАЦИИ ─────────────────────────────────────────────────────

app.get('/api/locations', (req, res) => {
  res.json(db.config.getLocations(req.query.filial_id||null, req.query.system==='true'));
});
app.post('/api/locations', requireAuth, (req, res) => {
  try { res.json(db.config.createLocation(req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/locations/:id', requireAuth, (req, res) => {
  try { res.json(db.config.updateLocation(req.params.id, req.body)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/locations/:id/close', requireAuth, (req, res) => {
  try { res.json(db.config.closeLocation(req.params.id)); }
  catch(e) { res.status(400).json({ error: e.message }); }
});

// ─── КОНФИГ: ЭКСПОРТ / ИМПОРТ ────────────────────────────────────────────────

app.get('/api/config/export', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=config.json');
  res.send(JSON.stringify(db.config.exportConfig(), null, 2));
});
app.post('/api/config/import/diff', requireAuth, (req, res) => {
  const incoming = req.body?.config;
  if (!incoming) return res.status(400).json({ error: 'Ожидается { config: {...} }' });
  const missing = ['organizations','filials','locations'].filter(k => !Array.isArray(incoming[k]));
  if (missing.length) return res.status(400).json({ error: 'Отсутствуют поля: ' + missing.join(', ') });
  try { res.json(db.config.diffConfig(incoming)); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/config/import/apply', requireAuth, (req, res) => {
  const { clean, resolutions, incoming, changedBy } = req.body || {};
  if (!clean || !incoming) return res.status(400).json({ error: 'Ожидается { clean, resolutions, incoming }' });
  try { res.json(db.config.applyImport(clean, resolutions||[], incoming, changedBy||'admin')); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── TYPE CODES ───────────────────────────────────────────────────────────────

app.get('/api/type-codes', (req, res) => res.json(db.getTypeCodes()));
app.get('/api/type-mapping', (req, res) => {
  // Возвращает {name_lower: tab} для быстрого поиска в парсере CSV
  const map = {};
  for (const t of db.getTypeCodes()) {
    if (t.name && t.tab) map[t.name.trim().toLowerCase()] = t.tab;
  }
  res.json(map);
});
app.put('/api/type-codes', requireAuth, (req, res) => {
  if (!Array.isArray(req.body?.codes)) return res.status(400).json({ error: 'Array expected' });
  db.setTypeCodes(req.body.codes);
  res.json({ ok: true });
});




// ─── BACKUP ───────────────────────────────────────────────────────────────────
const fs = require('fs');

const DATA_DIR   = process.env.IT_ASSETS_DATA_DIR
  ? path.resolve(process.env.IT_ASSETS_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const AdmZip = (() => { try { return require('adm-zip'); } catch(e) { return null; } })();

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function makeBackup(label = 'auto') {
  ensureBackupDir();
  // Включаем миллисекунды (slice(0, 23) вместо 19) + короткий случайный
  // суффикс — иначе два бэкапа, сделанных в один и тот же момент времени
  // (двойной клик, параллельные вызовы), получают одинаковое имя файла
  // и молча перезаписывают друг друга.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
  const rnd   = uuidv4().slice(0, 6);

  if (AdmZip) {
    // ZIP-архив с обоими файлами
    const name = `backup_${label}_${stamp}_${rnd}.zip`;
    const dest = path.join(BACKUP_DIR, name);
    const zip  = new AdmZip();
    const dbSrc  = path.join(DATA_DIR, 'db.json');
    const cfgSrc = path.join(DATA_DIR, 'config.json');
    if (fs.existsSync(dbSrc))  zip.addLocalFile(dbSrc,  '', 'db.json');
    if (fs.existsSync(cfgSrc)) zip.addLocalFile(cfgSrc, '', 'config.json');
    zip.writeZip(dest);
    pruneBackups();
    return { ok: true, file: name, size: fs.statSync(dest).size, format: 'zip' };
  } else {
    // Fallback — только db.json (если adm-zip не установлен)
    const name = `backup_${label}_${stamp}_${rnd}.json`;
    const dest = path.join(BACKUP_DIR, name);
    const dbSrc = path.join(DATA_DIR, 'db.json');
    if (!fs.existsSync(dbSrc)) return { ok: false, error: 'db.json не найден' };
    fs.copyFileSync(dbSrc, dest);
    // Рядом сохраняем config
    const cfgSrc = path.join(DATA_DIR, 'config.json');
    if (fs.existsSync(cfgSrc)) fs.copyFileSync(cfgSrc, dest.replace('.json', '.config.json'));
    pruneBackups();
    return { ok: true, file: name, size: fs.statSync(dest).size, format: 'json' };
  }
}

// Лимиты хранения по типам бэкапов.
// Каждый тип чистится независимо — startup-бэкапы не вытесняют manual.
const BACKUP_LIMITS = {
  auto:          20, // hourly (раз в час)
  startup:       10, // каждый рестарт сервера
  manual:        20, // созданные вручную оператором
  'pre-restore':  5, // автоматические перед восстановлением
};
const BACKUP_LIMIT_DEFAULT = 10; // для неизвестных меток

function pruneBackups() {
  const allFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => (f.startsWith('backup_') || f.startsWith('db_')) &&
                 (f.endsWith('.json') || f.endsWith('.zip')) &&
                 !f.endsWith('.config.json'));

  // Группируем по метке (второй сегмент: backup_<label>_...)
  const byLabel = {};
  for (const f of allFiles) {
    const m = f.match(/^backup_([^_]+)_/);
    const label = m ? m[1] : 'unknown';
    if (!byLabel[label]) byLabel[label] = [];
    byLabel[label].push({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs });
  }

  for (const [label, files] of Object.entries(byLabel)) {
    const keep = BACKUP_LIMITS[label] ?? BACKUP_LIMIT_DEFAULT;
    files.sort((a, b) => b.mtime - a.mtime);
    files.slice(keep).forEach(f => {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
      const pair = path.join(BACKUP_DIR, f.name.replace('.json', '.config.json'));
      if (fs.existsSync(pair)) fs.unlinkSync(pair);
    });
  }
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => (f.startsWith('backup_') || f.startsWith('db_')) &&
                 (f.endsWith('.json') || f.endsWith('.zip')) &&
                 !f.endsWith('.config.json'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      // Определяем что внутри
      const hasConfig = f.endsWith('.zip') ||
        fs.existsSync(path.join(BACKUP_DIR, f.replace('.json', '.config.json')));
      return { name: f, size: st.size, mtime: st.mtime.toISOString(), full: hasConfig };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

// Фоновые таймеры бэкапа отключены в тестах (NODE_ENV=test, Jest выставляет это
// значение автоматически): иначе они реально пишут zip-файлы на диск и стреляют
// уже после teardown окружения Jest, что ломает вывод тестов.
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    try {
      const result = makeBackup('auto');
      console.log(`[Backup] auto: ${result.file} (${Math.round(result.size/1024)}KB)`);
    } catch(e) { console.error('[Backup] auto failed:', e.message); }
  }, 60 * 60 * 1000);

  setTimeout(() => {
    try {
      const result = makeBackup('startup');
      console.log(`[Backup] startup: ${result.file} (${Math.round(result.size/1024)}KB)`);
    } catch(e) { console.error('[Backup] startup failed:', e.message); }
  }, 10_000);
}

app.get('/api/backup/list', requireAuth, (req, res) => {
  try { res.json(listBackups()); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backup/create', requireAuth, (req, res) => {
  try { res.json(makeBackup('manual')); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backup/download/:name', requireAuth, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Файл не найден' });
  res.download(file, name);
});

app.post('/api/backup/restore/:name', requireAuth, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Файл не найден' });
  try {
    makeBackup('pre-restore'); // сохраняем текущее состояние

    if (name.endsWith('.zip') && AdmZip) {
      const zip = new AdmZip(file);
      zip.extractEntryTo('db.json',     DATA_DIR, false, true);
      zip.extractEntryTo('config.json', DATA_DIR, false, true);
      res.json({ ok: true, restored: name, full: true });
    } else {
      // Fallback — только db.json
      fs.copyFileSync(file, path.join(DATA_DIR, 'db.json'));
      // Пробуем парный config
      const cfgBak = file.replace('.json', '.config.json');
      if (fs.existsSync(cfgBak)) {
        fs.copyFileSync(cfgBak, path.join(DATA_DIR, 'config.json'));
        res.json({ ok: true, restored: name, full: true });
      } else {
        res.json({ ok: true, restored: name, full: false,
          warn: 'config.json не восстановлен — бэкап содержит только db.json' });
      }
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── QR CODE ─────────────────────────────────────────────────────────────────
// Используем npm qrcode если установлен (npm install), иначе самописный fallback

let _qrLib = null;
try {
  _qrLib = require('qrcode');
  console.log('[QR] using npm qrcode');
} catch(e) {
  console.log('[QR] npm qrcode not found, using built-in generator');
}

// Встроенный генератор (fallback) ─────────────────────────────────────────────
const _GF_EXP = new Uint8Array(512);
const _GF_LOG = new Uint8Array(256);
(function(){
  let x = 1;
  for (let i = 0; i < 255; i++) {
    _GF_EXP[i] = x; _GF_LOG[x] = i;
    x <<= 1; if (x & 256) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) _GF_EXP[i] = _GF_EXP[i - 255];
})();
function _gfMul(a,b){ return (!a||!b)?0:_GF_EXP[(_GF_LOG[a]+_GF_LOG[b])%255]; }
function _rsGen(deg){ let r=new Uint8Array(deg+1); r[deg]=1; let root=1; for(let i=0;i<deg;i++){ for(let j=0;j<deg;j++) r[j]=_gfMul(r[j],root)^r[j+1]; r[deg]=_gfMul(r[deg],root); root=_gfMul(root,2); } return r; }
function _rsEncode(data,ecLen){ const gen=_rsGen(ecLen),res=new Uint8Array(data.length+ecLen); data.forEach((b,i)=>res[i]=b); for(let i=0;i<data.length;i++){ const c=res[i]; if(c) for(let j=0;j<gen.length;j++) res[i+j]^=_gfMul(gen[j],c); } return res.slice(data.length); }
function _utf8(str){ const b=[]; for(let i=0;i<str.length;i++){ const c=str.charCodeAt(i); if(c<0x80)b.push(c); else if(c<0x800){b.push(0xC0|(c>>6));b.push(0x80|(c&0x3F));} else{b.push(0xE0|(c>>12));b.push(0x80|((c>>6)&0x3F));b.push(0x80|(c&0x3F));} } return b; }

const _VER=[null,[16,10],[28,16],[44,26],[64,18],[86,24],[108,16],[124,18],[154,22],[182,22],[216,26]];
const _ALIGN=[[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
const _FMT_MASK=0b101010000010010;

function _makeQRSvg(text) {
  const bytes = _utf8(text);
  let ver = 1;
  while (ver <= 10 && _VER[ver][0] < bytes.length + 3) ver++;
  if (ver > 10) throw new Error('Text too long');
  const [dataCap, ecLen] = _VER[ver];
  const size = ver * 4 + 17;
  const bits = [];
  const pb = (v,n) => { for(let i=n-1;i>=0;i--) bits.push((v>>i)&1); };
  pb(4,4); pb(bytes.length,8); bytes.forEach(b=>pb(b,8)); pb(0,4);
  while(bits.length%8) bits.push(0);
  const pads=[0xEC,0x11]; let pi=0;
  while(bits.length<dataCap*8){pb(pads[pi&1],8);pi++;}
  const data=new Uint8Array(dataCap);
  for(let i=0;i<dataCap;i++) for(let j=0;j<8;j++) data[i]|=bits[i*8+j]<<(7-j);
  const ec=_rsEncode(data,ecLen);
  const cw=[...data,...ec];
  const M=Array.from({length:size},()=>new Int8Array(size).fill(-1));
  const F=Array.from({length:size},()=>new Uint8Array(size));
  const sf=(r,c,v)=>{if(r>=0&&r<size&&c>=0&&c<size){M[r][c]=v;F[r][c]=1;}};
  const addFinder=(row,col)=>{for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++){const v=(r>=0&&r<=6&&(r===0||r===6||c===0||c===6))||(r>=2&&r<=4&&c>=2&&c<=4)?1:0;sf(row+r,col+c,v);}};
  addFinder(0,0);addFinder(0,size-7);addFinder(size-7,0);
  for(let i=8;i<size-8;i++){sf(6,i,i%2?0:1);sf(i,6,i%2?0:1);}
  sf(4*ver+9,8,1);
  const ap=_ALIGN[ver];
  for(const ar of ap)for(const ac of ap){if(F[ar][ac])continue;for(let r=-2;r<=2;r++)for(let c=-2;c<=2;c++)sf(ar+r,ac+c,(Math.abs(r)===2||Math.abs(c)===2||(!r&&!c))?1:0);}
  const plFmt=(mi)=>{const d=(0b01<<3)|mi;let rem=d;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>9)*0x537);const fmt=((d<<10)|rem)^_FMT_MASK;const p=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];const p2=[[size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],[8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]];for(let i=0;i<15;i++){const b=(fmt>>(14-i))&1;sf(...p[i],b);sf(...p2[i],b);}};
  const MASKS=[(r,c)=>(r+c)%2===0,(r,c)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,(r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>(r*c)%2+(r*c)%3===0,(r,c)=>((r*c)%2+(r*c)%3)%2===0,(r,c)=>((r+c)%2+(r*c)%3)%2===0];
  const Fc=F.map(r=>new Uint8Array(r));
  let bestM=0,bestP=Infinity,bestMat=null;
  for(let mi=0;mi<8;mi++){
    const tryM=M.map(r=>new Int8Array(r));
    for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(!Fc[r][c])tryM[r][c]=-1;
    let bi=0;
    for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++){for(let dc=0;dc<2;dc++){const c=right-dc,r=((right+1)&2)?vert:size-1-vert;if(Fc[r][c])continue;const bit=bi<cw.length*8?(cw[bi>>3]>>(7-(bi&7)))&1:0;bi++;tryM[r][c]=bit^(MASKS[mi](r,c)?1:0);}}}
    let p=0;
    for(let r=0;r<size;r++){for(let run=0,c=0;c<size;c++){if(c>0&&tryM[r][c]===tryM[r][c-1]){run++;if(run===4)p+=3;else if(run>4)p++;}else run=0;}}
    for(let c=0;c<size;c++){for(let run=0,r=0;r<size;r++){if(r>0&&tryM[r][c]===tryM[r-1][c]){run++;if(run===4)p+=3;else if(run>4)p++;}else run=0;}}
    for(let r=0;r<size-1;r++)for(let c=0;c<size-1;c++)if(tryM[r][c]===tryM[r+1][c]&&tryM[r][c]===tryM[r][c+1]&&tryM[r][c]===tryM[r+1][c+1])p+=3;
    let dark=0;tryM.forEach(row=>row.forEach(v=>{if(v===1)dark++;}));
    p+=Math.abs(Math.round(dark/(size*size)*100/5)*5-50)/5*10;
    if(p<bestP){bestP=p;bestM=mi;bestMat=tryM;}
  }
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)M[r][c]=bestMat[r][c];
  plFmt(bestM);
  const quiet=4,cell=10,svgSz=(size+quiet*2)*cell;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${svgSz}" height="${svgSz}" viewBox="0 0 ${svgSz} ${svgSz}"><rect width="${svgSz}" height="${svgSz}" fill="white"/>`;
  for(let r=0;r<size;r++)for(let c=0;c<size;c++)if(M[r][c]===1)svg+=`<rect x="${(c+quiet)*cell}" y="${(r+quiet)*cell}" width="${cell}" height="${cell}" fill="black"/>`;
  svg+='</svg>';
  return svg;
}
// ─── конец встроенного генератора ────────────────────────────────────────────

app.get('/api/qr', async (req, res) => {
  const text = (req.query.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    if (_qrLib) {
      // npm qrcode — проверен, даёт корректные коды
      const svg = await _qrLib.toString(text, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(svg);
    }
    // Fallback — встроенный генератор
    const svg = _makeQRSvg(text);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  } catch(e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, '../public/index.html')));

// ─── Глобальный обработчик ошибок ─────────────────────────────────────────────
// Без него необработанные исключения (например, синтаксически неверный JSON
// в теле запроса — body-parser бросает SyntaxError) уходят в дефолтный
// обработчик Express, который вне NODE_ENV=production отдаёт клиенту полный
// stack trace с абсолютными путями на диске — раскрытие внутренней структуры
// сервера без какой-либо авторизации. Здесь — то же самое, но без утечки:
// подробности только в серверный лог, клиенту — краткое сообщение.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  const message = status === 400 ? 'Некорректное тело запроса' : 'Внутренняя ошибка сервера';
  res.status(status).json({ error: message });
});

module.exports = app;

if (require.main === module) {
  (async function startServer() {
    const https   = require('https');
    const http    = require('http');
    const { ensureCert, getLocalIPs } = require('./cert');

    const HTTP_PORT  = process.env.PORT       || 3000;
    const HTTPS_PORT = process.env.HTTPS_PORT || 3443;

    function printStartInfo(ips) {
      const fs2    = require('fs');
      const dbPath = require('path').resolve(__dirname, '..', 'data', 'db.json');

      console.log('\n=== IT ASSETS ' + APP_VERSION_DISPLAY + ' ===');
      console.log('DB path: ' + dbPath);

      if (fs2.existsSync(dbPath)) {
        const stat = fs2.statSync(dbPath);
        console.log('DB size: ' + (stat.size/1024).toFixed(1) + ' KB  | modified: ' + stat.mtime.toLocaleString('ru-RU'));
      } else {
        console.log('DB: file will be created on first write');
      }

      try {
        fs2.accessSync(require('path').dirname(dbPath), fs2.constants.W_OK);
      } catch(e) {
        console.error('\n!!! CRITICAL: no write permission for data/ folder');
        console.error('!!! Move it-assets folder to Desktop and restart!\n');
      }

      try {
        db.set('_meta.last_start', new Date().toISOString()).write();
        const raw        = fs2.readFileSync(dbPath, 'utf8');
        const parsed     = JSON.parse(raw);
        const savedCount = (parsed.assets||[]).length;
        const memCount   = db.get('assets').value().length;
        if (savedCount !== memCount) {
          console.error('!!! WARNING: file has ' + savedCount + ' records, memory has ' + memCount);
        } else {
          console.log('DB write: OK (' + savedCount + ' assets, ' + (parsed.history||[]).length + ' history)');
        }
      } catch(e) {
        console.error('!!! db.write() ERROR:', e.message);
      }

      const total = db.get('assets').value().filter(a => a.status !== 'списан').length;
      console.log('Assets: ' + total);
      console.log('');
      console.log('HTTP  (redirect to HTTPS):');
      console.log('  http://localhost:' + HTTP_PORT);
      console.log('');
      console.log('HTTPS (main):');
      console.log('  https://localhost:' + HTTPS_PORT);
      for (const ip of ips.filter(i => i !== '127.0.0.1'))
        console.log('  https://' + ip + ':' + HTTPS_PORT + '  <-- colleagues');
      console.log('');
      console.log('  [WARNING] Self-signed certificate');
      console.log('  Chrome:  click "Advanced" -> "Proceed to localhost"');
      console.log('  Firefox: click "Accept the Risk and Continue"');
      console.log('  Edge:    click "Advanced" -> "Continue to localhost"');
      console.log('');
    }

    // HTTP -> HTTPS redirect
    const httpApp = require('express')();
    httpApp.use((req, res) => {
      const host = req.hostname || 'localhost';
      res.redirect(301, 'https://' + host + ':' + HTTPS_PORT + req.originalUrl);
    });
    http.createServer(httpApp).listen(HTTP_PORT, '0.0.0.0', () => {
      console.log('[HTTP]  :' + HTTP_PORT + ' -> redirect to HTTPS :' + HTTPS_PORT);
    });

    // HTTPS server
    let tlsOptions;
    try {
      tlsOptions = await ensureCert();
    } catch(e) {
      console.error('[TLS] Failed to get certificate:', e.message);
      console.error('[TLS] Starting HTTP only on port ' + HTTP_PORT);
      app.listen(HTTP_PORT, '0.0.0.0', () => {
        const ips = getLocalIPs();
        console.log('\n=== IT ASSETS ' + APP_VERSION_DISPLAY + ' (HTTP only - no TLS) ===');
        console.log('  http://localhost:' + HTTP_PORT);
        for (const ip of ips.filter(i => i !== '127.0.0.1'))
          console.log('  http://' + ip + ':' + HTTP_PORT);
      });
      return;
    }

    const ips = getLocalIPs();
    https.createServer(tlsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
      printStartInfo(ips);
    });
  })();
}
