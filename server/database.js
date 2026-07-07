/**
 * database.js v2
 *
 * Два файла данных:
 *   data/config.json  — справочники (orgs, filials, locations, accounts, settings)
 *   data/db.json      — рабочие данные (assets, history)
 */
'use strict';

const low      = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const fs       = require('fs');
const { hashPin, verifyPin } = require('./pin');

// ─── Пути ────────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.IT_ASSETS_DATA_DIR
  ? path.resolve(process.env.IT_ASSETS_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'db.json');
const CFG_PATH = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Словарь типов устройств (фоллбэк — если config.json ещё пуст) ───────────

// [code]: [name, tab]  tab: os | small | infra
const TYPE_CODES_MAP = {
  'NB' :['Ноутбук',          'os'   ],
  'PC' :['Системный блок',   'os'   ],
  'MON':['Монитор',          'os'   ],
  'MFU':['МФУ',              'os'   ],
  'PR' :['Принтер',          'os'   ],
  'TAB':['Планшет',          'small'],
  'TV' :['Телевизор',        'os'   ],
  'UPS':['ИБП',              'infra'],
  'MPC':['Мини ПК',          'os'   ],
  'SRV':['Сервер',           'infra'],
  'SW' :['Коммутатор',       'infra'],
  'RT' :['Маршрутизатор',    'infra'],
  'AP' :['Точка доступа',    'infra'],
  'CAM':['Камера',           'infra'],
  'DVR':['Видеорегистратор', 'infra'],
  'TSD':['ТСД',              'small'],
  'SPK':['Спикерфон',        'small'],
  'SPB':['Колонки',          'small'],
  'RBR':['Радиомост',        'infra'],
  'CPB':['Вызывная панель',  'infra'],
  'VDI':['Видеодомофон',     'infra'],
  'SCN':['Сканер',           'small'],
  'MOU':['Мышь',             'small'],
  'KB' :['Клавиатура',       'small'],
  'HS' :['Гарнитура',        'small'],
  'CAB':['Кабель/Патч-корд', 'small'],
  'POE':['PoE инжектор',     'infra'],
  'HUB':['USB-hub',          'small'],
  'SSD':['SSD/HDD',          'small'],
  'PHN':['Смартфон',         'small'],
  'WEB':['Web камера',       'small'],
  'SPF':['Сетевой фильтр',   'small'],
  'BRC':['Кронштейн',        'small'],
};

// ─── Два экземпляра lowdb ────────────────────────────────────────────────────

const db  = low(new FileSync(DB_PATH));
const cfg = low(new FileSync(CFG_PATH));

// ─── Системные UNK-заглушки (создаются если отсутствуют) ─────────────────────

const NOW = new Date().toISOString();

const SYS_ORG = {
  id:'sys-org-unk', name:'—', short_code:'UNK', status:'active',
  system:true, inv_rules:[], created_at:NOW, renamed_from:null, renamed_at:null,
};
const SYS_FILIAL = {
  id:'sys-filial-unk', name:'—', address:'', org_id:null,
  status:'active', system:true, created_at:NOW, closed_at:null,
};
const SYS_LOCATION = {
  id:'sys-location-unk', name:'—', type:'other',
  filial_id:'sys-filial-unk', status:'active', system:true,
  created_at:NOW, closed_at:null,
};

// ─── Defaults config.json ────────────────────────────────────────────────────

cfg.defaults({
  _meta:   { version:2, created_at:NOW },
  settings:{ company_name:'IT ASSETS' },
  accounts:[],
  organizations:[SYS_ORG],
  filials:  [SYS_FILIAL],
  locations:[SYS_LOCATION],
  employees:[], // ← справочник сотрудников
  users:[{id:'sys-user-admin',name:'admin',login:'admin',role:'admin',pin:'admn0000',active:true,created_at:'2026-01-01T00:00:00.000Z',email:''}],
  categories:{
    os:   ['Оборудование пользователей','Оргтехника','Мини ПК'],
    small:['Периферия','Гарнитуры','Колонки'],
    infra:['Сетевое оборудование','Wi-Fi','Принтеры','Видеонаблюдение','ИБП','Серверы'],
  },
  type_codes: Object.entries(TYPE_CODES_MAP).map(([code,[name,tab]])=>({code,name,tab:tab||'os'})),
}).write();

// Гарантируем наличие системных заглушек
function ensureSys(collection, sysRecord) {
  if (!cfg.get(collection).find({id: sysRecord.id}).value()) {
    cfg.get(collection).unshift(sysRecord).write();
    console.log(`DB: added system ${sysRecord.id} to ${collection}`);
  }
}
ensureSys('organizations', SYS_ORG);
ensureSys('filials',       SYS_FILIAL);
ensureSys('locations',     SYS_LOCATION);

// ─── Defaults db.json ────────────────────────────────────────────────────────

db.defaults({
  _meta:   { version:2, created_at:NOW },
  assets:  [],
  history: [],
}).write();

// Гарантируем наличие системного пользователя admin
(function ensureAdminUser() {
  const users = cfg.get('users').value() || [];
  if (!users.find(u => u.id === 'sys-user-admin')) {
    cfg.set('users', [{id:'sys-user-admin',name:'admin',login:'admin',role:'admin',pin:'admn0000',active:true,created_at:NOW,email:''}, ...users]).write();
    console.log('DB: создан системный пользователь admin');
  }
})();

// ─── Запуск миграций схемы ───────────────────────────────────────────────────
require('./migrate')(db, cfg);

// ─── Методы: Сотрудники ───────────────────────────────────────────────────────
db.getEmployees = function(activeOnly = true) {
  const all = cfg.get('employees').value() || [];
  return activeOnly ? all.filter(e => e.active !== false) : all;
};

db.getEmployee = function(id) {
  return (cfg.get('employees').value() || []).find(e => e.id === id) || null;
};

db.createEmployee = function({ name, dept = '', filial = '', phone = '', email = '', note = '' }) {
  if (!name || !name.trim()) throw new Error('ФИО обязательно');
  const emp = {
    id: uuidv4(), name: name.trim(), dept: dept.trim(),
    filial: filial.trim(), phone: phone.trim(),
    email: email.trim().toLowerCase(), note: note.trim(),
    active: true, created_at: new Date().toISOString(),
  };
  const all = cfg.get('employees').value() || [];
  cfg.set('employees', [...all, emp]).write();
  return emp;
};

db.updateEmployee = function(id, fields) {
  const all = cfg.get('employees').value() || [];
  const idx = all.findIndex(e => e.id === id);
  if (idx === -1) throw new Error('Сотрудник не найден');
  const allowed = ['name','dept','filial','phone','email','note','active'];
  allowed.forEach(k => { if (fields[k] !== undefined) all[idx][k] = fields[k]; });
  cfg.set('employees', all).write();
  return all[idx];
};

db.deleteEmployee = function(id) {
  // Вместо удаления — деактивируем сотрудника
  const emp = db.getEmployee(id);
  if (!emp) throw new Error('Сотрудник не найден');
  
  const all = cfg.get('employees').value() || [];
  const idx = all.findIndex(e => e.id === id);
  if (idx === -1) throw new Error('Сотрудник не найден');
  
  // Деактивируем вместо удаления
  all[idx].active = false;
  all[idx].deactivated_at = new Date().toISOString();
  
  cfg.set('employees', all).write();
  
  // Возвращаем информацию об оборудовании, которое нужно переместить
  const linked = db.get('assets').value()
    .filter(a => a.status !== 'списан' && a.responsible === emp.name);
  
  return { 
    ok: true, 
    deactivated: true,
    employee: emp,
    linked_assets: linked.length,
    assets: linked
  };
};

db.searchEmployees = function(q) {
  if (!q || q.trim().length < 2) return [];
  const key = q.trim().toLowerCase();
  return (cfg.get('employees').value() || [])
    .filter(e => e.active !== false)
    .filter(e =>
      e.name.toLowerCase().includes(key) ||
      e.dept.toLowerCase().includes(key) ||
      e.phone.includes(key)
    )
    .slice(0, 15);
};

function getOrgCodes() {
  const orgs = cfg.get('organizations').value().filter(o => !o.system);
  return Object.fromEntries(orgs.map(o => [o.short_code, o.name]));
}
function getTypeCodes() {
  const types = cfg.get('type_codes').value() || [];
  if (types.length) return Object.fromEntries(types.map(t => [t.code, t.name]));
  return TYPE_CODES_MAP;
}

Object.defineProperty(db, 'ORG_CODES',  { get: getOrgCodes,  enumerable: true });
Object.defineProperty(db, 'TYPE_CODES', { get: getTypeCodes, enumerable: true });

// ─── Прямые методы для settings и categories (v2 API) ────────────────────────

db.getSettings = function() {
  return cfg.get('settings').value();
};
db.getSetting = function(key) {
  return cfg.get(`settings.${key}`).value();
};
db.setSetting = function(key, value) {
  return cfg.set(`settings.${key}`, value).write();
};
db.getCategories = function() {
  return cfg.get('categories').value();
};
db.setCategories = function(tab, value) {
  return cfg.set(`categories.${tab}`, value).write();
};
db.getTypeCodes = function() {
  const codes = cfg.get('type_codes').value() || [];
  // Гарантируем поле tab (для старых записей без него)
  return codes.map(c => ({ tab: 'os', ...c }));
};
db.setTypeCodes = function(codes) {
  return cfg.set('type_codes', codes).write();
};

// ─── db.config — методы для справочников ──────────────────────────────────────

db.config = {

  // ── Организации ──────────────────────────────────────────────────────────────

  getOrgs(includeSystem = false) {
    const orgs = cfg.get('organizations').value();
    return includeSystem ? orgs : orgs.filter(o => !o.system);
  },

  getOrg(id) {
    return cfg.get('organizations').find({ id }).value() || null;
  },

  createOrg({ name, short_code, inv_rules = [] }) {
    if (!name || !short_code) throw new Error('name и short_code обязательны');
    const code = short_code.toUpperCase();
    const existing = cfg.get('organizations').value();
    const dup = existing.find(o => o.short_code === code || o.name === name);
    if (dup) throw new Error(`Дублирует: ${dup.name} (${dup.short_code})`);
    const org = {
      id: uuidv4(), name, short_code: code, status:'active', system:false,
      inv_rules, created_at: new Date().toISOString(),
      renamed_from:null, renamed_at:null,
    };
    cfg.get('organizations').push(org).write();
    return org;
  },

  updateOrg(id, fields) {
    const org = cfg.get('organizations').find({ id }).value();
    if (!org)       throw new Error('Организация не найдена');
    if (org.system) throw new Error('Нельзя изменить системную запись');
    const allowed = ['name','short_code','status'];
    const update = {};
    allowed.forEach(k => { if (fields[k] !== undefined) update[k] = fields[k]; });
    cfg.get('organizations').find({ id }).assign(update).write();
    return cfg.get('organizations').find({ id }).value();
  },

  renameOrg(id, newName, changedBy = 'system') {
    const org = cfg.get('organizations').find({ id }).value();
    if (!org)       throw new Error('Организация не найдена');
    if (org.system) throw new Error('Нельзя переименовать системную запись');
    const oldName = org.name;
    const now = new Date().toISOString();
    cfg.get('organizations').find({ id }).assign({
      name: newName, renamed_from: oldName, renamed_at: now,
    }).write();
    db.get('history').push({
      id: uuidv4(), asset_id: null,
      action_type: 'org_renamed', date: now,
      from_who: oldName, to_who: newName,
      filial: '', location: '',
      equipment: `Организация: ${oldName}`,
      model: '', type: '', serial: '',
      reason: `Переименование: «${oldName}» → «${newName}»`,
      changed_by: changedBy,
    }).write();
    return cfg.get('organizations').find({ id }).value();
  },

  liquidateOrg(id, targetOrgId, changedBy = 'system', renumberInv = false) {
    const org = cfg.get('organizations').find({ id }).value();
    if (!org)               throw new Error('Организация не найдена');
    if (org.system)         throw new Error('Нельзя ликвидировать системную запись');
    if (id === targetOrgId) throw new Error('Целевая организация совпадает с ликвидируемой');
    const target = cfg.get('organizations').find({ id: targetOrgId }).value();
    if (!target) throw new Error('Целевая организация не найдена');

    const now = new Date().toISOString();
    const affected = db.get('assets').value()
      .filter(a => a.status !== 'списан' && a.org_id === id);

    let renumbered = 0;
    const oldCode = org.short_code;
    const newCode = target.short_code;

    affected.forEach(a => {
      const updates = { org_id: targetOrgId, updated_at: now };
      if (renumberInv && a.inv && a.inv.startsWith(oldCode + '-')) {
        const oldInv = a.inv;
        updates.inv = newCode + a.inv.slice(oldCode.length);
        updates.inv_prev = oldInv;
        renumbered++;
      }
      db.get('assets').find({ id: a.id }).assign(updates).write();
      db.get('history').push({
        id: uuidv4(), asset_id: a.id,
        action_type: 'org_transfer', date: now,
        from_who: org.name, to_who: target.name,
        filial: a.filial||'', location: a.location||'',
        equipment: `${a.type} ${a.model}`,
        model: a.model, type: a.type, serial: a.serial,
        reason: `Ликвидация «${org.name}» → «${target.name}»` +
          (renumberInv && a.inv ? ` | инв: ${a.inv_prev||a.inv} → ${updates.inv||a.inv}` : ''),
        changed_by: changedBy,
      }).write();
    });

    if (renumberInv) {
      const allAssets = db.get('assets').value();
      (target.inv_rules || []).forEach(rule => {
        const prefix = `${newCode}-${rule.type_code}-`;
        const maxNum = allAssets
          .map(a => a.inv||'')
          .filter(inv => inv.startsWith(prefix))
          .map(inv => parseInt(inv.slice(prefix.length), 10))
          .filter(n => !isNaN(n))
          .reduce((m, n) => Math.max(m, n), rule.counter || 0);
        cfg.get('organizations').find({ id: targetOrgId })
          .get('inv_rules').find({ type_code: rule.type_code })
          .assign({ counter: maxNum }).write();
      });
    }

    cfg.get('organizations').find({ id }).assign({
      status: 'liquidated', liquidated_at: now,
    }).write();
    return { transferred: affected.length, renumbered };
  },

  // ── Правила инвентарных номеров ───────────────────────────────────────────────

  nextInv(orgId, typeCode, { reserve = true } = {}) {
    const org = cfg.get('organizations').find({ id: orgId }).value();
    if (!org) throw new Error('Организация не найдена');
    const rule = (org.inv_rules||[]).find(r =>
      r.type_code === typeCode.toUpperCase() && r.active !== false
    );
    if (!rule) throw new Error(`Тип ${typeCode} не настроен для ${org.name}`);
    const prefix = `${org.short_code}-${rule.type_code}-`;
    const maxExisting = db.get('assets').value()
      .map(a => a.inv||'')
      .filter(inv => inv.startsWith(prefix))
      .map(inv => parseInt(inv.replace(prefix,''), 10))
      .filter(n => !isNaN(n))
      .reduce((m, n) => Math.max(m, n), rule.counter || 0);
    const next = maxExisting + 1;
    const inv  = `${prefix}${String(next).padStart(5, '0')}`;
    // Инкрементируем счётчик только при резервировании
    if (reserve) {
      cfg.get('organizations').find({ id: orgId })
        .get('inv_rules').find({ type_code: rule.type_code })
        .assign({ counter: next }).write();
    }
    return { inv, next, prefix };
  },

  addInvRule(orgId, { type_code, type_name, format = '{org}-{type}-{N:05}' }) {
    const org = cfg.get('organizations').find({ id: orgId }).value();
    if (!org)       throw new Error('Организация не найдена');
    if (org.system) throw new Error('Нельзя добавить правило системной записи');
    const code = type_code.toUpperCase();
    if ((org.inv_rules||[]).find(r => r.type_code === code))
      throw new Error(`Правило ${code} уже существует`);
    const rule = { type_code: code, type_name, counter:0, format, active:true };
    cfg.get('organizations').find({ id: orgId }).get('inv_rules').push(rule).write();
    return rule;
  },

  toggleInvRule(orgId, typeCode, active) {
    cfg.get('organizations').find({ id: orgId })
      .get('inv_rules').find({ type_code: typeCode.toUpperCase() })
      .assign({ active }).write();
    return { ok: true };
  },

  renameInvRule(orgId, typeCode, { type_name }) {
    const org = cfg.get('organizations').find({ id: orgId }).value();
    if (!org) throw new Error('Организация не найдена');
    const code = typeCode.toUpperCase();
    const rule = (org.inv_rules||[]).find(r => r.type_code === code);
    if (!rule) throw new Error(`Правило ${code} не найдено`);
    if (!type_name || !type_name.trim()) throw new Error('type_name обязателен');
    cfg.get('organizations').find({ id: orgId })
      .get('inv_rules').find({ type_code: code })
      .assign({ type_name: type_name.trim() }).write();
    return { ok: true };
  },

  deleteInvRule(orgId, typeCode) {
    const org = cfg.get('organizations').find({ id: orgId }).value();
    if (!org) throw new Error('Организация не найдена');
    const code = typeCode.toUpperCase();
    const rule = (org.inv_rules||[]).find(r => r.type_code === code);
    if (!rule) throw new Error(`Правило ${code} не найдено`);
    const prefix = `${org.short_code}-${code}-`;
    const affected = db.get('assets').value()
      .filter(a => (a.inv||'').startsWith(prefix));
    if (affected.length > 0) {
      return { conflict: true, count: affected.length, prefix, typeCode: code };
    }
    const updated = (org.inv_rules||[]).filter(r => r.type_code !== code);
    cfg.get('organizations').find({ id: orgId }).assign({ inv_rules: updated }).write();
    return { ok: true };
  },

  deleteInvRuleForce(orgId, typeCode, action, targetTypeCode) {
    const org = cfg.get('organizations').find({ id: orgId }).value();
    if (!org) throw new Error('Организация не найдена');
    const code = typeCode.toUpperCase();
    const rule = (org.inv_rules||[]).find(r => r.type_code === code);
    if (!rule) throw new Error(`Правило ${code} не найдено`);
    const prefix = `${org.short_code}-${code}-`;
    const now = new Date().toISOString();

    if (action === 'reset') {
      db.get('assets').value()
        .filter(a => (a.inv||'').startsWith(prefix))
        .forEach(a => {
          db.get('assets').find({ id: a.id }).assign({ inv: '', updated_at: now }).write();
        });
    } else if (action === 'transfer') {
      if (!targetTypeCode) throw new Error('targetTypeCode обязателен для transfer');
      const targetCode = targetTypeCode.toUpperCase();
      const targetRule = (org.inv_rules||[]).find(r => r.type_code === targetCode && r.active !== false);
      if (!targetRule) throw new Error(`Целевое правило ${targetCode} не найдено или неактивно`);
      const targetPrefix = `${org.short_code}-${targetCode}-`;
      let counter = db.get('assets').value()
        .map(a => a.inv||'')
        .filter(inv => inv.startsWith(targetPrefix))
        .map(inv => parseInt(inv.slice(targetPrefix.length), 10))
        .filter(n => !isNaN(n))
        .reduce((m, n) => Math.max(m, n), targetRule.counter || 0);
      db.get('assets').value()
        .filter(a => (a.inv||'').startsWith(prefix))
        .forEach(a => {
          counter++;
          const newInv = `${targetPrefix}${String(counter).padStart(5, '0')}`;
          db.get('assets').find({ id: a.id }).assign({ inv: newInv, updated_at: now }).write();
        });
      cfg.get('organizations').find({ id: orgId })
        .get('inv_rules').find({ type_code: targetCode })
        .assign({ counter }).write();
    } else {
      throw new Error(`Неизвестный action: ${action}`);
    }

    const updated = (org.inv_rules||[]).filter(r => r.type_code !== code);
    cfg.get('organizations').find({ id: orgId }).assign({ inv_rules: updated }).write();
    return { ok: true };
  },

  // ── Учётные записи ───────────────────────────────────────────────────────────

  getAccounts() {
    return cfg.get('accounts').value() || [];
  },

  addAccount({ name, login='', password='', note='', category='' }) {
    if (!name) throw new Error('Name required');
    const acc = { id: uuidv4(), name, login, password, note, category,
      created_at: new Date().toISOString() };
    const existing = cfg.get('accounts').value() || [];
    cfg.set('accounts', [...existing, acc]).write();
    return { id: acc.id, ok: true };
  },

  updateAccount(id, { name, login, password, note, category }) {
    const acc = (cfg.get('accounts').value()||[]).find(a => a.id === id);
    if (!acc) throw new Error('Not found');
    const updated = { ...acc,
      name:     name     ?? acc.name,
      login:    login    ?? acc.login,
      password: password ?? acc.password,
      note:     note     ?? acc.note,
      category: category ?? acc.category ?? '',
    };
    cfg.set('accounts', cfg.get('accounts').value().map(a => a.id === id ? updated : a)).write();
    return { ok: true };
  },

  deleteAccount(id) {
    const existing = cfg.get('accounts').value() || [];
    if (!existing.find(a => a.id === id)) throw new Error('Not found');
    cfg.set('accounts', existing.filter(a => a.id !== id)).write();
    return { ok: true };
  },

  // ── Филиалы ──────────────────────────────────────────────────────────────────

  getFilials(includeSystem = false) {
    const list = cfg.get('filials').value();
    return includeSystem ? list : list.filter(f => !f.system);
  },

  getFilial(id) {
    return cfg.get('filials').find({ id }).value() || null;
  },

  createFilial({ name, address = '', org_id = null }) {
    if (!name) throw new Error('name обязателен');
    const filial = {
      id: uuidv4(), name, address, org_id,
      status:'active', system:false,
      created_at: new Date().toISOString(), closed_at:null,
    };
    cfg.get('filials').push(filial).write();
    return filial;
  },

  updateFilial(id, fields) {
    const f = cfg.get('filials').find({ id }).value();
    if (!f)       throw new Error('Филиал не найден');
    if (f.system) throw new Error('Нельзя изменить системную запись');
    const allowed = ['name','address','org_id'];
    const update = {};
    allowed.forEach(k => { if (fields[k] !== undefined) update[k] = fields[k]; });
    cfg.get('filials').find({ id }).assign(update).write();
    return cfg.get('filials').find({ id }).value();
  },

  closeFilial(id, changedBy = 'system') {
    const f = cfg.get('filials').find({ id }).value();
    if (!f)       throw new Error('Филиал не найден');
    if (f.system) throw new Error('Нельзя закрыть системную запись');
    const affected = db.get('assets').value()
      .filter(a => a.status !== 'списан' && a.filial_id === id).length;
    cfg.get('filials').find({ id }).assign({
      status:'closed', closed_at: new Date().toISOString(),
    }).write();
    return { closed:true, affected_assets: affected };
  },

  // ── Локации ──────────────────────────────────────────────────────────────────

  getLocations(filialId = null, includeSystem = false) {
    let list = cfg.get('locations').value();
    if (!includeSystem) list = list.filter(l => !l.system);
    if (filialId)       list = list.filter(l => l.filial_id === filialId);
    return list;
  },

  getLocation(id) {
    return cfg.get('locations').find({ id }).value() || null;
  },

  createLocation({ name, filial_id, type = 'office' }) {
    if (!name || !filial_id) throw new Error('name и filial_id обязательны');
    const loc = {
      id: uuidv4(), name, filial_id, type,
      status:'active', system:false,
      created_at: new Date().toISOString(), closed_at:null,
    };
    cfg.get('locations').push(loc).write();
    return loc;
  },

  updateLocation(id, fields) {
    const l = cfg.get('locations').find({ id }).value();
    if (!l)       throw new Error('Локация не найдена');
    if (l.system) throw new Error('Нельзя изменить системную запись');
    const allowed = ['name','type','filial_id'];
    const update = {};
    allowed.forEach(k => { if (fields[k] !== undefined) update[k] = fields[k]; });
    cfg.get('locations').find({ id }).assign(update).write();
    return cfg.get('locations').find({ id }).value();
  },

  closeLocation(id) {
    const l = cfg.get('locations').find({ id }).value();
    if (!l)       throw new Error('Локация не найдена');
    if (l.system) throw new Error('Нельзя закрыть системную запись');
    cfg.get('locations').find({ id }).assign({
      status:'closed', closed_at: new Date().toISOString(),
    }).write();
    return { closed: true };
  },

  // ── Экспорт / импорт конфига ─────────────────────────────────────────────────

  exportConfig() {
    const data = cfg.value();
    return {
      _meta:         data._meta,
      settings:      { company_name: data.settings?.company_name },
      organizations: data.organizations || [],
      filials:       data.filials       || [],
      locations:     data.locations     || [],
      categories:    data.categories    || {},
      type_codes:    data.type_codes    || [],
      // пользователи без паролей, аккаунты не экспортируем
      users: (data.users || []).map(({ pin, ...u }) => u),
    };
  },

  diffConfig(incoming) {
    const conflicts = [];
    const clean = { organizations:[], filials:[], locations:[] };

    for (const level of ['organizations','filials','locations']) {
      const current       = cfg.get(level).value();
      const byId          = Object.fromEntries(current.map(r => [r.id, r]));
      const byCode        = level === 'organizations'
        ? Object.fromEntries(current.filter(o=>o.short_code).map(o=>[o.short_code,o]))
        : {};
      const byName        = Object.fromEntries(
        current.map(r => [(r.name||'').toLowerCase(), r])
      );

      for (const rec of (incoming[level] || [])) {
        if (rec.system) continue;

        const matchId   = byId[rec.id];
        const matchCode = level === 'organizations' ? byCode[rec.short_code] : null;
        const matchName = byName[(rec.name||'').toLowerCase()];

        if (matchId && matchId.name === rec.name &&
            (!matchCode || matchCode.id === rec.id)) {
          clean[level].push(rec);
          continue;
        }

        const conflictType = matchId   ? 'same_id_diff_data'
                           : matchCode ? 'same_code'
                           : matchName ? 'same_name'
                           : null;
        if (!conflictType) { clean[level].push(rec); continue; }

        conflicts.push({
          level,
          incoming: rec,
          current: matchId || matchCode || matchName,
          type: conflictType,
          options: conflictType === 'same_id_diff_data'
            ? ['keep_current','replace']
            : ['skip','rename','replace'],
        });
      }
    }
    return { clean, conflicts };
  },

  applyImport(clean, resolutions, incoming, changedBy = 'system') {
    const now = new Date().toISOString();
    const summary = { added:[], updated:[], skipped:[] };

    for (const level of ['organizations','filials','locations']) {
      for (const r of (clean[level] || [])) {
        const exists = cfg.get(level).find({ id: r.id }).value();
        if (exists) {
          cfg.get(level).find({ id: r.id }).assign(r).write();
          summary.updated.push(`${level}:${r.id}`);
        } else {
          cfg.get(level).push(r).write();
          summary.added.push(`${level}:${r.id}`);
        }
      }
    }

    for (const res of (resolutions || [])) {
      const { level, incoming_id, action, new_name } = res;
      const rec = (incoming[level]||[]).find(r => r.id === incoming_id);
      if (!rec) continue;

      if (action === 'skip' || action === 'keep_current') {
        summary.skipped.push(`${level}:${incoming_id}`);
        continue;
      }
      if (action === 'replace') {
        cfg.get(level).find({ id: rec.id }).assign(rec).write();
        summary.updated.push(`${level}:${incoming_id}`);
      }
      if (action === 'rename' && new_name) {
        cfg.get(level).push({ ...rec, name: new_name, id: uuidv4() }).write();
        summary.added.push(`${level}:${incoming_id}(renamed→${new_name})`);
      }
    }

    // Применяем categories и type_codes если переданы
    if (incoming.categories && typeof incoming.categories === 'object') {
      cfg.set('categories', incoming.categories).write();
      summary.updated.push('categories');
    }
    if (Array.isArray(incoming.type_codes) && incoming.type_codes.length) {
      cfg.set('type_codes', incoming.type_codes).write();
      summary.updated.push('type_codes');
    }
    // settings.company_name если передан
    if (incoming.settings?.company_name) {
      const cur = cfg.get('settings').value() || {};
      cfg.set('settings', { ...cur, company_name: incoming.settings.company_name }).write();
      summary.updated.push('settings');
    }

    db.get('history').push({
      id: uuidv4(), asset_id: null,
      action_type: 'config_imported', date: now,
      from_who:'', to_who:'', filial:'', location:'',
      equipment:'config.json', model:'', type:'', serial:'',
      reason:`Импорт конфигурации`,
      changed_by: changedBy,
      import_summary: summary,
    }).write();

    return summary;
  },
};

// ─── Экспорт ─────────────────────────────────────────────────────────────────


// ─── ПОЛЬЗОВАТЕЛИ СИСТЕМЫ ────────────────────────────────────────────────────

db.getUsers = function(activeOnly = true) {
  const users = cfg.get('users').value() || [];
  return activeOnly ? users.filter(u => u.active !== false) : users;
};

db.getUser = function(id) {
  return (cfg.get('users').value() || []).find(u => u.id === id) || null;
};

db.authUser = function(userId, pin) {
  const user = db.getUser(userId);
  if (!user || !user.active) return null;
  if (verifyPin(pin, user.pin)) return user;
  return null;
};

db.authByLogin = function(login, password) {
  const users = cfg.get('users').value() || [];
  const user = users.find(u => u.active && u.login && u.login.toLowerCase() === String(login || '').trim().toLowerCase());
  if (!user) return null;
  if (!verifyPin(password, user.pin)) return null;
  return user;
};

db.createUser = function({ name, login = '', role = 'operator', pin = '', email = '' }) {
  if (!name) throw new Error('name обязателен');
  const { v4: uuid } = require('uuid');
  const users = cfg.get('users').value() || [];
  if (login && users.find(u => u.login && u.login.toLowerCase() === login.trim().toLowerCase()))
    throw new Error('Логин уже занят');
  const user = {
    id: uuid(), name, login: String(login || '').trim(), role, pin: hashPin(pin),
    email: String(email || '').trim().toLowerCase(),
    active: true, created_at: new Date().toISOString()
  };
  cfg.set('users', [...users, user]).write();
  return user;
};

db.updateUser = function(id, fields) {
  const users = cfg.get('users').value() || [];
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('Пользователь не найден');
  if (fields.pin !== undefined) fields = { ...fields, pin: hashPin(fields.pin) };
  if (users[idx].id === 'sys-user-admin') {
    if (fields.role && fields.role !== 'admin')
      throw new Error('Нельзя изменить роль системного администратора');
    if (fields.active === false)
      throw new Error('Нельзя деактивировать системного администратора');
    // Разрешаем менять: name, login, pin, email
    const sysAllowed = ['name', 'login', 'pin', 'email'];
    sysAllowed.forEach(k => { if (fields[k] !== undefined) users[idx][k] = fields[k]; });
  } else {
    const allowed = ['name', 'login', 'role', 'pin', 'email', 'active'];
    allowed.forEach(k => { if (fields[k] !== undefined) users[idx][k] = fields[k]; });
  }
  cfg.set('users', users).write();
  return users[idx];
};

db.deleteUser = function(id) {
  if (id === 'sys-user-admin') throw new Error('Нельзя удалить системного администратора');
  const users = cfg.get('users').value() || [];
  cfg.set('users', users.filter(u => u.id !== id)).write();
  return { ok: true };
};

module.exports = db;
Object.defineProperty(module.exports, 'cfg', { get(){ return cfg; }, enumerable:true });
