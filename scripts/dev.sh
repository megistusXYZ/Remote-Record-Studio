#!/usr/bin/env sh
# Local development helper.
#
# Loads ./.env (git-ignored; copy it from .env.example) into the environment,
# then runs one workspace task with the port it needs. Deployments inject these
# variables itself, so this script is only used for local development.
#
#   sh scripts/dev.sh api       build + start the API server     (pnpm dev:api)
#   sh scripts/dev.sh web       start the Vite dev server        (pnpm dev:web)
#   sh scripts/dev.sh db:push      push the schema straight to the dev database (pnpm db:push)
#   sh scripts/dev.sh db:generate  write a SQL migration from schema changes     (pnpm db:generate)
#   sh scripts/dev.sh db:migrate   apply pending SQL migrations                  (pnpm db:migrate)
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

: "${API_PORT:=3001}"
: "${WEB_PORT:=5173}"
: "${BASE_PATH:=/}"

case "${1:-}" in
  api)
    PORT="$API_PORT" exec pnpm --filter @workspace/api-server run dev
    ;;
  web)
    PORT="$WEB_PORT" \
    BASE_PATH="$BASE_PATH" \
    VESSEL_API_PROXY_TARGET="${VESSEL_API_PROXY_TARGET:-http://localhost:$API_PORT}" \
      exec pnpm --filter @workspace/vessel run dev
    ;;
  db:push)
    exec pnpm --filter @workspace/db run push
    ;;
  db:generate)
    shift
    exec pnpm --filter @workspace/db run generate "$@"
    ;;
  db:migrate)
    exec pnpm --filter @workspace/db run migrate
    ;;
  *)
    echo "usage: $0 api|web|db:push|db:generate|db:migrate" >&2
    exit 2
    ;;
esac
