/**
 * public/js/views/inventory.js
 *
 * IDEA-3: «Инвентаризация по месту» — оператор выбирает место, сканирует
 * (физическим сканером — keyboard-emulation + Enter, тот же паттерн, что
 * у /scan.html, PROD-8) всё, что реально там стоит, накопленный список
 * кодов уходит ОДНИМ запросом на сверку с учётом (POST
 * /api/assets/inventory-check). Только отчёт — сама сверка НИЧЕГО не
 * меняет в БД, поправки (переместить/списать) — вручную, обычными
 * средствами приложения.
 *
 * Список сканов хранится ТОЛЬКО в памяти вкладки (массив `_invScanned`) —
 * не в БД, не в localStorage: закрыл вкладку/обновил страницу — обход
 * начинается заново. Осознанно просто (см. обоснование «без серверной
 * сессии» в assets.repo.js::checkInventoryByLocation) — персистентность
 * обхода была бы отдельной, более сложной задачей.
 */
let _invLocation = '';
let _invScanned = [];
let _invResult = null;

async function renderInventory() {
  const locations = await fetch(`${API}/api/locations`, { headers: ah() }).then(r => r.json()).catch(() => []);

  document.getElementById('app').innerHTML = `
  <div class="u-flex-between u-mb-12">
    <div class="u-text-16 u-fw-700">${t('inv_title')}</div>
  </div>
  <div class="card u-max-w-600 u-mb-12">
    <div class="form-row"><label>${t('inv_location_label')}</label>
      <select id="inv-location-select">
        <option value="">${t('inv_select_location')}</option>
        ${locations.map(l => `<option value="${esc(l.name)}" ${l.name === _invLocation ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-row"><label>${t('inv_scan_label')}</label>
      <input type="text" id="inv-scan-input" placeholder="${t('inv_scan_placeholder')}" autocomplete="off" ${!_invLocation ? 'disabled' : ''}>
    </div>
    <div class="u-text-12 u-text-muted u-mb-8">${t('inv_scanned_count', { n: _invScanned.length })}</div>
    <div class="u-flex-gap-8 u-wrap">
      <button class="btn btn-primary btn-sm" data-action="_invCheck" ${!_invScanned.length || !_invLocation ? 'disabled' : ''}>${t('inv_btn_check')}</button>
      <button class="btn btn-ghost btn-sm" data-action="_invReset">${t('inv_btn_reset')}</button>
    </div>
  </div>
  <div id="inv-result">${_invResult ? _renderInventoryResult(_invResult) : ''}</div>
  `;

  const sel = document.getElementById('inv-location-select');
  sel.addEventListener('change', () => {
    _invLocation = sel.value;
    _invScanned = [];
    _invResult = null;
    renderInventory();
  });
  const input = document.getElementById('inv-scan-input');
  if (input) {
    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const code = input.value.trim();
      if (code) { _invScanned.push(code); input.value = ''; renderInventory(); }
    });
  }
}

async function _invCheck() {
  const res = await fetch(`${API}/api/assets/inventory-check`, {
    method: 'POST', headers: { ...ah(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: _invLocation, codes: _invScanned }),
  });
  if (!res.ok) { toast(t('msg_load_error', { msg: 'HTTP ' + res.status }), 'error'); return; }
  _invResult = await res.json();
  renderInventory();
}

function _invReset() {
  _invLocation = ''; _invScanned = []; _invResult = null;
  renderInventory();
}

function _renderInventoryResult(r) {
  const section = (title, items, cls, renderRow) => !items.length ? '' : `
    <div class="card u-mb-12">
      <div class="section-title ${cls}">${title} (${items.length})</div>
      ${items.map(renderRow).join('')}
    </div>`;
  const assetRow = (a) => `<div class="u-py-6 u-text-13" style="border-bottom:1px solid var(--border)">${esc(a.model || '')} — ${esc(a.inv || a.serial || '')}</div>`;

  return `
    ${section(t('inv_res_missing'), r.missing, 'u-text-danger-fallback', assetRow)}
    ${section(t('inv_res_unexpected'), r.unexpected, 'u-text-warn', a => `<div class="u-py-6 u-text-13" style="border-bottom:1px solid var(--border)">${esc(a.model || '')} — ${esc(a.inv || a.serial || '')} (${t('inv_res_actual_location')}: ${esc(a.actual_location || '—')})</div>`)}
    ${section(t('inv_res_unknown'), r.unknown, 'u-text-warn', code => `<div class="u-py-6 u-text-13 mono" style="border-bottom:1px solid var(--border)">${esc(code)}</div>`)}
    ${!r.missing.length && !r.unexpected.length && !r.unknown.length ? `<div class="card"><span class="u-text-success">${t('inv_res_all_ok')}</span></div>` : ''}
  `;
}
