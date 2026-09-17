/**
 * public/js/scan.js — логика страницы /scan.html (PROD-8).
 *
 * ВЫНЕСЕНО ИЗ ИНЛАЙН-<script> ПОСЛЕ ФАКТА (найдено при работе над PROD-12,
 * не изначально): глобальный CSP-заголовок в server/index.js —
 * `script-src 'self'` БЕЗ 'unsafe-inline' — применяется middleware'ом
 * `app.use()` КО ВСЕМ ответам сервера безусловно, включая статичные файлы
 * вроде scan.html. Инлайн-<script> в scan.html поэтому браузером
 * молча блокировался бы (та самая "Фаза 6" в комментарии над CSP в
 * index.js относится к разметке SPA — про scan.html там речи не было,
 * это отдельный файл, добавленный позже, в PROD-8). Реальный
 * функциональный баг — страница открывалась бы, но JS не выполнялся бы
 * вообще, ни ручной ввод, ни камера. Исправлено переносом в этот внешний
 * файл, как и весь остальной JS проекта.
 */
(function () {
  var input   = document.getElementById('code-input');
  var lookupBtn = document.getElementById('lookup-btn');
  var resultCard = document.getElementById('result-card');
  var cameraBtn = document.getElementById('camera-btn');
  var cameraStopBtn = document.getElementById('camera-stop-btn');
  var cameraWrap = document.getElementById('camera-wrap');
  var video = document.getElementById('camera-video');
  var stream = null, scanTimer = null;

  // Штрихкод/QR-сканеры (ручные, USB/Bluetooth) обычно эмулируют клавиатуру:
  // печатают текст кода и завершают Enter'ом — это ОСНОВНОЙ ожидаемый сценарий
  // для физического сканера. Кнопка камеры — для случая, когда сканера нет,
  // только телефон.
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') lookup();
  });
  lookupBtn.addEventListener('click', lookup);

  var STATUS_LABELS = { 'используется':'Используется', 'резерв':'Резерв', 'ремонт':'Ремонт', 'списан':'Списан' };
  var TAB_LABELS = { os:'Оргтехника', small:'Мелкая техника', infra:'Инфраструктура' };
  var FIELDS = [
    ['model', 'Модель'], ['type', 'Тип'], ['category', 'Категория'],
    ['inv', 'Инв. номер'], ['serial', 'Серийный №'],
    ['status', 'Статус'], ['tab', 'Раздел'], ['filial', 'Филиал'], ['location', 'Расположение'],
  ];

  function esc(s) {
    var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML;
  }

  function showStatus(msg, isError) {
    resultCard.style.display = 'block';
    resultCard.innerHTML = '<div class="status-msg' + (isError ? ' error' : '') + '">' + esc(msg) + '</div>';
  }

  function renderResult(a) {
    var rows = FIELDS.filter(function (f) { return a[f[0]]; }).map(function (f) {
      var val = a[f[0]];
      if (f[0] === 'status') val = STATUS_LABELS[val] || val;
      if (f[0] === 'tab')    val = TAB_LABELS[val] || val;
      return '<div class="result-row"><div class="result-label">' + esc(f[1]) + '</div>' +
             '<div class="result-value">' + esc(val) + '</div></div>';
    }).join('');
    resultCard.style.display = 'block';
    resultCard.innerHTML = '<div class="result-title">' + esc(a.model || 'Устройство') + '</div>' + rows;
  }

  function lookup() {
    var code = input.value.trim();
    if (!code) return;
    showStatus('Поиск…', false);
    fetch('/api/public/scan?code=' + encodeURIComponent(code))
      .then(function (r) {
        if (r.status === 404) { showStatus('Устройство с таким кодом не найдено в реестре.', true); return null; }
        if (!r.ok) { showStatus('Ошибка запроса (' + r.status + ')', true); return null; }
        return r.json();
      })
      .then(function (a) { if (a) renderResult(a); })
      .catch(function () { showStatus('Нет соединения с сервером.', true); });
    input.value = '';
    input.focus();
  }

  // Камера — прогрессивное улучшение через нативный BarcodeDetector
  // (Chrome/Edge/Android WebView). Без полифилла и без подключения тяжёлых
  // JS QR-декодеров (jsqr и т.п. используются в проекте только в тестах,
  // не в рантайме) — если API недоступен (Safari/Firefox на момент
  // реализации), кнопка просто не показывается, работает только ручной
  // ввод/сканер-эмулятор клавиатуры (см. выше — это основной сценарий).
  if ('BarcodeDetector' in window) {
    cameraBtn.style.display = 'block';
  } else {
    cameraBtn.style.display = 'none';
  }

  cameraBtn.addEventListener('click', startCamera);
  cameraStopBtn.addEventListener('click', stopCamera);

  function startCamera() {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(function (s) {
        stream = s;
        video.srcObject = s;
        video.play();
        cameraWrap.style.display = 'block';
        cameraBtn.style.display = 'none';
        var detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        scanTimer = setInterval(function () {
          detector.detect(video).then(function (codes) {
            if (codes.length) {
              // QR-содержимое активов проекта — многострочный текст вида
              // "INV:XXX\nSN:YYY\nModel" (см. public/js/views/qr-print.js
              // buildQrText()) — берём первую строку, /api/public/scan сам
              // снимает префикс INV:/SN:.
              input.value = codes[0].rawValue.split('\n')[0];
              stopCamera();
              lookup();
            }
          }).catch(function () {});
        }, 300);
      })
      .catch(function () { showStatus('Нет доступа к камере.', true); });
  }

  function stopCamera() {
    if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    cameraWrap.style.display = 'none';
    cameraBtn.style.display = ('BarcodeDetector' in window) ? 'block' : 'none';
  }
})();