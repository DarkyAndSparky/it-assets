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
    // LOC-1: auth.js — форма входа, форма принудительной смены пароля,
    // сообщения об ошибках/успехе. Не путать field_login (подпись поля)
    // с msg_enter_login (placeholder) — разный текст в оригинале.
    modal_login_title: '🔐 Вход в систему',
    field_password: 'Пароль',
    msg_enter_login: 'Введите логин',
    msg_enter_password: 'Введите пароль',
    btn_login_submit: 'Войти',
    msg_logged_out: 'Вышли из системы',
    msg_welcome: 'Добро пожаловать, {name}!',
    msg_invalid_credentials: 'Неверный логин или пароль',
    msg_connection_error: 'Ошибка соединения с сервером',
    loc_forced_pin_title: '⚠️ Нужно сменить пароль',
    loc_forced_pin_body: 'Вы вошли под стандартным паролем <code style="background:var(--surface2);padding:2px 6px;border-radius:4px">admn0000</code>.\n        Это пароль по умолчанию из документации — он известен всем в сети.<br><br>\n        Пока вы его не смените, все действия в системе будут заблокированы — доступна только эта форма.',
    lbl_new_password: 'Новый пароль',
    lbl_repeat_password: 'Повторите пароль',
    msg_min_4_chars: 'Минимум 4 символа',
    btn_change_pin_continue: '🔒 Сменить пароль и продолжить',
    msg_pw_too_short: 'Пароль должен быть не короче 4 символов',
    msg_pw_mismatch: 'Пароли не совпадают',
    msg_pw_cannot_be_default: 'Нельзя оставить пароль по умолчанию',
    msg_pw_changed: 'Пароль успешно изменён ✅',
    msg_pw_change_error: 'Ошибка смены пароля',
    msg_connection_error_short: 'Ошибка соединения',
    // LOC-1: ui-utils.js
    msg_copied: 'Скопировано',
    msg_copy_failed: 'Не удалось скопировать',
    msg_download_error: 'Ошибка скачивания',
    msg_download_connection_error: 'Ошибка соединения при скачивании',
    // LOC-1: index.html — статичные подсказки (title="...")
    tooltip_dashboard: 'Перейти на дашборд',
    tooltip_theme: 'Переключить тему',
    // LOC-2: meta-fields.js — подписи доп. полей (IP/MAC/логин и т.п.)
    meta_ip: 'IP адрес',
    meta_mac: 'MAC адрес',
    meta_subnet: 'Подсеть',
    meta_winbox: 'WinBox/URL',
    meta_login: 'Логин',
    meta_password: 'Пароль',
    meta_cabinet: 'Шкаф/стойка',
    meta_controller: 'Контроллер',
    meta_inv: 'ИНВ номер',
    meta_network: 'Имя сети',
    meta_hostname: 'Hostname',
    meta_cartridge: 'Картриджи',
    meta_firmware: 'Прошивка',
    meta_note2: 'Доп. описание',
    // LOC-2: asset-forms.js — модалки создания/редактирования/перемещения/
    // удаления актива + карточка деталей.
    section_meta: '🔧 Мета-данные',
    section_history_count: 'ИСТОРИЯ ПЕРЕМЕЩЕНИЙ ({n})',
    btn_print_card: '🖨 Печать карточки',
    modal_move_title: '🔄 Переместить / переназначить',
    lbl_current_responsible: 'Текущий ответственный',
    lbl_new_responsible: 'Новый ответственный',
    msg_full_name_placeholder: 'ФИО',
    field_reason: 'Причина',
    msg_specify_responsible: 'Укажите ответственного',
    msg_select_org: 'Выберите организацию',
    msg_select_filial: 'Выберите филиал',
    msg_moved: 'Перемещено',
    msg_no_locations: '— нет локаций —',
    modal_add_asset_title: '➕ Добавить оборудование',
    tooltip_generator: 'Генератор',
    msg_inv_example: 'Например: LDV-NB-00001',
    msg_fill_model: 'Заполните модель',
    msg_added: 'Добавлено',
    modal_edit_title: '✏️ Редактировать',
    field_tab: 'Вкладка',
    modal_retire_confirm_title: '🗑 Списать?',
    msg_retire_confirm_suffix: 'будет помечено как «списано».<br>Данные сохранятся в истории.',
    btn_confirm_retire: 'Да, списать',
    msg_retired: 'Списано',
    // LOC-2: asset-tab.js — реестр активов, категории, bulk-операции.
    unit_items: 'единиц',
    tooltip_categories: 'Категории для группировки оборудования',
    btn_categories: 'Категории',
    lbl_all: 'Все',
    lbl_selected: 'Выбрано',
    btn_clear_selection: 'Снять',
    btn_reset: 'Сброс',
    tooltip_select_all: 'Выбрать все / снять все',
    lbl_filial_place: 'Филиал / Место',
    lbl_org_short: 'Орг.',
    lbl_not_assigned: 'Не назначен',
    modal_categories_title: 'Категории — {tab}',
    msg_categories_used_for_grouping: 'Категории используются для группировки оборудования на вкладке.',
    msg_category_delete_note: 'При удалении категории — оборудование из неё <b>не удаляется</b>, только снимается метка.',
    msg_new_collection_placeholder: 'Новая коллекция...',
    msg_collections_saved: 'Коллекции сохранены',
    msg_nothing_selected: 'Ничего не выбрано',
    msg_no_orgs_with_inv_rules: 'Нет организаций с настроенными правилами инв. номеров',
    modal_bulk_inv_title: '🏷 Присвоить инв. номера',
    lbl_selected_devices: 'Выбрано устройств',
    msg_devices_without_inv_note: 'Устройствам с уже присвоенным номером номер не переназначается.',
    field_device_type_rule: 'Тип устройства (правило)',
    msg_inv_only_without_number_note: '⚠ Номера присваиваются только устройствам <b>без инв. номера</b> в выборке.\n      Номера резервируются последовательно согласно счётчику организации.',
    btn_assign: 'Присвоить',
    msg_next_number: 'Следующий номер',
    msg_bulk_assigned_prefix: 'Присвоено',
    msg_bulk_skipped_prefix: 'пропущено',
    modal_bulk_retire_title: '🗑 Массовое списание',
    msg_will_be_retired_count: 'Будет списано',
    msg_units_of_equipment: 'единиц оборудования',
    msg_retire_irreversible: 'Это действие необратимо — оборудование помечается как списанное.',
    field_retire_reason: 'Причина списания',
    msg_retire_reason_placeholder: 'Моральный износ, поломка...',
    btn_retire_count: 'Списать {n} ед.',
    msg_retired_count_prefix: 'Списано',
    msg_units_short: 'ед.',
    msg_errors_count_prefix: 'Ошибок',
    modal_bulk_move_title: '→ Массовое перемещение',
    lbl_assets_count: 'Ассетов',
    msg_empty_field_note: 'Пустое поле не изменится',
    msg_full_name_example: 'Иванов Иван Иванович',
    opt_no_change: '— не менять —',
    msg_move_reason_placeholder: 'Причина перемещения',
    msg_fill_at_least_one_field: 'Заполните хотя бы одно поле',
    msg_moved_count_prefix: 'Перемещено',
    btn_prev: 'Пред',
    btn_next: 'След',
    lbl_of: 'из',
    msg_select_org_and_type: 'Выберите организацию и тип',
    msg_bulk_retire_default_reason: 'Массовое списание',
    // LOC-3: csv-import.js
    msg_hint_history: '📥 <b>История перемещений</b> — будет загружена в журнал событий',
    msg_hint_assets: '💻 <b>Оборудование</b> — будет загружено в реестр',
    msg_hint_unknown_type: '⚠️ Не удалось определить тип файла. Ожидается CSV с заголовками',
    msg_choose_file: 'Выберите файл',
    msg_reading_file: 'Читаю файл...',
    msg_empty_file: 'Файл пустой',
    msg_parsing_rows: 'Разбираю строки...',
    msg_no_data: 'Нет данных',
    msg_unknown_types_warning: '⚠️ <b>{n} типов не найдено в справочнике</b> — попали в ОС по умолчанию.<br>Добавьте их в <b>Настройки → Типы устройств</b>:<br>',
    msg_found_records: 'Найдено {n} записей — {summary}...',
    msg_import_done: 'Готово: добавлено {added}, пропущено {skipped}',
    msg_dupe_serial: 'дублей по серийному',
    msg_dupe_key: 'дублей без серийного',
    msg_no_model: 'без модели',
    msg_skipped_detail: 'Пропущено {n}: {detail}',
    msg_inv_auto_assigned: '🏷 Авто-присвоено инв. номеров: {n}',
    msg_orgs_created: '🏢 Создано организаций: {n} — {list}',
    msg_added_count: '✅ Добавлено: {n}',
    msg_imported_count: 'Импортировано {n}',
    msg_import_error: 'Ошибка импорта',
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
    // LOC-1: auth.js
    modal_login_title: '🔐 Sign In',
    field_password: 'Password',
    msg_enter_login: 'Enter your login',
    msg_enter_password: 'Enter your password',
    btn_login_submit: 'Sign In',
    msg_logged_out: 'Signed out',
    msg_welcome: 'Welcome, {name}!',
    msg_invalid_credentials: 'Invalid login or password',
    msg_connection_error: 'Server connection error',
    loc_forced_pin_title: '⚠️ Password change required',
    loc_forced_pin_body: 'You signed in with the default password <code style="background:var(--surface2);padding:2px 6px;border-radius:4px">admn0000</code>.\n        This is the documented default password — it is known to anyone on the network.<br><br>\n        Until you change it, all actions in the system are blocked — only this form is available.',
    lbl_new_password: 'New password',
    lbl_repeat_password: 'Repeat password',
    msg_min_4_chars: 'Minimum 4 characters',
    btn_change_pin_continue: '🔒 Change password and continue',
    msg_pw_too_short: 'Password must be at least 4 characters',
    msg_pw_mismatch: 'Passwords do not match',
    msg_pw_cannot_be_default: 'Cannot keep the default password',
    msg_pw_changed: 'Password changed successfully ✅',
    msg_pw_change_error: 'Error changing password',
    msg_connection_error_short: 'Connection error',
    // LOC-1: ui-utils.js
    msg_copied: 'Copied',
    msg_copy_failed: 'Failed to copy',
    msg_download_error: 'Download error',
    msg_download_connection_error: 'Connection error while downloading',
    // LOC-1: index.html
    tooltip_dashboard: 'Go to dashboard',
    tooltip_theme: 'Switch theme',
    // LOC-2: meta-fields.js
    meta_ip: 'IP Address',
    meta_mac: 'MAC Address',
    meta_subnet: 'Subnet',
    meta_winbox: 'WinBox/URL',
    meta_login: 'Login',
    meta_password: 'Password',
    meta_cabinet: 'Cabinet/Rack',
    meta_controller: 'Controller',
    meta_inv: 'Inv. Number',
    meta_network: 'Network Name',
    meta_hostname: 'Hostname',
    meta_cartridge: 'Cartridges',
    meta_firmware: 'Firmware',
    meta_note2: 'Additional Notes',
    // LOC-2: asset-forms.js
    section_meta: '🔧 Additional Info',
    section_history_count: 'MOVEMENT HISTORY ({n})',
    btn_print_card: '🖨 Print Card',
    modal_move_title: '🔄 Move / Reassign',
    lbl_current_responsible: 'Current Responsible',
    lbl_new_responsible: 'New Responsible',
    msg_full_name_placeholder: 'Full Name',
    field_reason: 'Reason',
    msg_specify_responsible: 'Specify the responsible person',
    msg_select_org: 'Select an organization',
    msg_select_filial: 'Select a branch',
    msg_moved: 'Moved',
    msg_no_locations: '— no locations —',
    modal_add_asset_title: '➕ Add Equipment',
    tooltip_generator: 'Generator',
    msg_inv_example: 'e.g.: LDV-NB-00001',
    msg_fill_model: 'Please fill in the model',
    msg_added: 'Added',
    modal_edit_title: '✏️ Edit',
    field_tab: 'Tab',
    modal_retire_confirm_title: '🗑 Retire?',
    msg_retire_confirm_suffix: 'will be marked as retired.<br>Data will be preserved in history.',
    btn_confirm_retire: 'Yes, Retire',
    msg_retired: 'Retired',
    // LOC-2: asset-tab.js
    unit_items: 'items',
    tooltip_categories: 'Categories for grouping equipment',
    btn_categories: 'Categories',
    lbl_all: 'All',
    lbl_selected: 'Selected',
    btn_clear_selection: 'Clear',
    btn_reset: 'Reset',
    tooltip_select_all: 'Select all / deselect all',
    lbl_filial_place: 'Branch / Location',
    lbl_org_short: 'Org.',
    lbl_not_assigned: 'Unassigned',
    modal_categories_title: 'Categories — {tab}',
    msg_categories_used_for_grouping: 'Categories are used to group equipment within a tab.',
    msg_category_delete_note: 'Deleting a category does <b>not delete</b> its equipment — only removes the label.',
    msg_new_collection_placeholder: 'New collection...',
    msg_collections_saved: 'Collections saved',
    msg_nothing_selected: 'Nothing selected',
    msg_no_orgs_with_inv_rules: 'No organizations with configured inventory number rules',
    modal_bulk_inv_title: '🏷 Assign Inventory Numbers',
    lbl_selected_devices: 'Devices selected',
    msg_devices_without_inv_note: 'Devices that already have an inventory number will not be reassigned.',
    field_device_type_rule: 'Device Type (Rule)',
    msg_inv_only_without_number_note: '⚠ Numbers are assigned only to devices <b>without an inventory number</b> in the selection.\n      Numbers are reserved sequentially according to the organization\'s counter.',
    btn_assign: 'Assign',
    msg_next_number: 'Next number',
    msg_bulk_assigned_prefix: 'Assigned',
    msg_bulk_skipped_prefix: 'skipped',
    modal_bulk_retire_title: '🗑 Bulk Retire',
    msg_will_be_retired_count: 'Will be retired',
    msg_units_of_equipment: 'units of equipment',
    msg_retire_irreversible: 'This action is irreversible — the equipment will be marked as retired.',
    field_retire_reason: 'Retirement Reason',
    msg_retire_reason_placeholder: 'Obsolete, broken...',
    btn_retire_count: 'Retire {n} unit(s)',
    msg_retired_count_prefix: 'Retired',
    msg_units_short: 'unit(s)',
    msg_errors_count_prefix: 'Errors',
    modal_bulk_move_title: '→ Bulk Move',
    lbl_assets_count: 'Assets',
    msg_empty_field_note: 'An empty field will not be changed',
    msg_full_name_example: 'John Smith',
    opt_no_change: '— no change —',
    msg_move_reason_placeholder: 'Reason for the move',
    msg_fill_at_least_one_field: 'Fill in at least one field',
    msg_moved_count_prefix: 'Moved',
    btn_prev: 'Prev',
    btn_next: 'Next',
    lbl_of: 'of',
    msg_select_org_and_type: 'Select an organization and type',
    msg_bulk_retire_default_reason: 'Bulk retirement',
    // LOC-3: csv-import.js
    msg_hint_history: '📥 <b>Movement History</b> — will be loaded into the event log',
    msg_hint_assets: '💻 <b>Equipment</b> — will be loaded into the registry',
    msg_hint_unknown_type: '⚠️ Could not determine the file type. A CSV with headers is expected',
    msg_choose_file: 'Choose a file',
    msg_reading_file: 'Reading file...',
    msg_empty_file: 'The file is empty',
    msg_parsing_rows: 'Parsing rows...',
    msg_no_data: 'No data',
    msg_unknown_types_warning: '⚠️ <b>{n} type(s) not found in the reference list</b> — defaulted to Devices.<br>Add them under <b>Settings → Device Types</b>:<br>',
    msg_found_records: 'Found {n} records — {summary}...',
    msg_import_done: 'Done: added {added}, skipped {skipped}',
    msg_dupe_serial: 'duplicate serial numbers',
    msg_dupe_key: 'duplicates without a serial number',
    msg_no_model: 'missing model',
    msg_skipped_detail: 'Skipped {n}: {detail}',
    msg_inv_auto_assigned: '🏷 Auto-assigned inventory numbers: {n}',
    msg_orgs_created: '🏢 Organizations created: {n} — {list}',
    msg_added_count: '✅ Added: {n}',
    msg_imported_count: 'Imported {n}',
    msg_import_error: 'Import error',
  }
};

let _lang = localStorage.getItem('itassets_lang') || 'ru';

function t(key, params) {
  let str = (I18N[_lang] && I18N[_lang][key]) || (I18N['ru'] && I18N['ru'][key]) || key;
  if (params) {
    for (const k in params) str = str.split(`{${k}}`).join(params[k]);
  }
  return str;
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

  // LOC-1: статичные подсказки (title="...") — не textContent, отдельный
  // атрибут, поэтому отдельный проход, не смешиваем с [data-i18n] выше.
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
}

// Init lang on load
(function() {
  _lang = localStorage.getItem('itassets_lang') || 'ru';
  const btn = document.getElementById('lang-toggle');
  if (btn) btn.textContent = _lang === 'ru' ? 'EN' : 'RU';
  document.documentElement.setAttribute('lang', _lang);
})();
