/**
 * public/js/meta-fields.js
 *
 * Фаза 5, шаг 6: справочник дополнительных полей по категориям
 * оборудования (IP/MAC/логин и т.д.), вынесенный из public/index.html.
 * Полностью статические данные + чистая функция без побочных эффектов —
 * самый низкий риск среди всех шагов Фазы 5.
 */

const META_FIELDS={
  'Сетевое оборудование':['ip','mac','subnet','winbox','login','password','cabinet'],
  'Wi-Fi':['ip','mac','controller','inv','network'],
  'Принтеры':['ip','mac','hostname','login','password','cartridge','firmware'],
  'Видеонаблюдение':['ip','mac','login','password'],
  'ИБП':['cabinet'],
  'Серверы':['ip','mac','login','password'],
  '_default':['ip','mac','subnet','note2'],
};
const META_LABELS={ip:'IP адрес',mac:'MAC адрес',subnet:'Подсеть',winbox:'WinBox/URL',
  login:'Логин',password:'Пароль',cabinet:'Шкаф/стойка',controller:'Контроллер',
  inv:'ИНВ номер',network:'Имя сети',hostname:'Hostname',cartridge:'Картриджи',
  firmware:'Прошивка',note2:'Доп. описание'};

function getMetaFields(category) {
  return META_FIELDS[category] || META_FIELDS['_default'];
}
