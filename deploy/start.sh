#!/bin/sh
set -eu

if [ -z "${APP_PASSWORD:-}" ]; then
    echo "APP_PASSWORD is required" >&2
    exit 1
fi

APP_SERVER_PORT=${APP_SERVER_PORT:-3000}
export APP_SERVER_PORT

mkdir -p /run/nginx /etc/nginx/http.d
envsubst '${HOST} ${PORT} ${APP_SERVER_PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/http.d/default.conf

if [ -d /docker-entrypoint.d ]; then
    for script in /docker-entrypoint.d/*; do
        if [ -x "$script" ]; then
            case "$script" in
                *.envsh)
                    . "$script"
                    ;;
                *)
                    "$script" true
                    ;;
            esac
        fi
    done
fi

node /app/server/app.mjs &
node_pid=$!

term_handler() {
    kill "$node_pid" 2>/dev/null || true
    kill "$nginx_pid" 2>/dev/null || true
    wait "$node_pid" 2>/dev/null || true
    wait "$nginx_pid" 2>/dev/null || true
}
trap term_handler INT TERM

nginx -g 'daemon off;' &
nginx_pid=$!

set +e
while true; do
    if ! kill -0 "$node_pid" 2>/dev/null; then
        wait "$node_pid"
        exit_status=$?
        break
    fi
    if ! kill -0 "$nginx_pid" 2>/dev/null; then
        wait "$nginx_pid"
        exit_status=$?
        break
    fi
    sleep 1
done
set -e

kill "$node_pid" 2>/dev/null || true
kill "$nginx_pid" 2>/dev/null || true
wait "$node_pid" 2>/dev/null || true
wait "$nginx_pid" 2>/dev/null || true
exit "$exit_status"
