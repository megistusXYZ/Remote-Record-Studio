# syntax=docker/dockerfile:1.7
# Vessel API server.
#
#   docker build -f deploy/api.Dockerfile -t vessel-api .
#
# Two stages: a pnpm workspace build that bundles the server with esbuild,
# and a slim runtime holding only the bundle and the SQL migrations. The
# same image runs the API (`dist/index.mjs`) and the one-shot migration
# runner (`dist/migrate.mjs`); see deploy/compose.yaml.
#
# Debian rather than Alpine: the workspace pins glibc builds of its native
# tooling (esbuild, rollup, lightningcss) for linux-x64 and linux-arm64.

FROM node:24-bookworm-slim AS build
ENV CI=true
RUN npm install -g pnpm@10
WORKDIR /app

# Manifests first so dependency installation is cached across source changes.
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
RUN pnpm run typecheck:libs && pnpm --filter @workspace/api-server run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
RUN groupadd --system vessel && useradd --system --gid vessel --home /app vessel
COPY --from=build --chown=vessel:vessel /app/artifacts/api-server/dist ./dist
COPY --from=build --chown=vessel:vessel /app/lib/db/drizzle ./dist/migrations
USER vessel
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
