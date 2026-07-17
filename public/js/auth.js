/**
 * public/js/auth.js
 *
 * Фаза 5, шаг 5: логин/логаут/сессия, вынесенные из public/index.html.
 * Classic script — та же причина, что и в остальных вынесенных файлах.
 *
 * ВАЖНО: этот файл ЧИТАЕТ И ПИШЕТ глобальные переменные currentUser,
 * authPassword, currentTab — они остаются объявлены в самом index.html
 * (let currentUser = null; и т.д., в начале второго <script>-блока).
 * Это безопасно для classic-скриптов: обращение к ним происходит только
 * ВНУТРИ тел функций — то есть в момент вызова (клик, fetch-колбэк),
 * а не в момент объявления функции. К этому моменту все синхронные
 * скрипты уже отработали, и currentUser/authPassword/currentTab уже
 * объявлены и проинициализированы. Порядок <script>-тегов поэтому
 * не критичен — как и с i18n.js.
 *
 * Единственный синхронный top-level вызов в этой группе — _updateAuthUI()
 * в конце основного скрипта index.html; он тоже безопасен по той же причине.
 */

function toggleAuth() {
  if (canEdit()) {
    authPassword = null;
    currentUser  = null;
    _updateAuthUI();
    toast('Вышли из системы');
    render(); return;
  }
  _showLoginModal();
}

async function _showLoginModal() {
  showModal(`<h2>🔐 Вход в систему</h2>
    <div class="form-row">
      <label>Логин</label>
      <input type="text" id="m-login" autofocus placeholder="Введите логин" autocomplete="username"/>
    </div>
    <div class="form-row">
      <label>Пароль</label>
      <input type="password" id="m-pwd" placeholder="Введите пароль" autocomplete="current-password"/>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" data-action="doLogin">Войти</button>
      <button class="btn btn-secondary" data-action="closeModal">Отмена</button>
    </div>`);
  setTimeout(()=>document.getElementById('m-login')?.focus(), 80);
}

async function doLogin() {
  try {
    const login = document.getElementById('m-login')?.value.trim() || '';
    const pwd   = document.getElementById('m-pwd')?.value || '';
    if (!login) return toast('Введите логин', 'error');

    const r = await fetch(`${API}/api/users/login`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ login, password: pwd })
    });
    const d = await r.json();
    if (r.ok) {
      currentUser  = d.user;
      authPassword = pwd;
      _updateAuthUI();
      closeModal();
      toast(`Добро пожаловать, ${currentUser.name}!`, 'success');
      render();
      // Баннер смены дефолтного пароля
      if (d.warn_default_pin) {
        setTimeout(() => _showDefaultPinWarning(), 600);
      }
    } else toast(d.error || 'Неверный логин или пароль', 'error');
  } catch(e) { toast('Ошибка соединения с сервером', 'error'); }
}

function _showDefaultPinWarning() {
  const html = `
    <div style="padding:24px;max-width:420px">
      <div style="font-size:22px;margin-bottom:12px">⚠️ Смените пароль администратора</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.7;margin-bottom:18px">
        Вы вошли под стандартным паролем <code style="background:var(--surface2);padding:2px 6px;border-radius:4px">admn0000</code>.
        Это пароль по умолчанию из документации — он известен всем в сети.<br><br>
        Смените его прямо сейчас, чтобы защитить систему.
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Новый пароль</label>
        <input id="new-pin-inp" type="password" placeholder="Минимум 4 символа"
          style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface1);color:var(--text);font-size:14px;box-sizing:border-box"/>
      </div>
      <div style="margin-bottom:18px">
        <label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Повторите пароль</label>
        <input id="new-pin-inp2" type="password" placeholder="Повторите пароль"
          style="width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--surface1);color:var(--text);font-size:14px;box-sizing:border-box"/>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" style="flex:1" data-action="doChangeDefaultPin">🔒 Сменить пароль</button>
        <button class="btn btn-ghost" data-action="closeModal" style="flex:1">Напомнить позже</button>
      </div>
    </div>`;
  showModal(html);
  setTimeout(() => document.getElementById('new-pin-inp')?.focus(), 100);
}

async function doChangeDefaultPin() {
  const p1 = document.getElementById('new-pin-inp')?.value || '';
  const p2 = document.getElementById('new-pin-inp2')?.value || '';
  if (p1.length < 4) return toast('Пароль должен быть не короче 4 символов', 'error');
  if (p1 !== p2)     return toast('Пароли не совпадают', 'error');
  try {
    const r = await fetch(`${API}/api/settings/password`, {
      method:'PUT', headers:{'Content-Type':'application/json','x-user-id':currentUser?.id,'x-edit-password':authPassword},
      body: JSON.stringify({ newPassword: p1 })
    });
    const d = await r.json();
    if (r.ok) {
      authPassword = p1;
      closeModal();
      toast('Пароль успешно изменён ✅', 'success');
    } else toast(d.error || 'Ошибка смены пароля', 'error');
  } catch(e) { toast('Ошибка соединения', 'error'); }
}

function _updateAuthUI() {
  const btn    = document.getElementById('auth-btn');
  const status = document.getElementById('auth-status');
  const authed = !!currentUser;

  // Показываем/скрываем защищённые вкладки навигации
  document.body.classList.toggle('body-auth', authed);

  if (!authed) {
    if (btn)    btn.textContent     = '🔐 Войти';
    if (status) status.textContent  = '👁 Просмотр';
    // Если были на закрытой вкладке — возвращаем на дашборд
    const protectedTabs = ['os','small','infra','history','accounts','alerts','settings'];
    if (protectedTabs.includes(currentTab)) {
      currentTab = 'dashboard';
      document.querySelectorAll('.nav-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === 'dashboard'));
    }
    return;
  }

  const roleLabel = currentUser?.role === 'admin' ? 'Администратор'
                  : currentUser?.role === 'viewer' ? 'Просмотр' : 'Оператор';
  if (btn)    btn.textContent  = '🚪 Выйти';
  if (status) status.textContent = `${currentUser.name} · ${roleLabel}`;
}

function ah() {
  const h = {'Content-Type':'application/json'};
  if (canEdit()) h['x-edit-password'] = authPassword;
  if (currentUser?.id) h['x-user-id'] = currentUser.id;
  return h;
}

// Проверка прав
function canEdit()  { return !!currentUser && currentUser?.role !== 'viewer'; }
function canAdmin() { return !!currentUser && currentUser?.role === 'admin'; }
