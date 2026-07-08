<div align="center">

# 🖥️ IT Assets

**Система внутреннего учёта ИТ-оборудования**

![Version](https://img.shields.io/badge/версия-β1·26w27·02-blue?style=flat-square)
![Node](https://img.shields.io/badge/Node.js-v18%2B-brightgreen?style=flat-square&logo=node.js)
![License](https://img.shields.io/badge/использование-внутреннее-lightgrey?style=flat-square)
![Platform](https://img.shields.io/badge/платформа-Windows%20%7C%20Linux%20%7C%20macOS-informational?style=flat-square)

Лёгкое self-hosted приложение для инвентаризации ноутбуков, серверов, сетевого оборудования и периферии.  
Работает без интернета, не требует установки БД — всё хранится в JSON.

</div>

---

## ✨ Возможности

- 📋 Три реестра: **ОС / Мелочи / Инфра**
- 🔄 История перемещений и изменений
- 👥 Сотрудники и организации
- 📥 Импорт из CSV, экспорт в Excel
- 🔐 Три роли: Администратор · Оператор · Просмотр
- 📦 Автоматическое резервное копирование
- 🔒 HTTPS из коробки (самоподписанный сертификат)
- 📡 Работа в локальной сети без настройки

---

## 🚀 Быстрый старт

### Windows

1. Установите **[Node.js LTS](https://nodejs.org)**
2. Дважды кликните **`INSTALL.bat`** — установит зависимости
3. Дважды кликните **`START.bat`** — откроет браузер

### Linux / macOS

```bash
chmod +x install.sh start.sh
./start.sh          # зависимости подтянутся автоматически
```

Приложение откроется по адресу **`https://localhost:3443`**

> **Предупреждение браузера о сертификате** — ожидаемо. Нажмите «Дополнительно» → «Перейти».

---

## 🔑 Вход по умолчанию

| Логин | Пароль | Роль |
|-------|--------|------|
| `admin` | `admn0000` | Администратор |

> ⚠️ **Смените пароль после первого входа** — система напомнит сама.

### Роли

| | Администратор | Оператор | Просмотр |
|---|:---:|:---:|:---:|
| Просмотр оборудования | ✅ | ✅ | ✅ |
| Добавить / изменить | ✅ | ✅ | ❌ |
| Настройки системы | ✅ | ❌ | ❌ |

---

## 📋 Требования

| | Минимум | Рекомендуется |
|--|---------|---------------|
| Node.js | v18 LTS | v20+ LTS |
| ОЗУ | 128 MB | 256 MB |
| Место | 50 MB | 200 MB |

<details>
<summary>Установка Node.js на Linux</summary>

```bash
# Ubuntu / Debian
sudo apt update && sudo apt install nodejs npm

# Fedora / RHEL
sudo dnf install nodejs

# Arch
sudo pacman -S nodejs npm

# Через nvm (рекомендуется)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# перезапустить терминал
nvm install --lts
```

</details>

---

## 🗂️ Структура

```
it-assets/
├── server/
│   ├── index.js        # веб-сервер (Express + HTTPS)
│   ├── database.js     # работа с данными (lowdb/JSON)
│   ├── migrate.js      # автомиграция схемы при старте
│   ├── pin.js          # хеширование PIN (bcrypt)
│   └── cert.js         # генерация TLS-сертификата
├── public/
│   └── index.html      # весь фронтенд (SPA без сборки)
├── data/               # ← создаётся автоматически, в git не попадает
│   ├── db.json         # реестр оборудования и история
│   ├── config.json     # пользователи, орги, настройки
│   └── backups/        # автоматические резервные копии
├── START.bat / start.sh
├── INSTALL.bat / install.sh
└── package.json
```

---

## ⚙️ Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `PORT` | `3000` | HTTP-порт (только редирект на HTTPS) |
| `HTTPS_PORT` | `3443` | HTTPS-порт приложения |
| `IT_ASSETS_DATA_DIR` | `./data` | Путь к папке с данными |
| `TRUST_PROXY` | — | Установите `1` при работе за nginx/reverse proxy |
| `CORS_ORIGINS` | — | Разрешённые origins через запятую |

Пример запуска с кастомными портами:
```bash
PORT=8080 HTTPS_PORT=8443 node server/index.js
```

---

## 🌐 Доступ из локальной сети

Сервер слушает на `0.0.0.0`. Узнайте свой IP:

```bash
# Linux
hostname -I | awk '{print $1}'

# macOS
ipconfig getifaddr en0
```

Откройте коллегам: **`https://192.168.x.x:3443`**

<details>
<summary>Открыть порт в firewall</summary>

```bash
# ufw (Ubuntu/Debian)
sudo ufw allow 3443/tcp

# firewalld (Fedora/RHEL)
sudo firewall-cmd --add-port=3443/tcp --permanent && sudo firewall-cmd --reload
```

</details>

---

## 💾 Резервное копирование

Автобэкап встроен — копии сохраняются в `data/backups/` с раздельными пулами:

| Тип | Хранится |
|-----|----------|
| Авто (каждый час) | последние 20 |
| При старте сервера | последние 10 |
| Ручной | последние 20 |
| Перед восстановлением | последние 5 |

Ручное копирование:
```bash
cp data/db.json     ~/backup/db_$(date +%Y%m%d).json
cp data/config.json ~/backup/config_$(date +%Y%m%d).json
```

---

## 🛠️ Устранение проблем

<details>
<summary>Частые вопросы</summary>

| Проблема | Решение |
|----------|---------|
| `node: command not found` | Установите Node.js |
| Белый экран | F12 → Console — скопируйте ошибку |
| Порт занят (`EADDRINUSE`) | Задайте `PORT` / `HTTPS_PORT` |
| Коллеги не видят сервер | Проверьте firewall, используйте `https://` и порт `3443` |
| «Соединение не защищено» | Ожидаемо — нажмите «Дополнительно» → «Перейти» |
| `npm install` падает | Попробуйте `npm install --legacy-peer-deps` |
| Медленно открывается | Нормально при первом запуске |

</details>

---

## 📥 Импорт из CSV

1. Подготовьте файл с заголовками:
   ```
   Вкладка, Инв. номер, Филиал, Расположение, Ответственный, Тип, Модель,
   Серийный №, Статус, Организация, Примечание, MAC, IP, Hostname, Прошивка
   ```
2. ⚙️ Настройки → **Импорт из CSV** → выберите файл → **Импортировать**

Дубли по серийному номеру пропускаются автоматически.

---

<div align="center">

Разработано для внутреннего учёта ИТ-оборудования  
Автор: **[DarkyAndSparky](https://github.com/DarkyAndSparky)**

</div>
