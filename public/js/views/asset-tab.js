/**
 * public/js/views/asset-tab.js
 *
 * Фаза 5, шаг 13: реестр активов (самый используемый экран) + редактор
 * категорий, вынесенные из public/index.html. Classic script — та же
 * причина, что и в остальных файлах (см. auth.js).
 *
 * thSort/setSort — сюда же, используются исключительно этим экраном.
 * _orgsCache/_filialsCache/_locsCache/ensureRefData() НЕ перенесены —
 * они используются ещё и в renderSettings (управление организациями/
 * филиалами/локациями), остаются общими глобалами в index.html.
 */

// ─── Фаза 6: обёртки для составных onclick/onchange реестра активов ────────────
// (были прямые присваивания глобальных фильтров + вызов renderAssetTab в одном
// inline-обработчике — data-action поддерживает только один вызов функции)

function _selectCategory(tab, val) { currentCat = val; renderAssetTab(tab); }

// this.value ПЕРВЫМ аргументом (не последним, как в стандартной конвенции) —
// wrapper читает this.value напрямую.
function _onAssetSearchInput(tab) { onSearchInput(this.value, tab); }

function _onOrgFilterChange(tab) { fOrg = this.value; fFilial = 'Все'; renderAssetTab(tab); }
function _onFilialFilterChange(tab) { fFilial = this.value; renderAssetTab(tab); }
function _onStatusFilterChange(tab) { fStatus = this.value; renderAssetTab(tab); }

function _resetAssetFilters(tab) {
  searchVal=''; fOrg='Все'; fFilial='Все'; fStatus='Все'; sortCol=''; sortDir=1;
  renderAssetTab(tab);
}

// this.checked, не this.value — отдельные обёртки для чекбоксов.
function _onSelectAllChange(tab) { toggleSelectAll(this.checked, tab); }
function _onSelectOneChange(id, tab) { toggleSelectOne(id, this.checked, tab); }

// Было data-action="_removeParentElement" — самоудаление тега категории.
function _removeParentElement() { this.parentElement.remove(); }

// this.value первым, orgsWithRules — статичный массив, вычисленный на момент
// рендера (можно сериализовать целиком в data-args).
function _onBulkInvOrgChange(orgsWithRules) { _updateInvTypeOpts(this.value, orgsWithRules); }

// Было onkeydown="if(event.key==='Enter')addTag('${tab}')"
function _onNewCatKeydown(tab, key) { if (key === 'Enter') addTag(tab); }

async function renderAssetTab(tab) {
  if (!_orgsCache.length) await ensureRefData();
  const app=document.getElementById('app');
  const cats=catsCache[tab]||[];
  const params=new URLSearchParams({tab});
  if (currentCat&&currentCat!=='Все') params.set('category',currentCat);
  if (fOrg!=='Все') params.set('org',fOrg);
  if (fFilial!=='Все') params.set('filial',fFilial);
  if (fStatus!=='Все') params.set('status',fStatus);
  if (searchVal) params.set('search',searchVal);
  app.innerHTML='<div class="spinner"></div>';
  const _resp=await fetch(`${API}/api/assets?${params}`).then(r=>r.json());
  const assets = Array.isArray(_resp) ? _resp : (_resp.items || []);
  const totalAssets = _resp.total ?? assets.length;
  const totalPages  = _resp.pages ?? 1;
  assetsCache=assets;
  document.getElementById('total-badge').textContent=totalAssets+' единиц';
  // Словарь org_id → name для отображения в таблице
  const _orgMap = Object.fromEntries((_orgsCache||[]).map(o=>[o.id, o.name]));
  // Орг — из справочника (не из отфильтрованных ассетов!) чтобы dropdown не урезался
  const _allOrgs=['Все',...(_orgsCache.length
    ? _orgsCache.filter(o=>o.status==='active'&&!o.system).map(o=>o.name)
    : [...new Set(assets.map(a=>a.org||'').filter(Boolean))]
  )].sort((a,b)=>a==='Все'?-1:b==='Все'?1:a.localeCompare(b,'ru'));
  // Филиалы — из справочника (как орги), чтобы фильтр не урезался по текущей странице
  const filials = ['Все', ...(_filialsCache.length
    ? _filialsCache.filter(f => f.status !== 'closed').map(f => f.name)
    : [...new Set(assets.map(a => a.filial).filter(Boolean))]
  )].sort((a,b) => a==='Все'?-1 : b==='Все'?1 : a.localeCompare(b,'ru'));
  // Сортировка
  if (sortCol) {
    assets.sort((a, b) => {
      const getVal = (obj, col) => {
        if (col === 'filial') return ((obj.filial||'') + ' ' + (obj.location||'')).toLowerCase();
        if (col === 'org') return (_orgMap[obj.org_id] || obj.org || '').toLowerCase();
        return (obj[col]||'').toString().toLowerCase();
      };
      const av = getVal(a, sortCol), bv = getVal(b, sortCol);
      if (sortCol === 'inv') {
        const numA = parseInt((av.match(/\d+$/) || ['0'])[0]);
        const numB = parseInt((bv.match(/\d+$/) || ['0'])[0]);
        if (!isNaN(numA) && !isNaN(numB)) return (numA - numB) * sortDir;
      }
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
  }
  const showMeta = tab==='infra';

  app.innerHTML=`
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div style="font-size:16px;font-weight:700">${TAB_LABELS[tab]||tab}
      <span style="color:var(--muted);font-weight:400;font-size:13px">(${assets.length})</span>
    </div>
    <div style="display:flex;gap:6px">
      ${canEdit()?`<button class="btn btn-secondary btn-sm" data-action="showCatEditor" data-args='${JSON.stringify([tab])}' title="Категории для группировки оборудования">📂 Категории</button>`:''}
      <a href="${API}/api/export/csv?tab=${tab}" class="btn btn-secondary btn-sm">⬇ CSV</a>
      ${canEdit()?`<button class="btn btn-primary btn-sm" data-action="showAddModal" data-args='${JSON.stringify([tab])}'>＋ Добавить</button>`:''}
    </div>
  </div>
  <div class="cat-tabs">
    ${['Все',...cats].map(c=>{const val=c==='Все'?'':c;return `<div class="cat-tab ${(currentCat||'Все')===c?'active':''}" data-action="_selectCategory" data-args='${JSON.stringify([tab, val])}'>${c}</div>`;}).join('')}
  </div>
  ${canEdit() && selectedIds.size > 0 ? `
  <div style="display:flex;align-items:center;gap:8px;padding:9px 14px;
    background:var(--accent-dim,var(--surface2));border:1px solid var(--accent);
    border-radius:10px;margin-bottom:10px;flex-wrap:wrap">
    <span style="font-size:13px;font-weight:700;color:var(--accent)">☑ Выбрано: ${selectedIds.size}</span>
    <button class="btn btn-primary btn-sm" data-action="showBulkMoveModal" data-args='${JSON.stringify([tab])}'>→ Переместить</button>
    <button class="btn btn-secondary btn-sm" data-action="showBulkInvModal" data-args='${JSON.stringify([tab])}'>🏷 Инв. №</button>
    <button class="btn btn-danger btn-sm" data-action="showBulkRetireModal" data-args='${JSON.stringify([tab])}'>🗑 Списать</button>
    <button class="btn btn-ghost btn-sm" data-action="clearSelection" data-args='${JSON.stringify([tab])}'>✕ Снять</button>
  </div>` : ''}
  <div class="card" style="margin-bottom:0">
    <div class="filters">
      <input class="search-inp" type="text" placeholder="🔍 Поиск..." value="${esc(searchVal)}"
        data-oninput-action="_onAssetSearchInput" data-oninput-args='${JSON.stringify([tab])}'/>
      <select data-onchange-action="_onOrgFilterChange" data-onchange-args='${JSON.stringify([tab])}'>
        ${_allOrgs.map(o=>`<option ${fOrg===o?'selected':''}>${esc(o)}</option>`).join('')}
      </select>
      <select data-onchange-action="_onFilialFilterChange" data-onchange-args='${JSON.stringify([tab])}'>
        ${filials.map(f=>`<option ${fFilial===f?'selected':''}>${esc(f)}</option>`).join('')}
      </select>
      <select data-onchange-action="_onStatusFilterChange" data-onchange-args='${JSON.stringify([tab])}'>
        ${['Все','используется','резерв'].map(s=>`<option ${fStatus===s?'selected':''}>${s}</option>`).join('')}
      </select>
      ${(searchVal||fOrg!=='Все'||fFilial!=='Все'||fStatus!=='Все')?
        `<button class="btn btn-ghost btn-sm" data-action="_resetAssetFilters" data-args='${JSON.stringify([tab])}'>✕ Сброс</button>`:''}
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr>
        ${canEdit()?`<th style="width:32px"><input type="checkbox" id="sel-all" title="Выбрать все / снять все"
          data-onchange-action="_onSelectAllChange" data-onchange-args='${JSON.stringify([tab])}'/></th>`:''}
        ${thSort('inv','Инв. №')}${thSort('type','Тип')}${thSort('model','Модель')}${thSort('serial','Серийный №')}
        ${showMeta?'<th>IP</th><th>MAC</th>':''}
        ${thSort('responsible','Ответственный')}${thSort('filial','Филиал / Место')}${thSort('org','Орг.')}
        <th>Коллекция</th>${thSort('status','Статус')}
        ${canEdit()?'<th></th>':''}
      </tr></thead>
      <tbody>${assets.map(a=>`
        <tr class="clickable" data-action="showDetail" data-args='${JSON.stringify([a.id])}' id="row-${a.id}">
          ${canEdit()?`<td data-action="_noop" style="width:32px;text-align:center"><input type="checkbox" class="row-cb" data-id="${a.id}" ${selectedIds.has(a.id)?'checked':''} data-onchange-action="_onSelectOneChange" data-onchange-args='${JSON.stringify([a.id, tab])}'/></td>`:''}
          <td class="mono" style="font-size:11px">${a.inv?`<span style="background:#eff6ff;color:#1d4ed8;border-radius:5px;padding:2px 6px;font-weight:600">${esc(a.inv)}</span>`:'<span style="color:#cbd5e1">—</span>'}</td>
          <td>${ic(a.type)} <span style="font-weight:500">${esc(a.type)}</span></td>
          <td><b>${esc(a.model)}</b></td>
          <td class="mono">${esc(a.serial)||'—'}</td>
          ${showMeta?`<td><span class="badge-meta">${esc(a.meta?.ip)||'—'}</span></td>
            <td class="mono" style="font-size:11px">${esc(a.meta?.mac)||'—'}</td>`:''}
          <td>${(!a.responsible||a.responsible==='?'||a.responsible==='—')
            ?'<span class="no-resp">Не назначен</span>':esc(a.responsible)}</td>
          <td><b>${esc(a.filial)}</b>${a.location?` <span style="color:var(--muted)">· ${esc(a.location)}</span>`:''}</td>
          <td style="font-size:11px;color:var(--muted);white-space:nowrap">${esc(_orgMap[a.org_id]||a.org||'—')}</td>
          <td><span class="badge-cat">${esc(a.category)}</span></td>
          <td><span class="badge-s ${sc(a.status)}">${a.status}</span></td>
          ${canEdit()?`<td data-action="_noop" style="white-space:nowrap">
            <button class="btn btn-secondary btn-sm" data-action="showMoveModal" data-args='${JSON.stringify([a.id])}'>→</button>
            <button class="btn-icon" data-action="showEditModal" data-args='${JSON.stringify([a.id])}' title="Изменить">✏️</button>
          </td>`:''}
        </tr>`).join('')}
      </tbody></table></div>

  ${renderPaginator(totalPages, totalAssets)}
  </div>`;

  // Синхронизируем состояние sel-all чекбокса
  setTimeout(() => {
    const selAll = document.getElementById('sel-all');
    if (!selAll) return;
    const cbs = document.querySelectorAll('.row-cb');
    if (cbs.length === 0) { selAll.checked = false; selAll.indeterminate = false; return; }
    const checkedCount = [...cbs].filter(cb => cb.checked).length;
    selAll.checked       = checkedCount === cbs.length;
    selAll.indeterminate = checkedCount > 0 && checkedCount < cbs.length;
  }, 0);
}

// ─── CATEGORY EDITOR ─────────────────────────────────────────────────────────
function showCatEditor(tab) {
  const cats = catsCache[tab]||[];
  showModal(`<h2>📂 Категории — ${TAB_LABELS[tab]||tab}</h2>
    <div style="font-size:13px;color:var(--muted);margin-bottom:12px">
      Категории используются для группировки оборудования на вкладке.<br>
      При удалении категории — оборудование из неё <b>не удаляется</b>, только снимается метка.
    </div>
    <div id="tag-container" class="tag-list">${cats.map(c=>`
      <div class="tag" id="tag-${btoa(c)}">
        ${esc(c)}
        <span class="del" data-action="removeTag" data-args='${JSON.stringify([tab, esc(c)])}'>×</span>
      </div>`).join('')}
    </div>
    <div style="display:flex;gap:7px;margin-top:14px">
      <input id="new-cat-inp" style="flex:1" placeholder="Новая коллекция..." 
        data-onkeydown-action="_onNewCatKeydown" data-onkeydown-args='${JSON.stringify([tab])}'/>
      <button class="btn btn-success" data-action="addTag" data-args='${JSON.stringify([tab])}'>Добавить</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="saveCats" data-args='${JSON.stringify([tab])}'>Сохранить</button>
      <button class="btn btn-secondary" data-action="closeModal">Отмена</button>
    </div>`);
}
let editingCats = [];
function removeTag(tab, name) {
  const id = 'tag-'+btoa(name);
  document.getElementById(id)?.remove();
}
function addTag(tab) {
  const inp = document.getElementById('new-cat-inp');
  const val = inp.value.trim();
  if (!val) return;
  const id = 'tag-'+btoa(val);
  if (document.getElementById(id)) { inp.value=''; return; }
  const div = document.createElement('div');
  div.className='tag'; div.id=id;
  div.innerHTML=`${esc(val)} <span class="del" data-action="_removeParentElement">×</span>`;
  document.getElementById('tag-container').appendChild(div);
  inp.value='';
}
async function saveCats(tab) {
  const tags = [...document.querySelectorAll('#tag-container .tag')]
    .map(t=>t.childNodes[0].textContent.trim()).filter(Boolean);
  const r = await fetch(`${API}/api/categories/${tab}`,{method:'PUT',headers:ah(),body:JSON.stringify({categories:tags})});
  if (r.ok) {
    catsCache[tab] = tags;
    closeModal(); toast('Коллекции сохранены','success'); render();
  } else toast('Ошибка','error');
}

function thSort(col, label) {
  const active = sortCol === col;
  const arrow  = active ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
  const style  = active
    ? 'cursor:pointer;user-select:none;color:var(--indigo);white-space:nowrap'
    : 'cursor:pointer;user-select:none;white-space:nowrap';
  return `<th style="${style}" data-action="setSort" data-args='${JSON.stringify([col])}'>${label}${arrow}</th>`;
}

function setSort(col) {
  if (sortCol === col) sortDir *= -1;
  else { sortCol = col; sortDir = 1; }
  currentPage = 1;
  renderAssetTab(currentTab);
}

// ─── Массовые операции + пагинация реестра (шаг 15) ─────────────────────────
function toggleSelectOne(id, checked, tab) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  const selAll = document.getElementById('sel-all');
  if (selAll) {
    const cbs = document.querySelectorAll('.row-cb');
    selAll.checked = cbs.length > 0 && [...cbs].every(cb => cb.checked);
  }
  renderAssetTab(tab);
}

function toggleSelectAll(checked, tab) {
  document.querySelectorAll('.row-cb').forEach(cb => {
    if (checked) selectedIds.add(cb.dataset.id);
    else selectedIds.delete(cb.dataset.id);
  });
  renderAssetTab(tab).then(() => {
    const selAll = document.getElementById('sel-all');
    if (selAll) selAll.checked = checked && selectedIds.size > 0;
  });
}

function clearSelection(tab) {
  selectedIds.clear();
  renderAssetTab(tab);
}


function renderPaginator(totalPages, totalAssets) {
  if (totalPages <= 1) return '';
  const from = (currentPage - 1) * PAGE_SIZE + 1;
  const to   = Math.min(currentPage * PAGE_SIZE, totalAssets);
  let btns = '';
  const prevDis = currentPage <= 1 ? ' disabled' : '';
  const nextDis = currentPage >= totalPages ? ' disabled' : '';
  btns += `<button class="btn btn-ghost btn-sm"${prevDis} data-action="gotoPage" data-args='${JSON.stringify([currentPage-1])}'>← Пред</button>`;
  let lastWasDots = false;
  for (let p = 1; p <= totalPages; p++) {
    const near = Math.abs(p - currentPage) <= 2 || p === 1 || p === totalPages;
    if (near) {
      const cls = p === currentPage ? 'btn-primary' : 'btn-ghost';
      btns += `<button class="btn btn-sm ${cls}" data-action="gotoPage" data-args='${JSON.stringify([p])}'>${p}</button>`;
      lastWasDots = false;
    } else if (Math.abs(p - currentPage) === 3 && !lastWasDots) {
      btns += '<span style="color:var(--muted);padding:0 4px">…</span>';
      lastWasDots = true;
    }
  }
  btns += `<button class="btn btn-ghost btn-sm"${nextDis} data-action="gotoPage" data-args='${JSON.stringify([currentPage+1])}'>След →</button>`;
  btns += `<span style="font-size:12px;color:var(--muted);margin-left:8px">${from}–${to} из ${totalAssets}</span>`;
  return `<div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:14px;flex-wrap:wrap">${btns}</div>`;
}

function gotoPage(page) {
  currentPage = Math.max(1, page);
  renderAssetTab(currentTab);
}

// ─── Bulk-модалки (присвоить инв.№, списать, переместить) — шаг 16 ─────────
async function showBulkInvModal(tab) {
  if (!selectedIds.size) return toast('Ничего не выбрано', 'error');

  // Загружаем организации с правилами инв. номеров
  let orgsWithRules = [];
  try {
    const orgs = await fetch(`${API}/api/orgs`).then(r=>r.json());
    orgsWithRules = orgs.filter(o => o.inv_rules && o.inv_rules.filter(r=>r.active!==false).length > 0);
  } catch(e) {}

  if (!orgsWithRules.length) {
    return toast('Нет организаций с настроенными правилами инв. номеров', 'error');
  }

  // Собираем список выбранных ассетов (из DOM)
  const selectedArr = [...selectedIds];

  const orgOpts = orgsWithRules.map(o =>
    `<option value="${o.id}">${esc(o.name)} (${o.short_code})</option>`
  ).join('');

  showModal(`<h2>🏷 Присвоить инв. номера</h2>
    <div style="background:var(--surface2);border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px;border:1px solid var(--border)">
      Выбрано устройств: <b>${selectedArr.length}</b><br>
      <span style="font-size:11px;color:var(--muted)">Устройствам с уже присвоенным номером номер не переназначается.</span>
    </div>
    <div class="form-row"><label>Организация</label>
      <select id="bi-org" data-onchange-action="_onBulkInvOrgChange" data-onchange-args='${JSON.stringify([orgsWithRules])}'>
        ${orgOpts}
      </select>
    </div>
    <div class="form-row"><label>Тип устройства (правило)</label>
      <select id="bi-type"></select>
    </div>
    <div id="bi-preview" style="font-size:12px;color:var(--muted);margin-bottom:8px"></div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">
      ⚠ Номера присваиваются только устройствам <b>без инв. номера</b> в выборке.
      Номера резервируются последовательно согласно счётчику организации.
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doBulkAssignInv" data-args='${JSON.stringify([tab])}'>Присвоить</button>
      <button class="btn btn-secondary" data-action="closeModal">Отмена</button>
    </div>`);

  // Инициализируем типы для первой организации
  if (orgsWithRules[0]) _updateInvTypeOpts(orgsWithRules[0].id, orgsWithRules);
}

function _updateInvTypeOpts(orgId, orgs) {
  const org = orgs.find(o => o.id === orgId);
  const sel = document.getElementById('bi-type');
  if (!sel || !org) return;
  const rules = (org.inv_rules||[]).filter(r => r.active !== false);
  sel.innerHTML = rules.map(r =>
    `<option value="${r.type_code}">${r.type_name || r.type_code} → ${org.short_code}-${r.type_code}-XXXXX</option>`
  ).join('');
  _updateInvPreview(org);
}

function _updateInvPreview(org) {
  const preview = document.getElementById('bi-preview');
  if (!preview) return;
  const tc = document.getElementById('bi-type')?.value;
  if (!tc || !org) return;
  const rule = (org.inv_rules||[]).find(r=>r.type_code===tc);
  const next = (rule?.counter||0) + 1;
  preview.textContent = `Следующий номер: ${org.short_code}-${tc}-${String(next).padStart(5,'0')}`;
}

async function doBulkAssignInv(tab) {
  const orgId   = document.getElementById('bi-org')?.value;
  const typeCode = document.getElementById('bi-type')?.value;
  if (!orgId || !typeCode) return toast('Выберите организацию и тип', 'error');

  const ids = [...selectedIds];
  const r = await fetch(`${API}/api/assets/bulk-assign-inv`, {
    method: 'POST', headers: ah(),
    body: JSON.stringify({ ids, org_id: orgId, type_code: typeCode })
  });
  const d = await r.json();
  if (r.ok) {
    closeModal();
    toast(`Присвоено: ${d.assigned}, пропущено (уже есть): ${d.skipped}`, 'success');
    selectedIds.clear();
    renderAssetTab(tab);
  } else toast(d.error || 'Ошибка', 'error');
}

function showBulkRetireModal(tab) {
  if (!selectedIds.size) return toast('Ничего не выбрано', 'error');
  showModal(`<h2>🗑 Массовое списание</h2>
    <div style="background:var(--danger-bg);border:1px solid var(--danger-border);border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px;color:var(--danger-text)">
      Будет списано: <b>${selectedIds.size}</b> единиц оборудования.<br>
      Это действие необратимо — оборудование помечается как списанное.
    </div>
    <div class="form-row"><label>Причина списания</label>
      <input id="br-reason" placeholder="Моральный износ, поломка..." autofocus/></div>
    <div class="modal-actions">
      <button class="btn btn-danger" data-action="doBulkRetire" data-args='${JSON.stringify([tab])}'>Списать ${selectedIds.size} ед.</button>
      <button class="btn btn-secondary" data-action="closeModal">Отмена</button>
    </div>`);
}

async function doBulkRetire(tab) {
  const reason = document.getElementById('br-reason')?.value.trim() || 'Массовое списание';
  const ids = [...selectedIds];
  closeModal();
  let ok = 0, fail = 0;
  for (const id of ids) {
    const r = await fetch(`${API}/api/assets/${id}`, {
      method: 'DELETE',
      headers: { ...ah(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    if (r.ok) ok++; else fail++;
  }
  selectedIds.clear();
  if (ok)   toast(`Списано: ${ok} ед.`, 'success');
  if (fail) toast(`Ошибок: ${fail}`, 'error');
  renderAssetTab(tab);
}

function showBulkMoveModal(tab) {
  if (!selectedIds.size) return toast('Ничего не выбрано', 'error');
  const filOpts = _filialsCache.map(f=>`<option value="${f.name}">${esc(f.name)}</option>`).join('');
  const locOpts = _locsCache.map(l=>`<option value="${l.name}">${esc(l.name)}</option>`).join('');
  showModal(`<h2>→ Массовое перемещение</h2>
    <div style="background:#eff6ff;border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px">
      Ассетов: <b>${selectedIds.size}</b> &nbsp;·&nbsp;
      <span style="font-size:12px;color:var(--muted)">Пустое поле не изменится</span>
    </div>
    <div class="form-row"><label>Ответственный</label>
      <input id="bm-resp" placeholder="Иванов Иван Иванович"/></div>
    <div class="form-row"><label>Филиал</label>
      <select id="bm-filial"><option value="">— не менять —</option>${filOpts}</select></div>
    <div class="form-row"><label>Расположение</label>
      <select id="bm-loc"><option value="">— не менять —</option>${locOpts}</select></div>
    <div class="form-row"><label>Причина</label>
      <input id="bm-reason" placeholder="Причина перемещения"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doBulkMove" data-args='${JSON.stringify([tab])}'>Переместить</button>
      <button class="btn btn-secondary" data-action="closeModal">Отмена</button>
    </div>`);
}

async function doBulkMove(tab) {
  const newResponsible = document.getElementById('bm-resp')?.value.trim();
  const newFilial      = document.getElementById('bm-filial')?.value;
  const newLocation    = document.getElementById('bm-loc')?.value;
  const reason         = document.getElementById('bm-reason')?.value.trim();
  if (!newResponsible && !newFilial && !newLocation)
    return toast('Заполните хотя бы одно поле', 'error');
  const r = await fetch(`${API}/api/assets/bulk-move`, {
    method:'POST', headers:ah(),
    body:JSON.stringify({ ids:[...selectedIds], newResponsible, newFilial, newLocation, reason })
  });
  const d = await r.json();
  if (r.ok) {
    closeModal();
    toast(`Перемещено: ${d.ok}${d.failed?.length?' | Ошибок: '+d.failed.length:''}`, 'success');
    selectedIds.clear();
    renderAssetTab(tab);
  } else toast(d.error||'Ошибка', 'error');
}
