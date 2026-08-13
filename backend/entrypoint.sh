#!/bin/sh
set -e

# DATABASE_URL (y el resto de la config de la app) llega ya resuelta por
# app/core/config.py -- lee el secret único de Qeva (/run/secrets/remitos_env)
# o .env, según corresponda. Este entrypoint no arma nada, solo migra.

# Las migraciones sólo las corre el servicio de API (RUN_MIGRATIONS=1 en
# compose). El worker usa la misma imagen pero NO debe migrar: dos procesos
# corriendo `alembic upgrade head` al mismo tiempo se pisan.
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
    echo "[entrypoint] alembic upgrade head"
    alembic upgrade head
fi

exec "$@"
