/**
 * server/repositories/stats.repo.js
 *
 * Фаза 4c рефакторинга (добивка сервисных отчётов): статистика по активам,
 * вынесенная из index.js без изменения поведения.
 */
'use strict';

const db = require('../database');
const assetsRepo = require('./assets.repo');

function getStats() {
  const all     = assetsRepo.getAllAssets().filter(a => a.status !== 'списан');
  const active  = all.filter(a => a.status === 'используется').length;
  const reserve = all.filter(a => a.status === 'резерв').length;
  const noResp  = all.filter(a => !a.responsible||a.responsible==='?'||a.responsible==='—').length;
  const noInv   = all.filter(a => !a.inv || a.inv === '—').length;
  const noSerial= all.filter(a => !a.serial || a.serial === '—').length;
  // PROD-5: гарантия/ТО (meta.warranty, дата — тип поля задаётся схемой
  // типа, PROD-1). "Скоро истекает" — 30 дней вперёд, не включает уже
  // истёкшие (те считаются отдельно, чтобы на дашборде было видно две
  // разные по срочности категории, а не одну смешанную).
  const now = Date.now();
  const WARRANTY_SOON_MS = 30*24*60*60*1000;
  const warrantyDates = all.map(a => a.meta?.warranty ? new Date(a.meta.warranty) : null).filter(d => d && !isNaN(d));
  const warrantyExpired   = warrantyDates.filter(d => +d < now).length;
  const warrantyExpiring  = warrantyDates.filter(d => +d >= now && +d <= now + WARRANTY_SOON_MS).length;
  const count   = arr => arr.reduce((m,a) => { m[a] = (m[a]||0)+1; return m; }, {});
  const toArr   = (obj, key) => Object.entries(obj).map(([k,n]) => ({[key]:k,n})).sort((a,b)=>b.n-a.n);

  // Разрешаем org_id → name через справочник, fallback на строковое поле org
  const orgMap = Object.fromEntries(
    db.config.getOrgs(true).map(o => [o.id, o.name])
  );
  const SYS_ORG = new Set(['sys-org-unk', '', undefined, null]);
  const orgNames = all.map(a => {
    if (a.org_id && !SYS_ORG.has(a.org_id)) return orgMap[a.org_id] || a.org || '—';
    return (a.org && a.org !== '—' && a.org !== '?') ? a.org : '—';
  });

  return {
    total:all.length, active, reserve, noResp, noInv, noSerial,
    warrantyExpired, warrantyExpiring,
    byFilial:   toArr(count(all.map(a=>a.filial)),   'filial'),
    byOrg:      toArr(count(orgNames), 'org').filter(o=>o.org!=='—'),
    byType:     toArr(count(all.map(a=>a.type)),     'type').slice(0,10),
    byTab:      toArr(count(all.map(a=>a.tab)),      'tab'),
    byCategory: toArr(count(all.map(a=>a.category)), 'category'),
  };
}

module.exports = { getStats };
