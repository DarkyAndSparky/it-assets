# IT Assets — Docker image
#
# Требует Node.js >= 22.5.0 (см. package.json engines) — версия нужна
# встроенному node:sqlite, отдельный better-sqlite3 не используется.

FROM node:22-slim

# OPS-7 (Track 9, найдено при аудите procure-it): OCI-метаданные — видны
# через `docker inspect`/`docker image ls --format`, полезны когда образов
# накопилось много (какая версия, откуда собрана, чей это проект). Значения
# статичные (VERSION копируется отдельным слоем ниже и читается рантаймом,
# дублировать его сюда через build-time ARG избыточно для одного человека,
# работающего в одном репозитории — при желании можно позже завести ARG).
LABEL org.opencontainers.image.title="IT Assets" \
      org.opencontainers.image.description="IT Assets Management — beta 1" \
      org.opencontainers.image.source="https://github.com/DarkyAndSparky/it-assets" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.authors="DarkyAndSparky"

WORKDIR /app

# Сначала только манифесты — слой с зависимостями кешируется отдельно от
# кода, пересборка после правки кода не тянет npm install заново.
COPY package.json package-lock.json ./
# --ignore-scripts: без него npm ci запускает lifecycle-скрипт "prepare"
# (см. INFRA-3, scripts/install-hooks.js — ставит git pre-commit хук), а на
# этом шаге ещё не скопирована папка scripts/ — сборка упала бы с "Cannot
# find module". Внутри Docker-образа git-хуки и не нужны (нет .git и
# самого репозитория, только собранный код) — пропускаем осознанно, а не
# просто чиним порядок COPY, чтобы деплой-контекст не зависел от scripts/.
RUN npm ci --omit=dev --ignore-scripts

COPY server ./server
COPY public ./public
# VERSION — источник правды по версии (см. INFRA-4), CHANGELOG.md — читается
# рантаймом для карточки «О системе» (см. INFRA-8, parseChangelogSummary).
# Без них /api/settings/system-info просто покажет "unknown"/пустой список
# изменений — не критично, но лучше скопировать.
COPY VERSION CHANGELOG.md ./

# Данные (db.json/config.json/it-assets.sqlite/бэкапы/TLS-сертификат)
# живут в одном каталоге — IT_ASSETS_DATA_DIR, монтируется как volume
# в docker-compose.yml, чтобы не потерять их при пересборке образа.
ENV IT_ASSETS_DATA_DIR=/data
RUN mkdir -p /data && \
    addgroup --system --gid 1001 itassets && \
    adduser --system --uid 1001 --gid 1001 itassets && \
    chown -R itassets:itassets /data /app

# OPS-6 (Track 9, найдено при аудите procure-it): gosu — Debian-аналог
# su-exec (см. docker-entrypoint.sh для полного объяснения). Устанавливаем
# из apt, а не качаем бинарник вручную — образ и так на Debian, лишний
# внешний скачиваемый артефакт ни к чему.
RUN apt-get update && apt-get install -y --no-install-recommends gosu && \
    rm -rf /var/lib/apt/lists/*

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Образ стартует от root — entrypoint chown'ит /data и роняет привилегии до
# itassets перед exec node (см. docker-entrypoint.sh). Жёсткого `USER
# itassets` здесь больше нет осознанно, это не регрессия.
ENTRYPOINT ["docker-entrypoint.sh"]

EXPOSE 3000 3443

# INFRA (взято на заметку из atlas-server): используем уже существующий
# публичный GET /api/health (без авторизации, см. server/index.js) —
# ничего нового добавлять не пришлось, эндпоинт уже был.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
