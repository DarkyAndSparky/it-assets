#!/bin/sh
# OPS-6 (Track 9, найдено при аудите procure-it): раньше в Dockerfile стоял
# жёсткий `USER itassets` (uid 1001) — chown /data делался один раз на
# этапе сборки образа. Это работает только для named volume (Docker сам
# создаёт его с нужным владельцем при первом запуске), но ломается для
# bind-mount с произвольным хостовым UID (например `-v /srv/it-assets:/data`
# на машине, где /srv/it-assets принадлежит другому uid) — процесс стартует
# от itassets, но не может писать в примонтированный каталог.
#
# Решение: образ теперь стартует от root (USER не выставлен в Dockerfile),
# entrypoint правит владельца /data под itassets ПРИ КАЖДОМ старте
# контейнера (дёшево — chown уже-верных файлов почти мгновенен), затем
# роняет привилегии и запускает node уже от itassets. root внутри
# контейнера существует только на время этого chown, сам процесс node
# никогда не работает от root.
#
# gosu вместо su-exec: su-exec — пакет из Alpine (apk), наш образ на
# node:22-slim (Debian/apt) — используем его прямой аналог gosu (тот же
# принцип: exec под другим uid без обёртки-шелла, в отличие от su/sudo не
# создаёт лишний процесс и корректно прокидывает сигналы дальше, что важно
# для OPS-1/gracefulShutdown).
set -e

chown -R itassets:itassets /data

exec gosu itassets:itassets "$@"
