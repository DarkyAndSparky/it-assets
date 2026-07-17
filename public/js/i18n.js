/**
 * public/js/i18n.js
 *
 * Фаза 5, шаг 4: переключатель языка (RU/EN), вынесенный из
 * public/index.html. Classic script — та же причина, что и в
 * ui-utils.js/qr.js/theme.js.
 *
 * applyLang()/t() трогают только DOM ([data-i18n], .nav-btn, auth-btn) и
 * localStorage — никакой завязки на render()/состояние приложения, так что
 * порядок подключения не критичен (в отличие от theme.js).
 *
 * Примечание: концовка файла — IIFE, которая пытается найти #lang-toggle
 * и выставить его текст. В момент выполнения (скрипт всё ещё в <head>,
 * <body> ещё не распарсен) элемента не существует — это унаследованное
 * поведение из исходного index.html, ничего не "чиню", просто переношу
 * как есть.
 */

const I18N = {
  ru: {
    // Nav
    nav_dashboard: '📊 Дашборд',
    nav_os: '💻 ОС',
    nav_small: '🖱 Мелочи',
    nav_infra: '🌐 Инфра',
    nav_history: '🔄 История',
    nav_accounts: '🔑 Учётки',
    nav_alerts: '⚠️ Внимание',
    nav_settings: '⚙️ Настройки',
    // Header
    lang_title: 'Переключить язык',
    // Auth
    btn_login: '🔐 Войти',
    btn_logout: '🚪 Выйти',
    lbl_viewer: '👁 Просмотр',
    lbl_operator: '🔧 Оператор',
    lbl_admin: '👑 Администратор',
    // Buttons
    btn_add: '+ Добавить',
    btn_save: 'Сохранить',
    btn_cancel: 'Отмена',
    btn_delete: 'Удалить',
    btn_edit: 'Редактировать',
    btn_close: 'Закрыть',
    btn_export_csv: '↓ CSV',
    btn_categories: '☰ Категории',
    btn_move: 'Переместить',
    btn_retire: 'Списать',
    btn_qr: 'QR-код',
    btn_print: 'Печать',
    btn_restore: 'Восстановить',
    btn_backup: 'Создать бэкап',
    btn_import: 'Импортировать',
    btn_apply: 'Применить',
    btn_select_all: 'Выбрать все',
    btn_deselect: 'Снять выбор',
    btn_bulk_move: 'Переместить выбранные',
    btn_bulk_inv: 'Присвоить инв. номера',
    // Table headers
    th_inv: 'ИНВ. №',
    th_type: 'ТИП',
    th_model: 'МОДЕЛЬ',
    th_serial: 'СЕРИЙНЫЙ №',
    th_responsible: 'ОТВЕТСТВЕННЫЙ',
    th_filial_loc: 'ФИЛИАЛ / МЕСТО',
    th_org: 'ОРГ.',
    th_collection: 'КОЛЛЕКЦИЯ',
    th_status: 'СТАТУС',
    th_actions: 'ДЕЙСТВИЯ',
    th_date: 'ДАТА',
    th_event: 'СОБЫТИЕ',
    th_user: 'ПОЛЬЗОВАТЕЛЬ',
    th_name: 'НАЗВАНИЕ',
    th_role: 'РОЛЬ',
    th_login: 'ЛОГИН',
    // Status labels
    status_in_use: 'В использовании',
    status_reserve: 'В резерве',
    status_repair: 'В ремонте',
    status_retired: 'Списано',
    status_storage: 'На хранении',
    // Tabs
    tab_all: 'Все',
    tab_os: 'ОС',
    tab_small: 'Мелочи',
    tab_infra: 'Инфра',
    // Fields
    field_model: 'Модель',
    field_type: 'Тип',
    field_serial: 'Серийный №',
    field_inv: 'Инв. №',
    field_org: 'Организация',
    field_filial: 'Филиал',
    field_location: 'Расположение',
    field_responsible: 'Ответственный',
    field_status: 'Статус',
    field_note: 'Примечание',
    field_mac: 'MAC-адрес',
    field_ip: 'IP-адрес',
    field_hostname: 'Hostname',
    field_firmware: 'Прошивка',
    field_collection: 'Коллекция',
    field_name: 'Имя',
    field_login: 'Логин',
    field_role: 'Роль',
    field_pin: 'PIN',
    field_email: 'Email',
    field_phone: 'Телефон',
    field_position: 'Должность',
    // Dashboard
    dash_total: 'Всего единиц',
    dash_in_use: 'В использовании',
    dash_reserve: 'В резерве',
    dash_repair: 'В ремонте',
    dash_retired: 'Списано',
    // Messages
    msg_no_data: 'Нет данных',
    msg_loading: 'Загрузка...',
    msg_saved: 'Сохранено',
    msg_deleted: 'Удалено',
    msg_error: 'Ошибка',
    msg_confirm_delete: 'Удалить?',
    msg_confirm_retire: 'Списать оборудование?',
    msg_search: 'Поиск...',
    msg_all: 'Все',
    msg_not_assigned: 'Не назначен',
    // Settings sections
    set_users: 'Пользователи',
    set_orgs: 'Организации',
    set_filials: 'Филиалы',
    set_locations: 'Расположения',
    set_employees: 'Сотрудники',
    set_backup: 'Резервные копии',
    set_import: 'Импорт CSV',
    set_appearance: 'Внешний вид',
    set_categories: 'Категории',
    // History events
    hist_created: 'Создан',
    hist_moved: 'Перемещён',
    hist_retired: 'Списан',
    hist_updated: 'Обновлён',
    hist_inv_assigned: 'Присвоен инв. №',
    hist_status_changed: 'Изменён статус',
    hist_restored: 'Восстановлен из бэкапа',
  },
  en: {
    // Nav
    nav_dashboard: '📊 Dashboard',
    nav_os: '💻 Devices',
    nav_small: '🖱 Peripherals',
    nav_infra: '🌐 Network',
    nav_history: '🔄 History',
    nav_accounts: '🔑 Accounts',
    nav_alerts: '⚠️ Alerts',
    nav_settings: '⚙️ Settings',
    // Header
    lang_title: 'Switch language',
    // Auth
    btn_login: '🔐 Sign In',
    btn_logout: '🚪 Sign Out',
    lbl_viewer: '👁 Viewer',
    lbl_operator: '🔧 Operator',
    lbl_admin: '👑 Administrator',
    // Buttons
    btn_add: '+ Add',
    btn_save: 'Save',
    btn_cancel: 'Cancel',
    btn_delete: 'Delete',
    btn_edit: 'Edit',
    btn_close: 'Close',
    btn_export_csv: '↓ CSV',
    btn_categories: '☰ Categories',
    btn_move: 'Move',
    btn_retire: 'Retire',
    btn_qr: 'QR Code',
    btn_print: 'Print',
    btn_restore: 'Restore',
    btn_backup: 'Create Backup',
    btn_import: 'Import',
    btn_apply: 'Apply',
    btn_select_all: 'Select All',
    btn_deselect: 'Deselect',
    btn_bulk_move: 'Move Selected',
    btn_bulk_inv: 'Assign Inv. Numbers',
    // Table headers
    th_inv: 'INV. #',
    th_type: 'TYPE',
    th_model: 'MODEL',
    th_serial: 'SERIAL #',
    th_responsible: 'RESPONSIBLE',
    th_filial_loc: 'BRANCH / LOCATION',
    th_org: 'ORG.',
    th_collection: 'COLLECTION',
    th_status: 'STATUS',
    th_actions: 'ACTIONS',
    th_date: 'DATE',
    th_event: 'EVENT',
    th_user: 'USER',
    th_name: 'NAME',
    th_role: 'ROLE',
    th_login: 'LOGIN',
    // Status labels
    status_in_use: 'In Use',
    status_reserve: 'In Reserve',
    status_repair: 'In Repair',
    status_retired: 'Retired',
    status_storage: 'In Storage',
    // Tabs
    tab_all: 'All',
    tab_os: 'Devices',
    tab_small: 'Peripherals',
    tab_infra: 'Network',
    // Fields
    field_model: 'Model',
    field_type: 'Type',
    field_serial: 'Serial #',
    field_inv: 'Inv. #',
    field_org: 'Organization',
    field_filial: 'Branch',
    field_location: 'Location',
    field_responsible: 'Responsible',
    field_status: 'Status',
    field_note: 'Note',
    field_mac: 'MAC Address',
    field_ip: 'IP Address',
    field_hostname: 'Hostname',
    field_firmware: 'Firmware',
    field_collection: 'Collection',
    field_name: 'Name',
    field_login: 'Login',
    field_role: 'Role',
    field_pin: 'PIN',
    field_email: 'Email',
    field_phone: 'Phone',
    field_position: 'Position',
    // Dashboard
    dash_total: 'Total Units',
    dash_in_use: 'In Use',
    dash_reserve: 'In Reserve',
    dash_repair: 'In Repair',
    dash_retired: 'Retired',
    // Messages
    msg_no_data: 'No data',
    msg_loading: 'Loading...',
    msg_saved: 'Saved',
    msg_deleted: 'Deleted',
    msg_error: 'Error',
    msg_confirm_delete: 'Delete?',
    msg_confirm_retire: 'Retire this asset?',
    msg_search: 'Search...',
    msg_all: 'All',
    msg_not_assigned: 'Not assigned',
    // Settings sections
    set_users: 'Users',
    set_orgs: 'Organizations',
    set_filials: 'Branches',
    set_locations: 'Locations',
    set_employees: 'Employees',
    set_backup: 'Backups',
    set_import: 'Import CSV',
    set_appearance: 'Appearance',
    set_categories: 'Categories',
    // History events
    hist_created: 'Created',
    hist_moved: 'Moved',
    hist_retired: 'Retired',
    hist_updated: 'Updated',
    hist_inv_assigned: 'Inv. # Assigned',
    hist_status_changed: 'Status Changed',
    hist_restored: 'Restored from Backup',
  }
};

let _lang = localStorage.getItem('itassets_lang') || 'ru';

function t(key) {
  return (I18N[_lang] && I18N[_lang][key]) || (I18N['ru'] && I18N['ru'][key]) || key;
}

function toggleLang() {
  _lang = _lang === 'ru' ? 'en' : 'ru';
  localStorage.setItem('itassets_lang', _lang);
  applyLang();
}

function applyLang() {
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = _lang === 'ru' ? 'EN' : 'RU';
  document.documentElement.setAttribute('lang', _lang);

  // Nav buttons
  const navMap = {
    dashboard: t('nav_dashboard'),
    os:        t('nav_os'),
    small:     t('nav_small'),
    infra:     t('nav_infra'),
    history:   t('nav_history'),
    accounts:  t('nav_accounts'),
    alerts:    t('nav_alerts'),
    settings:  t('nav_settings'),
  };
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    const tab = btn.getAttribute('data-tab');
    if (navMap[tab]) btn.textContent = navMap[tab];
  });

  // Auth button & status
  const authBtn = document.getElementById('auth-btn');
  if (authBtn) {
    const isLoggedIn = authBtn.id === 'auth-btn' && authBtn.textContent.includes('Выйти') || authBtn.textContent.includes('Sign Out') || authBtn.textContent.includes('Out');
    authBtn.textContent = isLoggedIn ? t('btn_logout') : t('btn_login');
  }

  // Elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (el.tagName === 'INPUT' && el.placeholder !== undefined) {
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });

  // Search placeholders
  document.querySelectorAll('input[type="text"][placeholder]').forEach(el => {
    if (el.placeholder === 'Поиск...' || el.placeholder === 'Search...') {
      el.placeholder = t('msg_search');
    }
  });

  // Table headers with data-i18n
  document.querySelectorAll('th[data-i18n]').forEach(th => {
    th.textContent = t(th.getAttribute('data-i18n'));
  });
}

// Init lang on load
(function() {
  _lang = localStorage.getItem('itassets_lang') || 'ru';
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = _lang === 'ru' ? 'EN' : 'RU';
  document.documentElement.setAttribute('lang', _lang);
})();
