# IT Assets — Docker image
#
# Требует Node.js >= 22.5.0 (см. package.json engines) — версия нужна
# встроенному node:sqlite, отдельный better-sqlite3 не используется.

FROM node:22-slim

WORKDIR /app

# Сначала только манифесты — слой с зависимостями кешируется отдельно от
# кода, пересборка после правки кода не тянет npm install заново.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# Данные (db.json/config.json/it-assets.sqlite/бэкапы/TLS-сертификат)
# живут в одном каталоге — IT_ASSETS_DATA_DIR, монтируется как volume
# в docker-compose.yml, чтобы не потерять их при пересборке образа.
ENV IT_ASSETS_DATA_DIR=/data
RUN mkdir -p /data && \
    addgroup --system --gid 1001 itassets && \
    adduser --system --uid 1001 --gid 1001 itassets && \
    chown -R itassets:itassets /data /app
USER itassets

EXPOSE 3000 3443

CMD ["node", "server/index.js"]
