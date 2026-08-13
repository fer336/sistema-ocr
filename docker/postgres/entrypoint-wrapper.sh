#!/bin/sh
set -e

# Adaptador shell/entrypoint de INFRASTRUCTURE.md Anexo B: si existe el
# secret único montado, se exportan sus variables antes de arrancar el
# proceso real. Si no existe (desarrollo local sin el secret montado), no
# hace nada y sigue con las variables de entorno que ya tenga el contenedor
# -- mismo binario, mismo comportamiento, en cualquier entorno (INF-221).
SECRET="/run/secrets/remitos_env"
if [ -f "$SECRET" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$SECRET"
    set +a
fi

exec docker-entrypoint.sh "$@"
