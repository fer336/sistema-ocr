#!/bin/sh
set -e

# DATABASE_URL (y el resto de la config de la app) llega ya resuelta por
# app/core/config.py -- lee el secret único de Qeva (/run/secrets/remitos_env)
# o .env, según corresponda. Este entrypoint no arma nada, solo migra.

# Las migraciones sólo las corre el servicio de API (RUN_MIGRATIONS=1 en
# compose). El worker usa la misma imagen pero NO debe migrar: dos procesos
# corriendo `alembic upgrade head` al mismo tiempo se pisan.
#
# `depends_on` en docker-compose.yml es una lista simple (Portainer/Swarm no
# soportan `condition: service_healthy`), así que no hay garantía de que
# Postgres ya acepte conexiones cuando este contenedor arranca. Se reintenta
# acá en vez de confiar solo en `restart: unless-stopped`: recupera en
# segundos en vez de esperar el backoff de reinicio de Docker.
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
    attempt=1
    max_attempts=10
    until alembic upgrade head; do
        if [ "$attempt" -ge "$max_attempts" ]; then
            echo "[entrypoint] alembic upgrade head falló tras ${max_attempts} intentos" >&2
            exit 1
        fi
        echo "[entrypoint] alembic upgrade head falló (intento ${attempt}/${max_attempts}), reintentando en 3s..."
        attempt=$((attempt + 1))
        sleep 3
    done
fi

exec "$@"
