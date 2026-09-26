/**
 * public/js/views/types-admin.js
 *
 * Фаза 5, шаг 21: редактор справочника "Типы устройств" (вкладка
 * настроек), вынесенный из public/index.html. Classic script — та же
 * причина, что и в остальных файлах (см. auth.js).
 *
 * _renderTypesPanel() вызывается из renderSettings() (пока в index.html)
 * как внешний глобал.
 *
 * LOC-5: локализовано на t()/I18N (см. public/js/i18n.js). TAB_OPTIONS
 * генерируется функцией _tabOptions(), а не константой на верхнем уровне —
 * нужно чтобы t() успел резолвиться в актуальном языке при каждом вызове
 * (переключение языка меняет _lang в рантайме, статичная константа бы
 * "заморозила" подписи на языке при первой загрузке скрипта).
 */

// ─── ТИПЫ УСТРОЙСТВ ──────────────────────────────────────────────────────────
function _tabOptions() {
  return [
    {v:'os',    l:t('nav_os')},
    {v:'small', l:t('nav_small')},
    {v:'infra', l:t('nav_infra')},
  ];
}
const TAB_COLORS = {os:'#3b82f6',small:'#8b5cf6',infra:'#10b981'};
function _tabLabelsShort() {
  return {os:t('tab_os'), small:t('tab_small'), infra:t('tab_infra')};
}

async function _renderTypesPanel() {
  let types = [];
  try { types = await fetch(`${API}/api/type-codes`, { headers: ah() }).then(r=>r.json()); } catch(e){}
  _typesBuffer = types;

  const tabOptions = _tabOptions();
  const rows = types.map((ty,i) => {
    const tabSel = tabOptions.map(o =>
      `<option value="${o.v}" ${(ty.tab||'os')===o.v?'selected':''}>${o.l}</option>`
    ).join('');
    return `
    <tr>
      <td><code class="u-text-12 u-text-indigo">${esc(ty.code)}</code></td>
      <td><input value="${esc(ty.name)}"
        class="type-edit-input"
        data-onchange-action="updateTypeCode" data-onchange-args='${JSON.stringify([i, 'name'])}'/></td>
      <td>
        <select class="type-edit-select tab-color-${ty.tab||'os'}"
          data-onchange-action="updateTypeCode" data-onchange-args='${JSON.stringify([i, 'tab'])}'>
          ${tabSel}
        </select>
      </td>
      <td class="u-text-center">
        <button class="btn-icon" title="${t('tooltip_field_schema')}" data-action="showFieldSchemaModal" data-args='${JSON.stringify([ty.code])}'>🛠</button>
        <button class="btn-icon" title="${t('tooltip_component_slots')}" data-action="showComponentSlotsModal" data-args='${JSON.stringify([ty.code])}'>🔗</button>
        <button class="btn-icon" title="${t('tooltip_delete')}" data-action="deleteTypeCode" data-args='${JSON.stringify([i])}'>🗑</button>
      </td>
    </tr>`;
  }).join('');

  const tabLabelsShort = _tabLabelsShort();
  const summary = ['os','small','infra'].map(tab => {
    const n = types.filter(ty=>(ty.tab||'os')===tab).length;
    return `<span class="tab-color-${tab} u-fw-600">${tabLabelsShort[tab]}: ${n}</span>`;
  }).join(' &nbsp;·&nbsp; ');

  return `
    <div class="card">
      <div class="u-flex-between u-mb-6">
        <div class="section-title u-m-0">${t('types_title')}</div>
        <button class="btn btn-primary btn-sm" data-action="showAddTypeModal">${t('btn_add')}</button>
      </div>
      <div class="u-text-12 u-text-muted u-mb-6 u-lh-16">
        ${t('types_hint')}
      </div>
      <div class="info-panel">
        ${t('lbl_distribution')}: ${summary}
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>${t('th_code')}</th><th>${t('th_type_name')}</th><th>${t('th_collection')}</th><th></th></tr></thead>
          <tbody>${rows||`<tr><td colspan="4" class="u-text-muted u-text-center">${t('msg_no_types')}</td></tr>`}</tbody>
        </table>
      </div>
      <div class="u-mt-12 u-flex-gap-8">
        <button class="btn btn-primary btn-sm" data-action="saveTypeCodes">${t('btn_save_icon')}</button>
        <span class="u-text-11 u-text-muted">${t('msg_changes_next_import')}</span>
      </div>
    </div>`;
}

let _typesBuffer = null;

async function _loadTypesBuffer() {
  if (!_typesBuffer) {
    _typesBuffer = await fetch(`${API}/api/type-codes`, { headers: ah() }).then(r=>r.json()).catch(()=>[]);
  }
  return _typesBuffer;
}

function updateTypeCode(idx, field, value) {
  if (!_typesBuffer) return;
  _typesBuffer[idx][field] = value;
  // При делегировании через data-onchange-action this === элемент (fn.apply(el, args)).
  // Раньше это был отдельный inline-обработчик onchange рядом с onclick, теперь —
  // побочный эффект прямо здесь: подсвечиваем select цветом выбранной вкладки.
  if (field === 'tab' && this && this.style) this.style.color = TAB_COLORS[value] || 'inherit';
}

async function deleteTypeCode(idx) {
  const types = await _loadTypesBuffer();
  const ty = types[idx];
  if (!confirm(t('confirm_delete_type', { name: ty.name, code: ty.code }))) return;
  _typesBuffer.splice(idx, 1);
  const panel = document.getElementById('settings-panel');
  if (panel) panel.innerHTML = await _renderTypesPanel();
}

function showAddTypeModal() {
  const opts = _tabOptions().map(o=>`<option value="${o.v}">${o.l}</option>`).join('');
  showModal(`<h2>${t('modal_new_type_title')}</h2>
    <div class="form-row"><label>${t('field_code_hint')}</label>
      <input id="at-code" placeholder="NB" maxlength="5"
        class="u-uppercase" data-oninput-action="forceUppercase"/></div>
    <div class="form-row"><label>${t('field_type_name_required')}</label>
      <input id="at-name" placeholder="${t('msg_type_name_placeholder')}"/></div>
    <div class="form-row"><label>${t('field_collection_required')}</label>
      <select id="at-tab">${opts}</select></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doAddTypeCode">${t('btn_add')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}

async function doAddTypeCode() {
  const code = document.getElementById('at-code')?.value.trim().toUpperCase();
  const name = document.getElementById('at-name')?.value.trim();
  const tab  = document.getElementById('at-tab')?.value || 'os';
  if (!code || !name) return toast(t('msg_fill_all_fields'), 'error');
  const types = await _loadTypesBuffer();
  if (types.find(ty => ty.code === code)) return toast(t('msg_code_exists', { code }), 'error');
  _typesBuffer.push({ code, name, tab });
  closeModal();
  const panel = document.getElementById('settings-panel');
  if (panel) panel.innerHTML = await _renderTypesPanel();
}

async function saveTypeCodes() {
  if (!_typesBuffer) return toast(t('msg_no_data'), 'error');
  const r = await fetch(`${API}/api/type-codes`, {
    method: 'PUT', headers: ah(),
    body: JSON.stringify({ codes: _typesBuffer })
  });
  const d = await r.json();
  if (r.ok) {
    toast(t('msg_types_saved'), 'success');
    _typesBuffer = null; // сбрасываем кэш
  } else toast(d.error || t('msg_error'), 'error');
}

// ─── PROD-4: редактор схемы типизированных полей по type_code (PROD-1) ─────
// Значения key ограничены server/db/sqlite.js::META_KEYS — берём список с
// сервера (GET /api/meta-keys), а не дублируем его тут константой (см.
// комментарий у роута в types.routes.js).
const FIELD_TYPES = ['text', 'number', 'select', 'boolean', 'ip', 'date'];

async function showFieldSchemaModal(typeCode) {
  let metaKeys = [], schema = null;
  try {
    const [keys, allSchemas] = await Promise.all([
      fetch(`${API}/api/meta-keys`, { headers: ah() }).then(r=>r.json()),
      fetch(`${API}/api/field-schemas`, { headers: ah() }).then(r=>r.json()),
    ]);
    metaKeys = keys;
    schema = allSchemas[typeCode] || null;
  } catch(e) { return toast(t('msg_error'), 'error'); }

  const byKey = {};
  (schema || []).forEach(f => { byKey[f.key] = f; });

  const rows = metaKeys.map(key => {
    const f = byKey[key];
    const included = !!f;
    const type = f?.type || 'text';
    const label = f?.label || '';
    const options = (f?.options || []).join(', ');
    const required = !!f?.required;
    const typeOpts = FIELD_TYPES.map(ft =>
      `<option value="${ft}" ${type===ft?'selected':''}>${t('opt_ftype_'+ft)}</option>`
    ).join('');
    return `
      <tr data-field-key="${key}">
        <td class="u-text-center"><input type="checkbox" class="fs-included" ${included?'checked':''}/></td>
        <td><code class="u-text-12 u-text-indigo">${esc(key)}</code></td>
        <td><select class="fs-type u-text-13">${typeOpts}</select></td>
        <td><input class="fs-label u-text-13 u-w-100" value="${esc(label)}" placeholder="${esc(metaLabel(key))}"/></td>
        <td><input class="fs-options u-text-13 u-w-100" value="${esc(options)}" placeholder="a, b, c" ${type==='select'?'':'disabled'}/></td>
        <td class="u-text-center"><input type="checkbox" class="fs-required" ${required?'checked':''}/></td>
      </tr>`;
  }).join('');

  showModal(`<h2>${t('modal_field_schema_title')} ${esc(typeCode)}</h2>
    <div class="u-text-12 u-text-muted u-mb-12 u-lh-16">${t('msg_field_schema_hint')}</div>
    <div class="tbl-wrap">
      <table id="fs-table">
        <thead><tr>
          <th>${t('lbl_field_included')}</th><th>${t('th_field_key')}</th><th>${t('lbl_field_type')}</th>
          <th>${t('lbl_field_label')}</th><th>${t('lbl_field_options')}</th><th>${t('lbl_field_required')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="_saveFieldSchema" data-args='${JSON.stringify([typeCode])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="_resetFieldSchema" data-args='${JSON.stringify([typeCode])}'>${t('btn_reset_to_default')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);

  // Опции имеют смысл только для type=select — блокируем поле для
  // остальных типов, синхронно с чтением в _saveFieldSchema().
  document.querySelectorAll('#fs-table .fs-type').forEach(sel => {
    sel.addEventListener('change', () => {
      const optsInp = sel.closest('tr').querySelector('.fs-options');
      optsInp.disabled = sel.value !== 'select';
    });
  });
}

async function _saveFieldSchema(typeCode) {
  const rows = document.querySelectorAll('#fs-table tbody tr');
  const fields = [];
  rows.forEach(row => {
    if (!row.querySelector('.fs-included').checked) return;
    const key = row.dataset.fieldKey;
    const type = row.querySelector('.fs-type').value;
    const label = row.querySelector('.fs-label').value.trim();
    const f = { key, type, required: row.querySelector('.fs-required').checked };
    if (label) f.label = label;
    if (type === 'select') {
      f.options = row.querySelector('.fs-options').value.split(',').map(s=>s.trim()).filter(Boolean);
    }
    fields.push(f);
  });
  const r = await fetch(`${API}/api/field-schemas/${encodeURIComponent(typeCode)}`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ fields }),
  });
  const d = await r.json().catch(()=>({}));
  if (r.ok) { toast(t('msg_field_schema_saved'), 'success'); closeModal(); }
  else toast(t('msg_field_schema_error', { msg: d.error || '' }), 'error');
}

async function _resetFieldSchema(typeCode) {
  const r = await fetch(`${API}/api/field-schemas/${encodeURIComponent(typeCode)}`, { method: 'DELETE', headers: ah() });
  if (r.ok) { toast(t('msg_field_schema_reset'), 'success'); closeModal(); }
  else toast(t('msg_error'), 'error');
}

// ─── REL-6 (составные активы, Track 11): редактор «слотов компонентов» ────
// Намеренно ОТДЕЛЬНАЯ от showFieldSchemaModal модалка — слоты не привязаны
// к META_KEYS/meta_*, см. обоснование в settings.repo.js::getComponentSlots().
// target_type_codes выбираются чекбоксами из уже загруженного _typesBuffer
// (те же типы, что в общей таблице) — мягкая подсказка для UI-пикера на
// карточке актива, не проверяется на сервере при создании связи.
async function showComponentSlotsModal(typeCode) {
  let slots = [];
  try {
    const all = await fetch(`${API}/api/component-slots`, { headers: ah() }).then(r=>r.json());
    slots = all[typeCode] || [];
  } catch(e) { return toast(t('msg_error'), 'error'); }

  const otherTypes = (_typesBuffer || []).filter(ty => ty.code !== typeCode);

  const rowHtml = (slot, idx) => `
    <tr data-slot-idx="${idx}">
      <td><input class="cs-label u-text-13 u-w-100" value="${esc(slot.slot_label||'')}" placeholder="${t('cs_slot_label_placeholder')}"/></td>
      <td>
        <div class="u-flex-gap-6 u-wrap">
          ${otherTypes.map(ty => `
            <label class="u-text-11 u-flex-gap-4">
              <input type="checkbox" class="cs-target" value="${esc(ty.code)}" ${(slot.target_type_codes||[]).includes(ty.code)?'checked':''}/>
              ${esc(ty.name)}
            </label>`).join('')}
        </div>
      </td>
      <td class="u-text-center"><button class="btn-icon" data-action="_removeComponentSlotRow" data-args='${JSON.stringify([idx])}'>🗑</button></td>
    </tr>`;

  showModal(`<h2>${t('modal_component_slots_title')} ${esc(typeCode)}</h2>
    <div class="u-text-12 u-text-muted u-mb-12 u-lh-16">${t('msg_component_slots_hint')}</div>
    <div class="tbl-wrap">
      <table id="cs-table">
        <thead><tr><th>${t('lbl_slot_label')}</th><th>${t('lbl_slot_targets')}</th><th></th></tr></thead>
        <tbody>${slots.map(rowHtml).join('')}</tbody>
      </table>
    </div>
    <button class="btn btn-ghost btn-sm u-mt-8" data-action="_addComponentSlotRow">${t('btn_add_slot')}</button>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="_saveComponentSlots" data-args='${JSON.stringify([typeCode])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);

  // otherTypes нужен и в _addComponentSlotRow (новая строка тоже должна
  // получить полный набор чекбоксов) — сохраняем в module-level переменную,
  // проще, чем прокидывать через data-args на каждый клик.
  _csOtherTypesBuffer = otherTypes;
}

let _csOtherTypesBuffer = [];

function _addComponentSlotRow() {
  const tbody = document.querySelector('#cs-table tbody');
  const idx = tbody.children.length;
  const row = document.createElement('tr');
  row.dataset.slotIdx = idx;
  row.innerHTML = `
    <td><input class="cs-label u-text-13 u-w-100" placeholder="${t('cs_slot_label_placeholder')}"/></td>
    <td>
      <div class="u-flex-gap-6 u-wrap">
        ${_csOtherTypesBuffer.map(ty => `
          <label class="u-text-11 u-flex-gap-4">
            <input type="checkbox" class="cs-target" value="${esc(ty.code)}"/> ${esc(ty.name)}
          </label>`).join('')}
      </div>
    </td>
    <td class="u-text-center"><button class="btn-icon" data-action="_removeComponentSlotRow" data-args='${JSON.stringify([idx])}'>🗑</button></td>`;
  tbody.appendChild(row);
}

function _removeComponentSlotRow(idx) {
  const row = document.querySelector(`#cs-table tbody tr[data-slot-idx="${idx}"]`);
  if (row) row.remove();
}

async function _saveComponentSlots(typeCode) {
  const rows = document.querySelectorAll('#cs-table tbody tr');
  const slots = [];
  rows.forEach(row => {
    const label = row.querySelector('.cs-label').value.trim();
    if (!label) return; // пустая метка — строка пропускается, не отправляется как невалидная
    const targets = [...row.querySelectorAll('.cs-target:checked')].map(cb => cb.value);
    slots.push({ slot_label: label, target_type_codes: targets });
  });
  const r = await fetch(`${API}/api/component-slots/${encodeURIComponent(typeCode)}`, {
    method: 'PUT', headers: ah(), body: JSON.stringify({ slots }),
  });
  const d = await r.json().catch(()=>({}));
  if (r.ok) { toast(t('msg_component_slots_saved'), 'success'); closeModal(); _refDataLoaded = false; ensureRefData(); }
  else toast(t('msg_component_slots_error', { msg: d.error || '' }), 'error');
}
