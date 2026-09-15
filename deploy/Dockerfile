# ---- Build stage ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS build

WORKDIR /app

ENV VITE_DEFAULT_API_URL=__VITE_DEFAULT_API_URL_PLACEHOLDER__
ENV VITE_API_PROXY_AVAILABLE=__VITE_API_PROXY_AVAILABLE_PLACEHOLDER__
ENV VITE_API_PROXY_LOCKED=__VITE_API_PROXY_LOCKED_PLACEHOLDER__
ENV VITE_DOCKER_DEPLOYMENT=__VITE_DOCKER_DEPLOYMENT_PLACEHOLDER__
ENV VITE_DOCKER_LEGACY_API_URL_USED=__VITE_DOCKER_LEGACY_API_URL_USED_PLACEHOLDER__
ENV VITE_SHOW_PRESET_CONFIG_ONLY=__VITE_SHOW_PRESET_CONFIG_ONLY_PLACEHOLDER__
ENV VITE_LOCK_PRESET_CONFIG_PARAMS=__VITE_LOCK_PRESET_CONFIG_PARAMS_PLACEHOLDER__
ENV VITE_PREVENT_PRESET_CONFIG_DELETION=__VITE_PREVENT_PRESET_CONFIG_DELETION_PLACEHOLDER__
ENV VITE_NAS_AUTH_ENABLED=__VITE_NAS_AUTH_ENABLED_PLACEHOLDER__

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:22-alpine

RUN apk add --no-cache nginx gettext

ENV HOST=0.0.0.0
ENV PORT=80
ENV APP_SERVER_PORT=3000
ENV DEFAULT_API_URL=
ENV API_PROXY_URL=
ENV API_CONFIG_PATH=/config/gpt-image-playground.json
ENV DATA_DIR=/data
ENV COOKIE_SECURE=true
ENV APP_ORIGIN=
ENV ENABLE_API_PROXY=false
ENV LOCK_API_PROXY=false
ENV SHOW_PRESET_CONFIG_ONLY=false
ENV LOCK_PRESET_CONFIG_PARAMS=false
ENV PREVENT_PRESET_CONFIG_DELETION=false

COPY --from=build /app/dist /usr/share/nginx/html
COPY server /app/server
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --chmod=755 deploy/migrate-api-env.envsh /docker-entrypoint.d/05-migrate-api-env.envsh
COPY --chmod=755 deploy/inject-api-url.sh /docker-entrypoint.d/40-inject-api-url.sh
COPY --chmod=755 deploy/start.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh /docker-entrypoint.d/*

EXPOSE 80

CMD ["/app/start.sh"]
