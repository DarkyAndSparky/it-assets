/**
 * public/js/views/accounts.js
 *
 * Фаза 5, шаг 12: экран "Учётные записи" целиком (не только render,
 * но и CRUD-модалки — это одна цельная фича), вынесенный из
 * public/index.html. Classic script — та же причина, что и в остальных
 * файлах (см. auth.js).
 */

const ACC_CATEGORIES = ['Сетевое оборудование','Принтеры','Планшеты / Телефоны','Серверы / NAS','Облачные сервисы','Прочее'];

// Фаза 6: было onclick="if(this.classList.contains('revealed')){...}else{...}" —
// самомодифицирующий переключатель показа пароля, выношу в именованную функцию.
function _togglePasswordReveal() {
  if (this.classList.contains('revealed')) {
    this.textContent = '••••••';
    this.classList.remove('revealed');
  } else {
    this.textContent = this.dataset.v;
    this.classList.add('revealed');
  }
}

async function renderAccounts() {
  const app=document.getElementById('app');
  if (!canEdit()) {
    app.innerHTML=`<div class="card u-max-w-400 u-text-center u-p-40">
      <div class="u-text-40 u-mb-14">🔑</div>
      <div class="u-fw-700 u-text-16 u-mb-8">${t('section_protected')}</div>
      <div class="u-text-muted u-mb-18 u-text-14">${t('msg_login_to_edit')}</div>
      <button class="btn btn-primary" data-action="toggleAuth">${t('btn_login')}</button></div>`;
    return;
  }
  app.innerHTML='<div class="spinner"></div>';
  // r.ok проверяем ДО парсинга — иначе тело ошибки (429/500 и т.п.) успешно
  // парсится как JSON, но это не массив, и .forEach() ниже падает с
  // невнятным TypeError вместо понятного сообщения об ошибке загрузки.
  let accs;
  try {
    const r = await fetch(`${API}/api/accounts`,{headers:ah()});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    accs = await r.json();
  } catch(e) {
    app.innerHTML = `<div class="card u-text-center u-p-40 u-text-muted">${t('msg_load_error', { msg: e.message })}</div>`;
    return;
  }

  // Группируем по category
  const groups = {};
  accs.forEach(a => {
    const cat = a.category || 'Прочее';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(a);
  });

  const catOrder = [...ACC_CATEGORIES, ...Object.keys(groups).filter(k => !ACC_CATEGORIES.includes(k))];
  const sortedGroups = catOrder.filter(c => groups[c]);

  const catIcons = {
    'Сетевое оборудование':'🌐','Принтеры':'🖨','Планшеты / Телефоны':'📱',
    'Серверы / NAS':'🖥','Облачные сервисы':'☁️','Прочее':'🔑'
  };

  app.innerHTML=`
    <div class="u-flex-between u-mb-12">
      <div class="u-text-16 u-fw-700">${t('modal_accounts_title', { n: accs.length })}</div>
      <button class="btn btn-primary btn-sm" data-action="showAddAccount">${t('btn_add')}</button>
    </div>
    <div class="acc-info-box u-text-muted u-flex-start">
      <span class="u-text-16 u-shrink-0">ℹ️</span>
      <div>
        ${t('msg_accounts_info')}
      </div>
    </div>
    ${sortedGroups.map(cat => `
    <div class="card u-mb-14 u-p-0 u-overflow-hidden">
      <div class="acc-cat-header">
        <span class="u-text-16">${catIcons[cat]||'🔑'}</span>
        <span class="u-fw-700 u-text-14">${esc(cat)}</span>
        <span class="u-text-muted u-text-12">(${groups[cat].length})</span>
      </div>
      <div class="tbl-wrap"><table>
        <thead><tr><th>${t('field_name')}</th><th>${t('field_login')}</th><th>${t('field_password')}</th><th>${t('field_note')}</th><th></th></tr></thead>
        <tbody>${groups[cat].map(a=>`<tr>
          <td><b>${esc(a.name)}</b></td>
          <td class="mono">
            ${a.login ? `<span class="u-inline-flex-gap-4">
              ${esc(a.login)}
              <button class="btn-icon u-text-11 u-p-1-4" title="${t('tooltip_copy_login')}"
                data-action="copyToClipboard" data-args='${JSON.stringify([a.login, t('msg_login_copied')])}'>⎘</button>
            </span>` : (a.has_login ? `<span title="${t('tooltip_no_access')}" class="u-text-muted">🔒</span>` : '—')}
          </td>
          <td>
            <span class="u-inline-flex-gap-4">
              ${a.password !== undefined ? `
              <span class="pw-mask mono" title="${t('tooltip_click_to_reveal')}"
                data-action="_togglePasswordReveal"
                data-v="${esc(a.password)}">${a.password?'••••••':'—'}</span>
              ${a.password ? `<button class="btn-icon u-text-11 u-p-1-4" title="${t('tooltip_copy_password')}"
                data-action="copyToClipboard" data-args='${JSON.stringify([a.password, t('msg_password_copied')])}'>⎘</button>` : ''}
              ` : (a.has_password ? `<span title="${t('tooltip_no_access')}" class="u-text-muted">🔒</span>` : '—')}
            </span>
          </td>
          <td class="u-text-muted u-text-12">${esc(a.note)}</td>
          <td class="u-nowrap">
            <button class="btn-icon" data-action="showEditAccount" data-args='${JSON.stringify([a.id, esc(a.name), esc(a.login||""), esc(a.password!==undefined?a.password:""), esc(a.note), esc(a.category||""), a.password===undefined])}' title="${t('btn_edit')}">✏️</button>
            <button class="btn-icon" data-action="deleteAccount" data-args='${JSON.stringify([a.id])}' title="${t('btn_delete')}">🗑</button>
          </td></tr>`).join('')}
        </tbody></table></div>
    </div>`).join('')}`;
}

function _accCategorySelect(selected='') {
  return `<select id="ac-cat" class="u-w-100">
    <option value="">${t('opt_select_type')}</option>
    ${ACC_CATEGORIES.map(c=>`<option value="${c}" ${selected===c?'selected':''}>${c}</option>`).join('')}
  </select>`;
}

function showAddAccount() {
  showModal(`<h2>${t('modal_add_account_title')}</h2>
    <div class="form-row"><label>${t('field_type_required')}</label>${_accCategorySelect()}</div>
    <div class="form-row"><label>${t('field_name_required')}</label><input id="ac-name" placeholder="${t('msg_account_name_placeholder')}"/></div>
    <div class="two-col">
      <div class="form-row"><label>${t('field_login')}</label><input id="ac-login"/></div>
      <div class="form-row"><label>${t('field_password')}</label><input id="ac-pwd" type="text"/></div>
    </div>
    <div class="form-row"><label>${t('field_note')}</label><input id="ac-note" placeholder="${t('msg_account_note_placeholder')}"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doAddAccount">${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doAddAccount() {
  const data={
    category:document.getElementById('ac-cat').value.trim(),
    name:document.getElementById('ac-name').value.trim(),
    login:document.getElementById('ac-login').value.trim(),
    password:document.getElementById('ac-pwd').value.trim(),
    note:document.getElementById('ac-note').value.trim()
  };
  if (!data.category) return toast(t('msg_select_type'),'error');
  if (!data.name) return toast(t('msg_enter_name'),'error');
  const r=await fetch(`${API}/api/accounts`,{method:'POST',headers:ah(),body:JSON.stringify(data)});
  if (r.ok){closeModal();toast(t('msg_added'),'success');renderAccounts();}
  else toast(t('msg_error'),'error');
}
function showEditAccount(id,name,login,pwd,note,category,noAccess) {
  showModal(`<h2>${t('modal_edit_account_title')}</h2>
    <div class="form-row"><label>${t('field_type')}</label>${_accCategorySelect(category)}</div>
    <div class="form-row"><label>${t('field_name')}</label><input id="ae-name" value="${name}"/></div>
    <div class="two-col">
      <div class="form-row"><label>${t('field_login')}</label><input id="ae-login" value="${login}" ${noAccess?`disabled placeholder="${t('msg_no_access_placeholder')}"`:''}/></div>
      <div class="form-row"><label>${t('field_password')}</label><input id="ae-pwd" type="text" value="${pwd}" ${noAccess?`disabled placeholder="${t('msg_no_access_placeholder')}"`:''}/></div>
    </div>
    ${noAccess ? `<div class="u-text-11 u-text-muted u-neg-mt-6">${t('msg_no_access_note')}</div>` : ''}
    <div class="form-row"><label>${t('field_note')}</label><input id="ae-note" value="${note}"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doEditAccount" data-args='${JSON.stringify([id])}'>${t('btn_save')}</button>
      <button class="btn btn-secondary" data-action="closeModal">${t('btn_cancel')}</button>
    </div>`);
}
async function doEditAccount(id) {
  const data={
    category:document.getElementById('ac-cat').value.trim(),
    name:document.getElementById('ae-name').value.trim(),
    login:document.getElementById('ae-login').value.trim(),
    password:document.getElementById('ae-pwd').value.trim(),
    note:document.getElementById('ae-note').value.trim()
  };
  const r=await fetch(`${API}/api/accounts/${id}`,{method:'PUT',headers:ah(),body:JSON.stringify(data)});
  if (r.ok){closeModal();toast(t('msg_saved'),'success');renderAccounts();}
  else toast(t('msg_error'),'error');
}
async function deleteAccount(id) {
  if (!confirm(t('msg_confirm_delete_account'))) return;
  const r = await fetch(`${API}/api/accounts/${id}`,{method:'DELETE',headers:ah()});
  if (r.ok) { toast(t('msg_deleted')); renderAccounts(); }
  else toast(t('msg_delete_error'),'error');
}
