/**
 * public/js/router.js
 *
 * Фаза 5, шаг 9: диспетчер вкладок (switchTab, render), вынесенный из
 * public/index.html. Classic script — та же причина, что и в остальных
 * файлах (см. auth.js).
 *
 * ВАЖНО: сами реализации renderDashboard/renderHistory/renderAccounts/
 * renderAlerts/renderSettings/renderAssetTab пока ОСТАЮТСЯ в index.html —
 * это весь view-слой приложения, отдельная большая задача. render() их
 * просто вызывает по имени, что безопасно для classic-скриптов: имя
 * резолвится в момент ВЫЗОВА (когда пользователь кликнул вкладку), а не
 * в момент объявления функции — к этому моменту все синхронные скрипты
 * уже отработали и renderXxx уже определены, независимо от того, в каком
 * файле они физически лежат.
 *
 * Единственный синхронный top-level вызов в этой группе — render() в самом
 * конце index.html; он тоже безопасен по той же причине (router.js
 * подключается раньше и уже определил render() к этому моменту).
 */

function switchTab(tab) {
  const _protected = ['os','small','infra','history','accounts','alerts','settings'];
  if (_protected.includes(tab) && !currentUser) {
    toast(t('msg_login_required'), 'error');
    return;
  }
  currentTab=tab; currentCat=''; searchVal=''; fOrg='Все'; fFilial='Все'; fStatus='Все'; sortCol=''; sortDir=1;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  render();
}
async function render() {
  // Загружаем название компании и версию
  try {
    const s = await fetch(`${API}/api/settings`).then(r=>r.json());
    if (s.company_name) {
      _updateLogoEl(s.company_name, s.logo_svg || '');
    }
    if (s.version) {
      const v = s.version
        .replace(/^alpha-(\d+)-/, 'α$1 · ')
        .replace(/^beta-(\d+)-/,  'β$1 · ')
        .replace(/-/g,'·');
      _appVersion = v;
      const verEl = document.getElementById('app-version');
      if (verEl) verEl.textContent = v;
      const verEl2 = document.getElementById('app-version-detail');
      if (verEl2) verEl2.textContent = v;
    }
  } catch(e) {}
  try {
    // requireLogin на /api/categories и /api/inv/codes (INFRA-7) — а
    // render() вызывается один раз безусловно при загрузке страницы
    // (bootstrap.js), ДО какого-либо логина. Раньше здесь стоял просто
    // `if (!catsCache.os)`: этот самый первый вызов улетал неавторизованным
    // (currentUser ещё null), получал 401 на оба запроса, но .catch()
    // всё равно резолвил catsCache/invCodes дефолтными значениями — и
    // флаг catsCache.os становился truthy НАВСЕГДА, так что после
    // реального логина повторного запроса с нормальной авторизацией уже
    // не происходило (кэш "успешно" стоял, просто на дефолтах). Добавили
    // `&& currentUser` — без логина не дёргаем вообще, а `catsCache = {}`
    // при успешном логине (см. auth.js) заставляет самый первый
    // пост-логинный render() запросить их по-настоящему.
    if (!catsCache.os && currentUser) {
      [catsCache, invCodes] = await Promise.all([
        fetch(`${API}/api/categories`, { headers: ah() }).then(r=>r.json()).catch(()=>({os:['Оборудование пользователей','Оргтехника','Мини ПК'],small:['Периферия','Гарнитуры','Колонки'],infra:['Сетевое оборудование','Wi-Fi','Принтеры','Видеонаблюдение','ИБП','Серверы']})),
        fetch(`${API}/api/inv/codes`, { headers: ah() }).then(r=>r.json()).catch(()=>({orgs:{},types:{}}))
      ]);
    }
    if (currentTab==='dashboard') return await renderDashboard();
    if (currentTab==='history')   return await renderHistory();
    if (currentTab==='accounts')  return await renderAccounts();
    if (currentTab==='alerts')    return await renderAlerts();
    if (currentTab==='settings')  return await renderSettings();
    await renderAssetTab(currentTab);
  } catch(e) {
    console.error('render() error:', e);
    document.getElementById('app').innerHTML = `<div class="card u-max-w-500">
      <div class="error-title u-mb-8">❌ Ошибка отображения</div>
      <div class="u-text-13 u-text-muted u-mb-8">${esc(String(e.message||e))}</div>
      <button class="btn btn-primary" data-action="render">🔄 Обновить</button>
    </div>`;
  }
}
