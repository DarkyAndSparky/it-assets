/**
 * public/js/views/audit-log.js
 *
 * Вкладка «Аудит» в настройках (только для admin, см. settings-router.js —
 * доступ уже отфильтрован на уровне рендера панели, здесь дублирующая
 * проверка не нужна). Показывает общесистемный audit_log (GET /api/audit,
 * requireAdmin на бэкенде — см. server/routes/audit.routes.js).
 *
 * Не путать с history.js — та про перемещения/версии активов, эта — про
 * действия пользователей и системы (вход, API-ключи, LDAP-конфиг, смена
 * ролей, restore из бэкапа).
 *
 * ВАЖНО про фильтры: GET /api/audit НЕ поддерживает полнотекстовый поиск и
 * offset-пагинацию (см. server/repositories/audit.repo.js::listAudit) —
 * только actor_id/entity/entity_id (точное совпадение) + from/to по ts +
 * limit (зажат в 1–500). Поэтому здесь: серверные фильтры по entity и
 * диапазону дат + limit-селектор («последние N»), и лёгкий клиентский
 * текстовый фильтр поверх уже полученной страницы (не эмулирует полный
 * поиск по всей таблице — только по тому, что уже на экране).
 */

let auditFilters = { entity: '', from: '', to: '', limit: 100 };
let auditClientSearch = '';

const AUDIT_ACTION_ICON = {
  'login.success': '🔓', 'login.fail': '🚫',
  'apikey.create': '🔑', 'apikey.revoke': '🗝️',
  'ldap.config_update': '🧩',
  'user.role_change': '👤',
  'backup.restore': '♻️',
};
const AUDIT_ACTION_BADGE = {
  'login.success': 'hist-badge-add', 'login.fail': 'hist-badge-retire',
  'apikey.create': 'hist-badge-add', 'apikey.revoke': 'hist-badge-retire',
  'ldap.config_update': 'hist-badge-move',
  'user.role_change': 'hist-badge-reassign',
  'backup.restore': 'hist-badge-import',
};

function _setAuditFilter(field, value) {
  auditFilters[field] = value;
  _refreshAuditPanel();
}

function _setAuditSearch() {
  auditClientSearch = (this.value || '').toLowerCase();
  _refreshAuditPanel();
}

async function _refreshAuditPanel() {
  const panel = document.getElementById('settings-panel');
  if (panel) panel.innerHTML = await _renderAuditPanel();
}

async function _renderAuditPanel() {
  const p = new URLSearchParams();
  if (auditFilters.entity) p.set('entity', auditFilters.entity);
  if (auditFilters.from)   p.set('from', auditFilters.from);
  if (auditFilters.to)     p.set('to', auditFilters.to + 'T23:59:59.999Z');
  p.set('limit', auditFilters.limit);

  let rows = [];
  try { rows = await fetch(`${API}/api/audit?${p}`, { headers: ah() }).then(r => r.ok ? r.json() : []); }
  catch (e) { rows = []; }

  // Список объектов для фильтра — из уже полученных записей (см. примечание
  // в шапке файла про отсутствие серверного /api/audit/entities).
  const entities = [...new Set(rows.map(r => r.entity).filter(Boolean))].sort();

  const filtered = auditClientSearch
    ? rows.filter(r => [r.action, r.actor_name, r.entity, r.entity_id]
        .some(v => String(v || '').toLowerCase().includes(auditClientSearch)))
    : rows;

  return `
  <div class="card">
    <div class="u-flex-between-wrap-gap-8">
      <div class="section-title u-m-0">${t('audit_title')} <span class="u-text-12 u-text-muted u-fw-400">${t('msg_showing_of', { shown: filtered.length, total: rows.length })}</span></div>
    </div>
    <div class="u-text-12 u-text-muted u-mb-12 u-lh-16">${t('audit_hint')}</div>
    <div class="filters">
      <input class="search-inp u-flex-2-minw-160" placeholder="🔍" value="${esc(auditClientSearch)}"
        data-oninput-action="_setAuditSearch"/>
      <select class="filter-sel" data-onchange-action="_setAuditFilter" data-onchange-args='["entity"]'>
        <option value="">${t('opt_all_entities')}</option>
        ${entities.map(e => `<option value="${esc(e)}" ${auditFilters.entity===e?'selected':''}>${esc(e)}</option>`).join('')}
      </select>
      <input type="date" class="filter-date" value="${auditFilters.from}" title="${t('tooltip_date_from')}"
        data-onchange-action="_setAuditFilter" data-onchange-args='["from"]'/>
      <input type="date" class="filter-date" value="${auditFilters.to}" title="${t('tooltip_date_to')}"
        data-onchange-action="_setAuditFilter" data-onchange-args='["to"]'/>
      <select class="filter-sel u-minw-100" data-onchange-action="_setAuditFilter" data-onchange-args='["limit"]'>
        <option value="50"  ${auditFilters.limit==50 ?'selected':''}>50</option>
        <option value="100" ${auditFilters.limit==100?'selected':''}>100</option>
        <option value="200" ${auditFilters.limit==200?'selected':''}>200</option>
        <option value="500" ${auditFilters.limit==500?'selected':''}>500</option>
      </select>
      ${(auditFilters.entity||auditFilters.from||auditFilters.to||auditClientSearch) ? `<button class="btn btn-ghost btn-sm" data-action="_resetAuditFilters">✕ ${t('btn_reset')}</button>` : ''}
    </div>
    ${filtered.length===0?`<div class="u-text-center u-p-40 u-text-muted">${t('msg_no_audit_records')}</div>`:`
    <div class="tbl-wrap"><table>
      <thead><tr><th>${t('th_audit_datetime')}</th><th>${t('th_audit_action')}</th><th>${t('th_audit_actor')}</th><th>${t('th_audit_entity')}</th><th>${t('th_audit_detail')}</th></tr></thead>
      <tbody>${filtered.map(r => {
        const dt = r.ts ? new Date(r.ts) : null;
        const dateStr = dt ? dt.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' }) : '—';
        const timeStr = dt ? dt.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' }) : '';
        const badge = AUDIT_ACTION_BADGE[r.action] || 'hist-badge-move';
        const icon  = AUDIT_ACTION_ICON[r.action] || '📋';
        const detailStr = r.detail ? esc(JSON.stringify(r.detail)) : '—';
        return `<tr>
          <td class="u-nowrap">
            <div class="u-fw-600 u-text-base">${dateStr}</div>
            ${timeStr?`<div class="u-text-11 u-text-muted">${timeStr}</div>`:''}
          </td>
          <td><span class="hist-badge-icon ${badge}">${icon} ${esc(r.action)}</span></td>
          <td class="u-text-12 u-nowrap">${esc(r.actor_name) || `<span class="u-text-muted">${t('lbl_system')}</span>`}</td>
          <td class="u-text-12">${esc(r.entity)||'—'}${r.entity_id?`<div class="u-text-11 u-text-muted mono">${esc(r.entity_id)}</div>`:''}</td>
          <td class="u-text-11 u-text-muted mono u-max-w-260 u-ellipsis" title="${detailStr}">${detailStr}</td>
        </tr>`;
      }).join('')}</tbody></table></div>
    ${rows.length >= auditFilters.limit ? `<div class="u-text-11 u-text-muted u-p-8">${t('msg_audit_limit_hint')}</div>` : ''}
    `}
  </div>`;
}

function _resetAuditFilters() {
  auditFilters = { entity: '', from: '', to: '', limit: 100 };
  auditClientSearch = '';
  _refreshAuditPanel();
}
