#!/bin/sh
set -e

SECRET="/run/secrets/remitos_env"
if [ -f "$SECRET" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$SECRET"
    set +a
fi

exec /usr/bin/docker-entrypoint.sh "$@"
