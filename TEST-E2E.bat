@echo off
title IT Assets - E2E Tests (Playwright)
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found.
    cmd /k
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
    echo.
)

if not exist "node_modules\@playwright\test" (
    echo [INFO] Installing Playwright...
    call npm install
    echo.
)

REM Раньше здесь была проверка "if not exist %USERPROFILE%\...\ms-playwright"
REM — она смотрела только на существование папки, а не на то, стоит ли внутри
REM нужная версия браузера. Если папка уже существовала (от другого проекта,
REM от предыдущей версии Playwright, или после частичной/неудачной установки),
REM проверка проходила и установка молча пропускалась — а нужного бинарника
REM внутри не было. Итог: "Executable doesn't exist at ...chrome-headless-shell.exe"
REM прямо в момент запуска тестов, никак не предупредив заранее.
REM Правильная проверка — не "существует ли папка", а "стоит ли то, что нужно
REM именно этой версии Playwright" — и это как раз то, что делает сама команда
REM playwright install: она идемпотентна, при уже установленном браузере
REM отрабатывает за секунды без повторной загрузки, поэтому безопасно вызывать
REM её каждый раз, а не только "на всякий случай при первом запуске".
echo [INFO] Checking Playwright browser...
call npx playwright install chromium
echo.

echo [RUN] Running E2E tests ^(this opens/runs a real browser^)...
echo ----------------------------------------

call node_modules\.bin\playwright.cmd test
set TEST_RESULT=%errorlevel%

echo ----------------------------------------
if %TEST_RESULT%==0 (
    echo [OK] All E2E tests passed.
) else (
    echo [FAIL] Some E2E tests failed. See test-results\ and playwright-report\ for details.
    echo [TIP] Run "npx playwright show-report" to view the HTML report.
)

cmd /k
