#!/bin/sh

if [ "${DEFAULT_API_URL+x}" != "x" ]; then
    DEFAULT_API_URL=${API_URL:-https://api.openai.com/v1}
fi
DOCKER_LEGACY_API_URL_USED=${DOCKER_LEGACY_API_URL_USED:-false}
if [ -n "$API_URL" ]; then
    DOCKER_LEGACY_API_URL_USED=true
fi

API_PROXY_AVAILABLE=false
if [ "$ENABLE_API_PROXY" = "true" ]; then
    API_PROXY_AVAILABLE=true
fi

API_PROXY_LOCKED=false
if [ "$ENABLE_API_PROXY" = "true" ] && [ "$LOCK_API_PROXY" = "true" ]; then
    API_PROXY_LOCKED=true
fi

PRESET_CONFIG_ONLY=false
if [ "$SHOW_PRESET_CONFIG_ONLY" = "true" ] || [ "$SHOW_DEFAULT_CONFIG_ONLY" = "true" ]; then
    PRESET_CONFIG_ONLY=true
fi

PRESET_CONFIG_PARAMS_LOCKED=false
if [ "$LOCK_PRESET_CONFIG_PARAMS" = "true" ]; then
    PRESET_CONFIG_PARAMS_LOCKED=true
fi

PRESET_CONFIG_DELETION_PREVENTED=false
if [ "$PREVENT_PRESET_CONFIG_DELETION" = "true" ]; then
    PRESET_CONFIG_DELETION_PREVENTED=true
fi

escape_sed_replacement() {
    printf '%s' "$1" | sed 's/[&|\\]/\\&/g'
}

escape_js_string() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

DEFAULT_API_URL=
DEFAULT_API_URL_ESCAPED=$(escape_sed_replacement "$(escape_js_string "$DEFAULT_API_URL")")

find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_DEFAULT_API_URL_PLACEHOLDER__|$DEFAULT_API_URL_ESCAPED|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_API_PROXY_AVAILABLE_PLACEHOLDER__|$API_PROXY_AVAILABLE|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_API_PROXY_LOCKED_PLACEHOLDER__|$API_PROXY_LOCKED|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__|true|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_DOCKER_LEGACY_API_URL_USED_PLACEHOLDER__|$DOCKER_LEGACY_API_URL_USED|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_SHOW_PRESET_CONFIG_ONLY_PLACEHOLDER__|$PRESET_CONFIG_ONLY|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_LOCK_PRESET_CONFIG_PARAMS_PLACEHOLDER__|$PRESET_CONFIG_PARAMS_LOCKED|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_PREVENT_PRESET_CONFIG_DELETION_PLACEHOLDER__|$PRESET_CONFIG_DELETION_PREVENTED|g" {} +
find /usr/share/nginx/html/assets -type f -name "*.js" -exec sed -i "s|__VITE_NAS_AUTH_ENABLED_PLACEHOLDER__|true|g" {} +

if [ "$ENABLE_API_PROXY" != "true" ]; then
    sed -i '/# BEGIN API PROXY/,/# END API PROXY/d' /etc/nginx/http.d/default.conf
fi

exec "$@"
