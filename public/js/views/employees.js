/**
 * public/js/views/employees.js
 *
 * Фаза 5, шаг 20: справочник сотрудников (для автодополнения поля
 * "Ответственный"), вынесенный из public/index.html. Classic script —
 * та же причина, что и в остальных файлах (см. auth.js).
 *
 * _renderEmployeesPanel() вызывается из renderSettings() (пока в
 * index.html) как внешний глобал — резолвится в момент вызова.
 */

// Фаза 6: было data-action="_closeThenShowEditEmployee" data-args='${JSON.stringify([id])}' — два
// оператора подряд. ВАЖНО: имя уникальное (не _closeThenShowEdit) — в
// asset-forms.js уже есть функция с похожим смыслом, но для другого домена
// (showEditModal актива, не сотрудника) — общий global scope, коллизия имён
// молча перезаписала бы одну из них.
function _closeThenShowEditEmployee(id) { closeModal(); showEditEmployeeModal(id); }

// Было data-action="_doReassignToSelected" data-args='${JSON.stringify([empId])}' —
// читает значение ДРУГОГО элемента в момент клика (не this.value), поэтому
// не покрывается стандартной конвенцией el.value. Обёртка читает элемент
// напрямую, как и в оригинале.
function _doReassignToSelected(empId) {
  reassignEmployeeAssets(empId, document.getElementById('reassign-to-emp').value);
}

// ─── СОТРУДНИКИ ───────────────────────────────────────────────────────────────

// ─── Employees state ─────────────────────────────────────────────────────────
let _empData = [];         // все сотрудники (кэш)
let _empPage = { active: 1, inactive: 1 };
const EMP_PAGE_SIZE = 50;

function _empFilter() {
  const q = (document.getElementById('emp-search-input')?.value || '').trim().toLowerCase();
  const showAll = document.getElementById('emp-show-all')?.checked || false;
  return { q, showAll };
}

function _empFilterList(list, q) {
  if (!q) return list;
  return list.filter(e =>
    e.name.toLowerCase().includes(q) ||
    (e.dept   && e.dept.toLowerCase().includes(q)) ||
    (e.filial  && e.filial.toLowerCase().includes(q)) ||
    (e.phone   && e.phone.includes(q))
  );
}

function _empRenderRows(list) {
  if (!list.length) return `<tr><td colspan="6" class="no-records-cell">${t('msg_no_records')}</td></tr>`;
  return list.map(e => `
    <tr class="clickable${e.active===false?' row-inactive':''}" data-action="showEmployeeDetail" data-args='${JSON.stringify([e.id])}'>
      <td class="u-fw-600">${esc(e.name)}</td>
      <td class="u-text-muted">${esc(e.dept||'—')}</td>
      <td class="u-text-muted">${esc(e.filial||'—')}</td>
      <td class="u-text-muted">${esc(e.phone||'—')}</td>
      <td><span class="emp-status-badge ${e.active!==false?'emp-status-active':'emp-status-dismissed'}">${e.active!==false?t('lbl_active'):t('lbl_dismissed')}</span></td>
      <td class="u-nowrap" data-action="_noop">
        ${e.active!==false
          ? `<button class="btn-icon" data-action="showEditEmployeeModal" data-args='${JSON.stringify([e.id])}'>✏️</button>
             <button class="btn-icon" data-action="deleteEmployee" data-args='${JSON.stringify([e.id, esc(e.name)])}'>🗑</button>`
          : `<button class="btn-icon" data-action="showEditEmployeeModal" data-args='${JSON.stringify([e.id])}' title="${t('tooltip_view')}">👁️</button>`}
      </td>
    </tr>`).join('');
}

// Только обновляет таблицы без пересоздания инпута — фокус не теряется
function _empRefreshTables() {
  const { q, showAll } = _empFilter();
  const active   = _empData.filter(e => e.active !== false);
  const inactive = _empData.filter(e => e.active === false);
  const fActive   = _empFilterList(active, q);
  const fInactive = _empFilterList(inactive, q);

  // Обновляем счётчики
  const hA = document.getElementById('emp-head-active');
  const hI = document.getElementById('emp-head-inactive');
  if (hA) hA.textContent = `${t('lbl_active_section')} (${fActive.length})`;
  if (hI) hI.textContent = `${t('lbl_dismissed_section')} (${fInactive.length})`;

  // Обновляем блоки
  _empRenderSection('active',   fActive,   showAll);
  _empRenderSection('inactive', fInactive, showAll);

  // Пустой результат
  const empty = document.getElementById('emp-empty');
  if (empty) empty.style.display = (fActive.length === 0 && fInactive.length === 0) ? '' : 'none';

  // Обновить счётчик в заголовке карточки
  const total = document.getElementById('emp-total');
  if (total) total.textContent = t('lbl_employees_count', { n: _empData.length });
}

function _empRenderSection(key, list, showAll) {
  const wrap = document.getElementById(`emp-section-${key}`);
  if (!wrap) return;

  const pageSize  = showAll ? list.length || 1 : EMP_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  // Зажимаем текущую страницу
  if (_empPage[key] > pageCount) _empPage[key] = pageCount;
  const page = _empPage[key];
  const slice = list.slice((page - 1) * pageSize, page * pageSize);

  // tbody
  const tbody = wrap.querySelector('tbody');
  if (tbody) tbody.innerHTML = _empRenderRows(slice);

  // пагинатор
  const pager = wrap.querySelector('.emp-pager');
  if (pager) {
    pager.style.display = (pageCount > 1) ? 'flex' : 'none';
    const info = pager.querySelector('.emp-page-info');
    if (info) info.textContent = t('lbl_page_of', { page, count: pageCount });
    pager.querySelector('.emp-prev2')?.toggleAttribute('disabled', page <= 1);
    pager.querySelector('.emp-prev') ?.toggleAttribute('disabled', page <= 1);
    pager.querySelector('.emp-next') ?.toggleAttribute('disabled', page >= pageCount);
    pager.querySelector('.emp-next2')?.toggleAttribute('disabled', page >= pageCount);
  }

  // "показать все"
  const showAllWrap = wrap.querySelector('.emp-show-all-wrap');
  if (showAllWrap) showAllWrap.style.display = (list.length > EMP_PAGE_SIZE) ? '' : 'none';

  // секция видима только если есть данные
  wrap.style.display = list.length === 0 ? 'none' : '';
}

function _empChangePage(key, delta) {
  _empPage[key] = Math.max(1, (_empPage[key] || 1) + delta);
  _empRefreshTables();
}

async function _renderEmployeesPanel() {
  try { _empData = await fetch(`${API}/api/employees`, {headers:ah()}).then(r=>r.json()); }
  catch(e) { _empData = []; }

  _empPage = { active: 1, inactive: 1 };

  return `<div class="card">
    <div class="u-flex-between u-mb-14">
      <div class="section-title u-m-0" id="emp-total">${t('lbl_employees_count', { n: _empData.length })}</div>
      <button class="btn btn-primary btn-sm" data-action="showCreateEmployeeModal">${t('btn_add')}</button>
    </div>
    <div class="u-text-12 u-text-muted u-mb-12">
      ${t('msg_used_for_autocomplete_note')}
    </div>

    <div class="u-mb-15">
      <input type="text" id="emp-search-input"
        placeholder="${t('msg_search_employees_placeholder')}"
        class="emp-search-input"
        data-oninput-action="_empRefreshTables">
    </div>

    ${_empSectionHtml('active',   t('lbl_active_section'))}
    ${_empSectionHtml('inactive', t('lbl_dismissed_section'))}

    <div id="emp-empty" class="emp-empty-state">${t('msg_nothing_found')}</div>
  </div>`;
}

function _empSectionHtml(key, label) {
  return `
  <div id="emp-section-${key}">
    <div class="section-subheader">
      <h3 id="emp-head-${key}" class="u-m-0 u-text-14">${label}</h3>
      <div class="emp-show-all-wrap u-hidden">
        <label class="checkbox-label u-text-12">
          <input type="checkbox" id="emp-show-all" data-onchange-action="_empRefreshTables">
          ${t('lbl_show_all')}
        </label>
      </div>
    </div>
    <div class="emp-pager emp-pager-base">
      <button class="btn btn-sm emp-prev2" data-action="_empChangePage" data-args='${JSON.stringify([key, -9999])}'>⏮</button>
      <button class="btn btn-sm emp-prev"  data-action="_empChangePage" data-args='${JSON.stringify([key, -1])}'>◀</button>
      <span class="emp-page-info u-text-12 u-minw-90 u-text-center">${t('lbl_page_of', { page: 1, count: 1 })}</span>
      <button class="btn btn-sm emp-next"  data-action="_empChangePage" data-args='${JSON.stringify([key, 1])}'>▶</button>
      <button class="btn btn-sm emp-next2" data-action="_empChangePage" data-args='${JSON.stringify([key, 9999])}'>⏭</button>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>${t('th_full_name')}</th><th>${t('th_dept')}</th><th>${t('field_filial')}</th><th>${t('field_phone')}</th><th>${t('field_status')}</th><th></th></tr></thead>
      <tbody></tbody>
    </table></div>
  </div>`;
}

function showCreateEmployeeModal() {
  showModal(`<h2>${t('modal_new_employee_title')}</h2>
    <div class="form-row"><label>${t('field_full_name_required')}</label><input id="em-name" placeholder="${t('msg_full_name_example')}" autofocus/></div>
    <div class="form-row"><label>${t('th_dept')}</label><input id="em-dept" placeholder="${t('msg_dept_placeholder')}"/></div>
    <div class="form-row"><label>${t('field_filial')}</label><input id="em-filial" placeholder="${t('msg_filial_placeholder')}"/></div>
    <div class="form-row"><label>${t('field_phone')}</label><input id="em-phone" placeholder="+7 900 000-00-00"/></div>
    <div class="form-row"><label>${t('field_email')}</label><input id="em-email" type="email" placeholder="ivanov@company.ru"/></div>
    <div class="form-row"><label>${t('field_note')}</label><input id="em-note" placeholder=""/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doCreateEmployee">${t('btn_create')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}

async function doCreateEmployee() {
  const f = id => document.getElementById(id)?.value.trim() || '';
  if (!f('em-name')) return toast(t('msg_enter_full_name'),'error');
  const r = await fetch(`${API}/api/employees`, {method:'POST', headers:ah(),
    body:JSON.stringify({name:f('em-name'),dept:f('em-dept'),filial:f('em-filial'),
      phone:f('em-phone'),email:f('em-email'),note:f('em-note')})});
  const d = await r.json();
  if (r.ok) { closeModal(); toast(t('msg_employee_added'),'success'); _reloadEmployeesPanel(); }
  else toast(d.error||t('msg_error'),'error');
}

async function showEditEmployeeModal(id) {
  let emp;
  try { emp = await fetch(`${API}/api/employees/${id}`,{headers:ah()}).then(r=>r.json()); }
  catch(e) { return toast(t('msg_load_error'),'error'); }
  showModal(`<h2>${t('modal_edit_employee_title')}</h2>
    <div class="form-row"><label>${t('field_full_name_required')}</label><input id="em-name" value="${esc(emp.name||'')}"/></div>
    <div class="form-row"><label>${t('th_dept')}</label><input id="em-dept" value="${esc(emp.dept||'')}"/></div>
    <div class="form-row"><label>${t('field_filial')}</label><input id="em-filial" value="${esc(emp.filial||'')}"/></div>
    <div class="form-row"><label>${t('field_phone')}</label><input id="em-phone" value="${esc(emp.phone||'')}"/></div>
    <div class="form-row"><label>${t('field_email')}</label><input id="em-email" value="${esc(emp.email||'')}"/></div>
    <div class="form-row"><label>${t('field_note')}</label><input id="em-note" value="${esc(emp.note||'')}"/></div>
    <div class="form-row"><label>${t('field_status')}</label>
      <select id="em-active">
        <option value="true"  ${emp.active!==false?'selected':''}>${t('lbl_active')}</option>
        <option value="false" ${emp.active===false?'selected':''}>${t('lbl_dismissed')}</option>
      </select></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doUpdateEmployee" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}

async function doUpdateEmployee(id) {
  const f = i => document.getElementById(i)?.value.trim() || '';
  if (!f('em-name')) return toast(t('msg_enter_full_name'),'error');
  const active = document.getElementById('em-active')?.value === 'true';
  const r = await fetch(`${API}/api/employees/${id}`, {method:'PUT', headers:ah(),
    body:JSON.stringify({name:f('em-name'),dept:f('em-dept'),filial:f('em-filial'),
      phone:f('em-phone'),email:f('em-email'),note:f('em-note'),active})});
  const d = await r.json();
  if (r.ok) { closeModal(); toast(t('msg_saved'),'success'); _reloadEmployeesPanel(); }
  else toast(d.error||t('msg_error'),'error');
}

async function deleteEmployee(id, name) {
  if (!confirm(t('msg_confirm_dismiss', { name }))) return;
  const r = await fetch(`${API}/api/employees/${id}`, {method:'DELETE', headers:ah()});
  const d = await r.json();
  if (r.ok) {
    // Если есть оборудование — показываем модальное окно
    if (d.linked_assets && d.linked_assets > 0) {
      showReassignAssetsModal(id, name, d.assets || []);
    } else {
      toast(t('msg_employee_deactivated'),'success');
      _reloadEmployeesPanel();
    }
  } else {
    toast(d.error||t('msg_delete_error'),'error');
  }
}

async function showReassignAssetsModal(empId, empName, assets) {
  // Получаем всех активных сотрудников кроме текущего
  const allEmps = await fetch(`${API}/api/employees?active=true`, {headers:ah()}).then(r=>r.json());
  const otherEmps = allEmps.filter(e => e.id !== empId);
  
  const modalContent = `
    <div class="u-p-20">
      <h2>${t('modal_move_equipment_dismissal')}</h2>
      <p class="u-mt-10 u-opacity-8">
        ${t('msg_employee_has_equipment', { name: esc(empName), n: assets.length })}
      </p>
      <div class="assets-scroll-box">
        ${assets.map((a,i) => `
          <div class="asset-list-item${i === assets.length-1 ? ' asset-list-item-last' : ''}">
            <div class="u-fw-500">${a.type} ${a.model}</div>
            <div class="u-text-12 u-opacity-6">${t('msg_serial_label')}: ${a.serial || '—'} | ${t('msg_inv_label')}: ${a.inv || '—'}</div>
          </div>
        `).join('')}
      </div>
      
      <p class="u-mt-20 u-mb-10">${t('msg_choose_action')}</p>
      <div class="u-flex-col-gap-10">
        <div class="option-box" 
          id="leave-unassigned-opt"
          onmouseover="this.style.background='var(--surface1)'" 
          onmouseout="this.style.background=''">
          <div class="u-fw-600 u-mb-5">${t('opt_leave_unassigned_title')}</div>
          <div class="u-text-12 u-opacity-7">${t('msg_will_remain_in_org', { org: empName })}</div>
          <button class="btn btn-primary u-mt-10 u-w-100" 
            data-action="reassignEmployeeAssets" data-args='${JSON.stringify([empId, null])}'>${t('btn_leave_unassigned')}</button>
        </div>
        
        ${otherEmps.length > 0 ? `
        <div class="option-box-static">
          <div class="u-fw-600 u-mb-10">${t('opt_move_to_other_title')}</div>
          <select id="reassign-to-emp" class="reassign-select">
            <option value="">${t('opt_choose_employee')}</option>
            ${otherEmps.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}
          </select>
          <button class="btn btn-primary u-w-100" 
            data-action="_doReassignToSelected" data-args='${JSON.stringify([empId])}'>${t('btn_move')}</button>
        </div>
        ` : ''}
        
        <button class="btn btn-secondary u-w-100" data-action="closeModal">${t('btn_cancel')}</button>
      </div>
    </div>
  `;
  showModal(modalContent);
}

async function reassignEmployeeAssets(fromEmpId, toEmpId) {
  const payload = toEmpId ? { to_employee_id: toEmpId } : {};
  const r = await fetch(`${API}/api/employees/${fromEmpId}/reassign-assets`, {
    method:'POST',
    headers:{...ah(),'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const d = await r.json();
  if (r.ok) {
    closeModal();
    if (toEmpId) {
      toast(t('msg_equipment_moved_count', { n: d.moved }), 'success');
    } else {
      toast(t('msg_equipment_left_unassigned_count', { n: d.left_unassigned }), 'success');
    }
    _reloadEmployeesPanel();
  } else {
    toast(d.error || t('msg_move_error'), 'error');
  }
}

async function _reloadEmployeesPanel() {
  const p = document.getElementById('settings-panel');
  if (!p) return;
  p.innerHTML = await _renderEmployeesPanel();
  // После рендера сразу заполняем таблицы
  _empRefreshTables();
}

async function showEmployeeDetail(id) {
  try {
    const emp = await fetch(`${API}/api/employees/${id}`,{headers:ah()}).then(r=>r.json());
    const assets = await fetch(`${API}/api/assets?search=${encodeURIComponent(emp.name)}`,{headers:ah()}).then(r=>r.json());
    const myAssets = (assets.items||[]).filter(a => a.responsible === emp.name);
    showModal(`<h2>🧑‍💼 ${esc(emp.name)}</h2>
      <div class="emp-detail-grid">
        ${emp.dept   ?`<div><div class="u-text-11 u-text-muted">${t('lbl_dept_caps')}</div><b>${esc(emp.dept)}</b></div>`:''}
        ${emp.filial ?`<div><div class="u-text-11 u-text-muted">${t('lbl_filial_caps')}</div><b>${esc(emp.filial)}</b></div>`:''}
        ${emp.phone  ?`<div><div class="u-text-11 u-text-muted">${t('lbl_phone_caps')}</div><b>${esc(emp.phone)}</b></div>`:''}
        ${emp.email  ?`<div><div class="u-text-11 u-text-muted">EMAIL</div><b>${esc(emp.email)}</b></div>`:''}
      </div>
      <div class="u-text-13 u-fw-600 u-mb-8">${t('lbl_equipment_count', { n: myAssets.length })}</div>
      ${myAssets.length ? `<div class="u-max-h-200">
        ${myAssets.map(a=>`<div class="equip-list-item">
          <span class="u-text-muted">${esc(a.type||'')}</span>
          <b class="u-mx-6">${esc(a.model)}</b>
          ${a.inv?`<code class="u-text-11 u-text-accent">${esc(a.inv)}</code>`:''}
        </div>`).join('')}
      </div>` : `<div class="u-text-muted u-text-13">${t('msg_no_equipment')}</div>`}
      <div class="modal-actions u-mt-14">
        <button class="btn btn-primary btn-sm" data-action="_closeThenShowEditEmployee" data-args='${JSON.stringify([id])}'>✏️ ${t('btn_edit')}</button>
        <button class="btn btn-secondary" data-action="closeModal">${t('btn_close')}</button>
      </div>`);
  } catch(e) { toast(t('msg_error'),'error'); }
}

// ── Автодополнение сотрудников ────────────────────────────────────────────────
let _empAcTimer = null;

function initEmployeeAutocomplete(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp || inp._empAcInited) return;
  inp._empAcInited = true;
  const dd = document.createElement('div');
  dd.id = inputId + '-emp-dd';
  dd.className = 'emp-ac-dd';
  inp.parentElement.style.position = 'relative';
  inp.parentElement.appendChild(dd);

  let _acIdx = -1;

  inp.addEventListener('input', () => {
    _acIdx = -1;
    clearTimeout(_empAcTimer);
    _empAcTimer = setTimeout(() => _fetchEmpSuggestions(inputId), 200);
  });
  inp.addEventListener('blur', () => setTimeout(() => { dd.style.display='none'; _acIdx=-1; }, 200));
  inp.addEventListener('keydown', e => {
    const items = dd.querySelectorAll('.emp-ac-item');
    if (e.key === 'Escape') { dd.style.display='none'; _acIdx=-1; return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _acIdx = Math.min(_acIdx + 1, items.length - 1);
      items.forEach((el, i) => el.style.background = i === _acIdx ? 'var(--surface2)' : '');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _acIdx = Math.max(_acIdx - 1, 0);
      items.forEach((el, i) => el.style.background = i === _acIdx ? 'var(--surface2)' : '');
    } else if (e.key === 'Enter' && _acIdx >= 0 && items[_acIdx]) {
      e.preventDefault();
      items[_acIdx].click();
    } else if (e.key === 'Tab' && _acIdx >= 0 && items[_acIdx]) {
      e.preventDefault();
      items[_acIdx].click();
    }
  });
}

async function _fetchEmpSuggestions(inputId) {
  const inp = document.getElementById(inputId);
  const dd  = document.getElementById(inputId + '-emp-dd');
  if (!inp || !dd) return;
  const q = inp.value.trim();
  if (q.length < 1) { dd.style.display='none'; return; }
  try {
    const emps = (_empData || []).filter(e =>
      e.active !== false &&
      e.name.toLowerCase().includes(q.toLowerCase())
    ).slice(0, 8);
    if (!emps.length) { dd.style.display='none'; return; }
    dd.innerHTML = emps.map(e => `
      <div class="emp-ac-item hover-surface2 emp-ac-item-inner"
        data-onmousedown-action="_preventDefault"
        data-action="_selectEmployee" data-args='${JSON.stringify([inputId, e.name])}'>
        <div class="u-fw-600">${esc(e.name)}</div>
        ${e.dept||e.filial ? `<div class="u-text-11 u-text-muted">${[e.dept,e.filial].filter(Boolean).join(' · ')}</div>` : ''}
      </div>`).join('');
    dd.style.display = 'block';
  } catch(e) { dd.style.display='none'; }
}

function _selectEmployee(inputId, name) {
  const inp = document.getElementById(inputId);
  const dd  = document.getElementById(inputId + '-emp-dd');
  if (inp) { inp.value = name; inp.dispatchEvent(new Event('change')); }
  if (dd)  dd.style.display = 'none';
}
