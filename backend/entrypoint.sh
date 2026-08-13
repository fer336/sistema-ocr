#!/bin/bash
set -e

# DATABASE_URL (y el resto de la config de la app) llega ya resuelta por
# app/core/config.py -- lee el secret único de Qeva (/run/secrets/remitos_env)
# o .env, según corresponda.
#
# El stack de Swarm corre solo dos servicios (backend, frontend): no hay un
# tercer servicio "worker" aparte. El proceso que consume la cola de OCR se
# lanza EN ESTE MISMO contenedor, en background, junto a uvicorn -- así se
# preserva el procesamiento asíncrono (barra de progreso, reintentos,
# pantalla de Errores) sin agregar un servicio de Swarm más. Por eso las
# migraciones ya no son condicionales por RUN_MIGRATIONS: este contenedor
# cumple los dos roles siempre, no hay otro proceso con el que pueda pisarse
# corriendo `alembic upgrade head` a la vez.
#
# `depends_on` en docker-compose.yml es una lista simple (Portainer/Swarm no
# soportan `condition: service_healthy`), así que no hay garantía de que
# Postgres ya acepte conexiones cuando este contenedor arranca. Se reintenta
# acá en vez de confiar solo en el restart_policy de Swarm: recupera en
# segundos en vez de esperar su backoff.
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

echo "[entrypoint] iniciando worker de OCR en background"
python -m app.worker.run &
worker_pid=$!

echo "[entrypoint] iniciando servidor"
"$@" &
main_pid=$!

# Si cualquiera de los dos procesos muere, el contenedor entero sale con
# error para que Swarm lo reinicie completo -- no queremos quedar con uvicorn
# vivo y el worker muerto en silencio, ni al revés.
wait -n "$worker_pid" "$main_pid"
exit_code=$?
kill "$worker_pid" "$main_pid" 2>/dev/null || true
exit "$exit_code"
