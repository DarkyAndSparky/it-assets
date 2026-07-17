/**
 * public/js/views/users-admin.js
 *
 * Фаза 5, шаг 20: управление пользователями системы (вкладка в
 * настройках — логины, роли, PIN), вынесенное из public/index.html.
 * Classic script — та же причина, что и в остальных файлах (см. auth.js).
 *
 * Отдельно от employees.js: пользователи системы (логин/роль/PIN) —
 * это другой домен, нежели справочник сотрудников (для автокомплита).
 * _renderUsersPanel() вызывается из renderSettings() (пока в index.html)
 * как внешний глобал.
 */


// ─── УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ (вкладка в настройках) ────────────────────────

async function _renderUsersPanel() {
  let users = [];
  try { users = await fetch(`${API}/api/users`, {headers:ah()}).then(r=>r.json()); } catch(e){}

  const ROLE_LABEL = { admin:'Администратор', operator:'Оператор', viewer:'Просмотр' };
  const ROLE_BADGE = { admin:'s-used', operator:'s-reserve', viewer:'s-off' };

  const rows = users.map(u => `
    <tr>
      <td><b>${esc(u.name)}</b></td>
      <td><span class="badge-s ${ROLE_BADGE[u.role]||'s-off'}">${ROLE_LABEL[u.role]||u.role}</span></td>
      <td><span class="badge-s ${u.active!==false?'s-used':'s-off'}">${u.active!==false?'активен':'откл.'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn-icon" title="Изменить" data-action="showEditUserModal" data-args='${JSON.stringify([u.id, esc(u.name), u.role, esc(u.login||u.name)])}'>✏️</button>
        ${u.id!=='sys-user-admin'?`
        <button class="btn-icon" title="${u.active!==false?'Деактивировать':'Активировать'}"
          data-action="toggleUserActive" data-args='${JSON.stringify([u.id, u.active===false])}'>${u.active!==false?'🔒':'🔓'}</button>
        <button class="btn-icon" title="Удалить" data-action="deleteUser" data-args='${JSON.stringify([u.id, esc(u.name)])}'>🗑</button>
        `:''}
      </td>
    </tr>`).join('');

  return `
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div class="section-title" style="margin:0">👥 Пользователи системы</div>
        <button class="btn btn-primary btn-sm" data-action="showCreateUserModal">+ Добавить</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.6">
        Вход по логину и паролю. Оператор может редактировать оборудование, просмотрщик — только читать.
      </div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Имя</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
          <tbody>${rows||'<tr><td colspan="4" style="color:var(--muted);text-align:center">Нет пользователей</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function showCreateUserModal() {
  showModal(`<h2>👤 Новый пользователь</h2>
    <div class="form-row"><label>Имя *</label>
      <input id="cu-name" placeholder="Иванов Иван"/></div>
    <div class="form-row"><label>Логин *</label>
      <input id="cu-login" placeholder="ivanov"/></div>
    <div class="form-row"><label>Роль</label>
      <select id="cu-role">
        <option value="operator">Оператор (редактирование)</option>
        <option value="viewer">Просмотр (только чтение)</option>
        <option value="admin">Администратор</option>
      </select>
    </div>
    <div class="form-row"><label>Пароль</label>
      <input type="password" id="cu-pin" placeholder="Минимум 4 символа"/>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doCreateUser">Создать</button>
      <button class="btn btn-secondary" data-action="closeModal">Отмена</button>
    </div>`);
}

async function doCreateUser() {
  const name  = document.getElementById('cu-name')?.value.trim();
  const login = document.getElementById('cu-login')?.value.trim();
  const role  = document.getElementById('cu-role')?.value;
  const pin   = document.getElementById('cu-pin')?.value.trim();
  if (!name)  return toast('Введите имя', 'error');
  if (!login) return toast('Введите логин', 'error');
  if (!pin || pin.length < 4) return toast('Пароль — минимум 4 символа', 'error');
  const r = await fetch(`${API}/api/users`, {
    method:'POST', headers:ah(), body:JSON.stringify({name, login, role, pin})
  });
  const d = await r.json();
  if (r.ok) {
    closeModal(); toast('Пользователь создан', 'success');
    const panel = document.getElementById('settings-panel');
    if (panel) panel.innerHTML = await _renderUsersPanel();
  } else toast(d.error||'Ошибка', 'error');
}

function showEditUserModal(id, name, role, login) {
  showModal(`<h2>✏️ Изменить пользователя</h2>
    <div class="form-row"><label>Имя</label>
      <input id="eu-name" value="${esc(name)}"/></div>
    <div class="form-row"><label>Логин</label>
      <input id="eu-login" value="${esc(login||'')}"/></div>
    <div class="form-row"><label>Роль</label>
      <select id="eu-role">
        <option value="operator" ${role==='operator'?'selected':''}>Оператор</option>
        <option value="viewer"   ${role==='viewer'?'selected':''}>Просмотр</option>
        <option value="admin"    ${role==='admin'?'selected':''}>Администратор</option>
      </select>
    </div>
    <div class="form-row"><label>Новый пароль</label>
      <input type="password" id="eu-pin" placeholder="Оставьте пустым чтобы не менять"/></div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doUpdateUser" data-args='${JSON.stringify([id])}'>Сохранить</button>
      <button class="btn btn-secondary" data-action="closeModal">Отмена</button>
    </div>`);
}

async function doUpdateUser(id) {
  const name  = document.getElementById('eu-name')?.value.trim();
  const login = document.getElementById('eu-login')?.value.trim();
  const role  = document.getElementById('eu-role')?.value;
  const pin   = document.getElementById('eu-pin')?.value.trim();
  if (!login) return toast('Логин не может быть пустым', 'error');
  const body = {name, login, role};
  if (pin) { if (pin.length < 4) return toast('Пароль — минимум 4 символа', 'error'); body.pin = pin; }
  const r = await fetch(`${API}/api/users/${id}`, {
    method:'PUT', headers:ah(), body:JSON.stringify(body)
  });
  const d = await r.json();
  if (r.ok) {
    closeModal(); toast('Сохранено', 'success');
    const panel = document.getElementById('settings-panel');
    if (panel) panel.innerHTML = await _renderUsersPanel();
  } else toast(d.error||'Ошибка', 'error');
}

async function toggleUserActive(id, makeActive) {
  const r = await fetch(`${API}/api/users/${id}`, {
    method:'PUT', headers:ah(), body:JSON.stringify({active: makeActive})
  });
  if (r.ok) {
    const panel = document.getElementById('settings-panel');
    if (panel) panel.innerHTML = await _renderUsersPanel();
  } else toast('Ошибка', 'error');
}

async function deleteUser(id, name) {
  if (!confirm(`Удалить пользователя «${name}»?`)) return;
  const r = await fetch(`${API}/api/users/${id}`, {method:'DELETE', headers:ah()});
  const d = await r.json();
  if (r.ok) {
    toast('Удалено', 'success');
    const panel = document.getElementById('settings-panel');
    if (panel) panel.innerHTML = await _renderUsersPanel();
  } else toast(d.error||'Ошибка', 'error');
}
