'use strict';
/**
 * makeDb() — создаёт изолированный экземпляр database.js с in-memory хранилищем.
 * Не читает и не пишет реальные data/db.json и data/config.json.
 * Каждый вызов возвращает чистую БД с системными заглушками.
 */

const low      = require('lowdb');
const Memory   = require('lowdb/adapters/Memory');
const { v4: uuidv4 } = require('uuid');
const { hashPin, verifyPin } = require('../../server/pin');

const TYPE_CODES_MAP = {
  'NB':'Ноутбук', 'PC':'Системный блок', 'MON':'Монитор',
  'MFU':'МФУ',    'PR':'Принтер',        'TAB':'Планшет',
  'TV':'Телевизор','UPS':'ИБП',           'MPC':'Мини ПК',
  'SRV':'Сервер', 'SW':'Коммутатор',     'RT':'Маршрутизатор',
  'AP':'Точка доступа','CAM':'Камера',   'TSD':'ТСД',
};

function makeDb() {
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

  const db  = low(new Memory());
  const cfg = low(new Memory());

  cfg.defaults({
    _meta: { version:2, created_at:NOW },
    settings: { company_name:'Test Company' },
    accounts: [],
    organizations: [SYS_ORG],
    filials:  [SYS_FILIAL],
    locations:[SYS_LOCATION],
    employees: [],
    users: [{
      id:'test-user-admin', name:'Test Admin', login:'admin',
      role:'admin', pin:'test123', active:true,
      created_at:NOW, email:'',
    }],
    categories: {
      os:   ['Оборудование пользователей','Оргтехника'],
      small:['Периферия'],
      infra:['Сетевое оборудование'],
    },
    type_codes: Object.entries(TYPE_CODES_MAP).map(([code,name])=>({code,name})),
  }).write();

  db.defaults({
    _meta:   { version:2, created_at:NOW },
    assets:  [],
    history: [],
  }).write();

  // ── Геттеры ──────────────────────────────────────────────────────────────────

  function getOrgCodes() {
    return Object.fromEntries(
      cfg.get('organizations').value().filter(o=>!o.system).map(o=>[o.short_code,o.name])
    );
  }
  function getTypeCodes() {
    const types = cfg.get('type_codes').value()||[];
    if (types.length) return Object.fromEntries(types.map(t=>[t.code,t.name]));
    return TYPE_CODES_MAP;
  }

  Object.defineProperty(db,'ORG_CODES',  {get:getOrgCodes,  enumerable:true});
  Object.defineProperty(db,'TYPE_CODES', {get:getTypeCodes, enumerable:true});

  db.getSettings   = ()      => cfg.get('settings').value();
  db.getSetting    = (key)   => cfg.get(`settings.${key}`).value();
  db.setSetting    = (k,v)   => cfg.set(`settings.${k}`,v).write();
  db.getCategories = ()      => cfg.get('categories').value();
  db.setCategories = (t,v)   => cfg.set(`categories.${t}`,v).write();
  db.getTypeCodes  = ()      => cfg.get('type_codes').value();
  db.setTypeCodes  = (codes) => cfg.set('type_codes',codes).write();

  // ── db.config ─────────────────────────────────────────────────────────────────
  // Копия логики из database.js, но работает с локальными db/cfg

  db.config = {
    getOrgs(includeSystem=false) {
      const orgs = cfg.get('organizations').value();
      return includeSystem ? orgs : orgs.filter(o=>!o.system);
    },
    getOrg(id) {
      return cfg.get('organizations').find({id}).value()||null;
    },
    createOrg({name, short_code, inv_rules=[]}) {
      if (!name||!short_code) throw new Error('name и short_code обязательны');
      const code = short_code.toUpperCase();
      const existing = cfg.get('organizations').value();
      const dup = existing.find(o=>o.short_code===code||o.name===name);
      if (dup) throw new Error(`Дублирует: ${dup.name} (${dup.short_code})`);
      const org = {
        id:uuidv4(), name, short_code:code, status:'active', system:false,
        inv_rules, created_at:new Date().toISOString(),
        renamed_from:null, renamed_at:null,
      };
      cfg.get('organizations').push(org).write();
      return org;
    },
    updateOrg(id, fields) {
      const org = cfg.get('organizations').find({id}).value();
      if (!org)       throw new Error('Организация не найдена');
      if (org.system) throw new Error('Нельзя изменить системную запись');
      const allowed = ['name','short_code','status'];
      const update = {};
      allowed.forEach(k=>{ if (fields[k]!==undefined) update[k]=fields[k]; });
      cfg.get('organizations').find({id}).assign(update).write();
      return cfg.get('organizations').find({id}).value();
    },
    renameOrg(id, newName, changedBy='system') {
      const org = cfg.get('organizations').find({id}).value();
      if (!org)       throw new Error('Организация не найдена');
      if (org.system) throw new Error('Нельзя переименовать системную запись');
      const oldName = org.name;
      const now = new Date().toISOString();
      cfg.get('organizations').find({id}).assign({
        name:newName, renamed_from:oldName, renamed_at:now,
      }).write();
      db.get('history').push({
        id:uuidv4(), asset_id:null, action_type:'org_renamed', date:now,
        from_who:oldName, to_who:newName, filial:'', location:'',
        equipment:`Организация: ${oldName}`, model:'', type:'', serial:'',
        reason:`Переименование: «${oldName}» → «${newName}»`, changed_by:changedBy,
      }).write();
      return cfg.get('organizations').find({id}).value();
    },
    liquidateOrg(id, targetOrgId, changedBy='system', renumberInv=false) {
      const org = cfg.get('organizations').find({id}).value();
      if (!org)               throw new Error('Организация не найдена');
      if (org.system)         throw new Error('Нельзя ликвидировать системную запись');
      if (id===targetOrgId)   throw new Error('Целевая организация совпадает с ликвидируемой');
      const target = cfg.get('organizations').find({id:targetOrgId}).value();
      if (!target) throw new Error('Целевая организация не найдена');
      const now = new Date().toISOString();
      const affected = db.get('assets').value().filter(a=>a.status!=='списан'&&a.org_id===id);
      let renumbered=0;
      // Вычисляем стартовый счётчик для каждого типа у target ДО переноса
      const targetCounters={};
      if (renumberInv) {
        const allInvs = db.get('assets').value().map(a=>a.inv||'');
        (target.inv_rules||[]).forEach(rule=>{
          const tp=`${target.short_code}-${rule.type_code}-`;
          targetCounters[rule.type_code] = allInvs
            .filter(inv=>inv.startsWith(tp))
            .map(inv=>parseInt(inv.slice(tp.length),10))
            .filter(n=>!isNaN(n))
            .reduce((m,n)=>Math.max(m,n), rule.counter||0);
        });
      }
      affected.forEach(a=>{
        const updates={org_id:targetOrgId, updated_at:now};
        if (renumberInv&&a.inv&&a.inv.startsWith(org.short_code+'-')) {
          // Определяем type_code из старого инв. номера
          const parts = a.inv.split('-');
          const oldTypeCode = parts[1];
          // Ищем правило в target по совпадающему type_code
          const matchRule = (target.inv_rules||[]).find(r=>r.type_code===oldTypeCode);
          if (matchRule) {
            targetCounters[oldTypeCode] = (targetCounters[oldTypeCode]||0) + 1;
            updates.inv_prev=a.inv;
            updates.inv=`${target.short_code}-${oldTypeCode}-${String(targetCounters[oldTypeCode]).padStart(5,'0')}`;
            renumbered++;
          }
        }
        db.get('assets').find({id:a.id}).assign(updates).write();
        db.get('history').push({
          id:uuidv4(), asset_id:a.id, action_type:'org_transfer', date:now,
          from_who:org.name, to_who:target.name,
          filial:a.filial||'', location:a.location||'',
          equipment:`${a.type} ${a.model}`, model:a.model, type:a.type, serial:a.serial,
          reason:`Ликвидация «${org.name}» → «${target.name}»`,
          changed_by:changedBy,
        }).write();
      });
      // Обновляем счётчики целевых правил
      if (renumberInv) {
        const allAssets = db.get('assets').value();
        (target.inv_rules||[]).forEach(rule => {
          const tPrefix = `${target.short_code}-${rule.type_code}-`;
          const maxNum = allAssets
            .map(a => a.inv||'')
            .filter(inv => inv.startsWith(tPrefix))
            .map(inv => parseInt(inv.slice(tPrefix.length),10))
            .filter(n=>!isNaN(n))
            .reduce((m,n)=>Math.max(m,n), rule.counter||0);
          cfg.get('organizations').find({id:targetOrgId})
            .get('inv_rules').find({type_code:rule.type_code})
            .assign({counter:maxNum}).write();
        });
      }
      cfg.get('organizations').find({id}).assign({status:'liquidated', liquidated_at:now}).write();
      return {transferred:affected.length, renumbered};
    },
    nextInv(orgId, typeCode) {
      const org = cfg.get('organizations').find({id:orgId}).value();
      if (!org) throw new Error('Организация не найдена');
      const rule = (org.inv_rules||[]).find(r=>r.type_code===typeCode.toUpperCase()&&r.active!==false);
      if (!rule) throw new Error(`Тип ${typeCode} не настроен для ${org.name}`);
      const prefix=`${org.short_code}-${rule.type_code}-`;
      const maxExisting=db.get('assets').value()
        .map(a=>a.inv||'').filter(inv=>inv.startsWith(prefix))
        .map(inv=>parseInt(inv.replace(prefix,''),10)).filter(n=>!isNaN(n))
        .reduce((m,n)=>Math.max(m,n), rule.counter||0);
      const next=maxExisting+1;
      const inv=`${prefix}${String(next).padStart(5,'0')}`;
      cfg.get('organizations').find({id:orgId})
        .get('inv_rules').find({type_code:rule.type_code})
        .assign({counter:next}).write();
      return {inv, next, prefix};
    },
    addInvRule(orgId, {type_code, type_name, format='{org}-{type}-{N:05}'}) {
      const org = cfg.get('organizations').find({id:orgId}).value();
      if (!org)       throw new Error('Организация не найдена');
      if (org.system) throw new Error('Нельзя добавить правило системной записи');
      const code=type_code.toUpperCase();
      if ((org.inv_rules||[]).find(r=>r.type_code===code))
        throw new Error(`Правило ${code} уже существует`);
      const rule={type_code:code, type_name, counter:0, format, active:true};
      cfg.get('organizations').find({id:orgId}).get('inv_rules').push(rule).write();
      return rule;
    },
    toggleInvRule(orgId, typeCode, active) {
      cfg.get('organizations').find({id:orgId})
        .get('inv_rules').find({type_code:typeCode.toUpperCase()})
        .assign({active}).write();
      return {ok:true};
    },
    renameInvRule(orgId, typeCode, {type_name}) {
      const org = cfg.get('organizations').find({id:orgId}).value();
      if (!org) throw new Error('Организация не найдена');
      const code=typeCode.toUpperCase();
      const rule=(org.inv_rules||[]).find(r=>r.type_code===code);
      if (!rule) throw new Error(`Правило ${code} не найдено`);
      if (!type_name||!type_name.trim()) throw new Error('type_name обязателен');
      cfg.get('organizations').find({id:orgId})
        .get('inv_rules').find({type_code:code})
        .assign({type_name:type_name.trim()}).write();
      return {ok:true};
    },
    deleteInvRule(orgId, typeCode) {
      const org = cfg.get('organizations').find({id:orgId}).value();
      if (!org) throw new Error('Организация не найдена');
      const code=typeCode.toUpperCase();
      const rule=(org.inv_rules||[]).find(r=>r.type_code===code);
      if (!rule) throw new Error(`Правило ${code} не найдено`);
      const prefix=`${org.short_code}-${code}-`;
      const affected=db.get('assets').value().filter(a=>(a.inv||'').startsWith(prefix));
      if (affected.length>0) return {conflict:true, count:affected.length, prefix, typeCode:code};
      const updated=(org.inv_rules||[]).filter(r=>r.type_code!==code);
      cfg.get('organizations').find({id:orgId}).assign({inv_rules:updated}).write();
      return {ok:true};
    },
    deleteInvRuleForce(orgId, typeCode, action, targetTypeCode) {
      const org = cfg.get('organizations').find({id:orgId}).value();
      if (!org) throw new Error('Организация не найдена');
      const code=typeCode.toUpperCase();
      const prefix=`${org.short_code}-${code}-`;
      const now=new Date().toISOString();
      if (action==='reset') {
        db.get('assets').value().filter(a=>(a.inv||'').startsWith(prefix))
          .forEach(a=>db.get('assets').find({id:a.id}).assign({inv:'', updated_at:now}).write());
      } else if (action==='transfer') {
        const targetCode=targetTypeCode.toUpperCase();
        const targetRule=(org.inv_rules||[]).find(r=>r.type_code===targetCode&&r.active!==false);
        if (!targetRule) throw new Error(`Целевое правило ${targetCode} не найдено`);
        const targetPrefix=`${org.short_code}-${targetCode}-`;
        let counter=db.get('assets').value()
          .map(a=>a.inv||'').filter(inv=>inv.startsWith(targetPrefix))
          .map(inv=>parseInt(inv.slice(targetPrefix.length),10)).filter(n=>!isNaN(n))
          .reduce((m,n)=>Math.max(m,n), targetRule.counter||0);
        db.get('assets').value().filter(a=>(a.inv||'').startsWith(prefix))
          .forEach(a=>{
            counter++;
            db.get('assets').find({id:a.id})
              .assign({inv:`${targetPrefix}${String(counter).padStart(5,'0')}`, updated_at:now}).write();
          });
        cfg.get('organizations').find({id:orgId})
          .get('inv_rules').find({type_code:targetCode})
          .assign({counter}).write();
      } else throw new Error(`Неизвестный action: ${action}`);
      const updated=(org.inv_rules||[]).filter(r=>r.type_code!==code);
      cfg.get('organizations').find({id:orgId}).assign({inv_rules:updated}).write();
      return {ok:true};
    },
    getFilials(includeSystem=false) {
      const list=cfg.get('filials').value();
      return includeSystem ? list : list.filter(f=>!f.system);
    },
    getFilial(id) { return cfg.get('filials').find({id}).value()||null; },
    createFilial({name, address='', org_id=null}) {
      if (!name) throw new Error('name обязателен');
      const filial={id:uuidv4(), name, address, org_id, status:'active', system:false,
        created_at:new Date().toISOString(), closed_at:null};
      cfg.get('filials').push(filial).write();
      return filial;
    },
    updateFilial(id, fields) {
      const f=cfg.get('filials').find({id}).value();
      if (!f)       throw new Error('Филиал не найден');
      if (f.system) throw new Error('Нельзя изменить системную запись');
      const update={};
      ['name','address','org_id'].forEach(k=>{ if(fields[k]!==undefined) update[k]=fields[k]; });
      cfg.get('filials').find({id}).assign(update).write();
      return cfg.get('filials').find({id}).value();
    },
    closeFilial(id) {
      const f=cfg.get('filials').find({id}).value();
      if (!f)       throw new Error('Филиал не найден');
      if (f.system) throw new Error('Нельзя закрыть системную запись');
      const affected=db.get('assets').value()
        .filter(a=>a.status!=='списан'&&a.filial_id===id).length;
      cfg.get('filials').find({id}).assign({status:'closed', closed_at:new Date().toISOString()}).write();
      return {closed:true, affected_assets:affected};
    },
    getLocations(filialId=null, includeSystem=false) {
      let list=cfg.get('locations').value();
      if (!includeSystem) list=list.filter(l=>!l.system);
      if (filialId) list=list.filter(l=>l.filial_id===filialId);
      return list;
    },
    createLocation({name, filial_id, type='office'}) {
      if (!name||!filial_id) throw new Error('name и filial_id обязательны');
      const loc={id:uuidv4(), name, filial_id, type, status:'active', system:false,
        created_at:new Date().toISOString(), closed_at:null};
      cfg.get('locations').push(loc).write();
      return loc;
    },
    getAccounts() { return cfg.get('accounts').value()||[]; },
    addAccount({name, login='', password='', note='', category=''}) {
      if (!name) throw new Error('Name required');
      const acc={id:uuidv4(), name, login, password, note, category,
        created_at:new Date().toISOString()};
      cfg.set('accounts',[...cfg.get('accounts').value(), acc]).write();
      return {id:acc.id, ok:true};
    },
    updateAccount(id, {name, login, password, note, category}) {
      const list = cfg.get('accounts').value()||[];
      const acc = list.find(a=>a.id===id);
      if (!acc) throw new Error('Not found');
      const updated = {...acc,
        name:     name     ?? acc.name,
        login:    login    ?? acc.login,
        password: password ?? acc.password,
        note:     note     ?? acc.note,
        category: category ?? acc.category ?? '',
      };
      cfg.set('accounts', list.map(a=>a.id===id?updated:a)).write();
      return {ok:true};
    },
    deleteAccount(id) {
      const list = cfg.get('accounts').value()||[];
      if (!list.find(a=>a.id===id)) throw new Error('Not found');
      cfg.set('accounts', list.filter(a=>a.id!==id)).write();
      return {ok:true};
    },
  };

  // Экспортируем также cfg для проверки в тестах
  Object.defineProperty(db,'cfg',{get(){return cfg;}, enumerable:true});

  // ── Авторизация (методы которые ждёт index.js) ───────────────────────────────
  db.getUser = function(id) {
    return (cfg.get('users').value()||[]).find(u=>u.id===id)||null;
  };
  db.getUsers = function(activeOnly=true) {
    const u = cfg.get('users').value()||[];
    return activeOnly ? u.filter(x=>x.active!==false) : u;
  };

  // ── Сотрудники (зеркало server/database.js) ────────────────────────────────
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
    const emp = db.getEmployee(id);
    if (!emp) throw new Error('Сотрудник не найден');
    const all = cfg.get('employees').value() || [];
    const idx = all.findIndex(e => e.id === id);
    if (idx === -1) throw new Error('Сотрудник не найден');
    all[idx].active = false;
    all[idx].deactivated_at = new Date().toISOString();
    cfg.set('employees', all).write();
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
  db.authUser = function(userId, pin) {
    const user = db.getUser(userId);
    if (!user||!user.active) return null;
    return verifyPin(pin, user.pin) ? user : null;
  };
  db.authByLogin = function(login, password) {
    const users = cfg.get('users').value()||[];
    const user  = users.find(u=>u.active&&u.login&&
      u.login.toLowerCase()===String(login||'').trim().toLowerCase());
    if (!user) return null;
    return verifyPin(password, user.pin) ? user : null;
  };
  db.createUser = function({name,login='',role='operator',pin='',email=''}) {
    const user={id:uuidv4(),name,login,role,pin:hashPin(pin),email,active:true,created_at:new Date().toISOString()};
    const users=cfg.get('users').value()||[];
    cfg.set('users',[...users,user]).write();
    return user;
  };
  db.updateUser = function(id, fields) {
    const users=cfg.get('users').value()||[];
    const idx=users.findIndex(u=>u.id===id);
    if(idx===-1) throw new Error('Пользователь не найден');
    if (fields.pin !== undefined) fields = { ...fields, pin: hashPin(fields.pin) };
    const allowed=['name','login','role','pin','email','active'];
    allowed.forEach(k=>{if(fields[k]!==undefined)users[idx][k]=fields[k];});
    cfg.set('users',users).write();
    return users[idx];
  };

  // ── Settings helpers ──────────────────────────────────────────────────────
  db.getSetting = function(key) { return cfg.get('settings').value()?.[key]; };
  db.setSetting = function(key, val) { cfg.set(`settings.${key}`, val).write(); };

  // Хелпер: добавить ассет напрямую (для setup тестов)
  db._addAsset = function(fields) {
    const now = new Date().toISOString();
    const asset = {
      id: uuidv4(), tab:'os', filial:'', location:'', responsible:'',
      type:'', model:'', serial:'', status:'используется',
      note:'', inv:'', meta:{}, org_id:'sys-org-unk',
      filial_id:'sys-filial-unk', location_id:'sys-location-unk',
      created_at:now, updated_at:now,
      ...fields,
    };
    db.get('assets').push(asset).write();
    return asset;
  };

  return db;
}

module.exports = makeDb;
