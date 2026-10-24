# syntax=docker/dockerfile:1.7
# Vessel web client, served by Caddy.
#
#   docker build -f deploy/web.Dockerfile -t vessel-web .
#
# The build stage compiles the Vite app. The runtime is Caddy: it terminates
# TLS, serves the static client, proxies /api to the API container and the
# sync and storage servers on their subdomains (deploy/Caddyfile). At start,
# deploy/web-entrypoint.sh writes /srv/config.js from the container's
# environment so one image serves any domain without a rebuild.

FROM node:24-bookworm-slim AS build
ENV CI=true
RUN npm install -g pnpm@10
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/vessel/package.json artifacts/vessel/
COPY lib/db/package.json lib/db/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY scripts/package.json scripts/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
# PORT is read by vite.config.ts even for a build; the value is irrelevant here.
ARG BASE_PATH=/
ENV NODE_ENV=production PORT=5173 BASE_PATH=$BASE_PATH
RUN pnpm run typecheck:libs && pnpm --filter @workspace/vessel run build

FROM caddy:2-alpine AS runtime
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/web-entrypoint.sh /usr/local/bin/vessel-web-entrypoint
RUN chmod +x /usr/local/bin/vessel-web-entrypoint
COPY --from=build /app/artifacts/vessel/dist/public /srv
EXPOSE 80 443 443/udp
ENTRYPOINT ["vessel-web-entrypoint"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
