# Local development

How to run Vessel on your own machine, edit it, and check your changes. If
you only want to run it for yourself, the README's quick start is enough;
this page is the longer version with the "why".

## What runs where

| Piece             | Package                 | Local port | Started by                  |
| ----------------- | ----------------------- | ---------- | --------------------------- |
| Web client (Vite) | `@workspace/vessel`     | `5173`     | `pnpm dev:web` / `pnpm dev` |
| API (Express 5)   | `@workspace/api-server` | `3001`     | `pnpm dev:api` / `pnpm dev` |
| PostgreSQL 17     | `compose.yaml`          | `5434`     | `pnpm dev:db`               |

The web client calls the API with relative `/api/...` URLs. In a deployment
Caddy routes those to the API container; locally the Vite dev server proxies
them to `http://localhost:3001` instead (see `VESSEL_API_PROXY_TARGET` in
`artifacts/vessel/vite.config.ts`). Live media, identity and file storage do
not go through the API at all — they talk to the relays and storage server
configured on the browser side (below).

## Prerequisites

- Node.js 24 (what CI and the Docker images use)
- pnpm 9 or newer (`corepack enable` or `npm i -g pnpm`)
- Docker Desktop, or your own PostgreSQL 14+

## First-time setup

```bash
pnpm install          # installs every workspace package
cp .env.example .env  # server-side settings; git-ignored
pnpm dev:db           # starts PostgreSQL in Docker and waits until healthy
pnpm db:migrate       # creates the tables from lib/db/drizzle
```

If you run your own PostgreSQL, skip `pnpm dev:db` and set `DATABASE_URL`
in `.env` to point at it.

Optional, browser-side settings: copy `artifacts/vessel/.env.example` to
`artifacts/vessel/.env.local` to change relays, the storage server or
branding. The defaults use public infrastructure and work out of the box.

## Day-to-day

```bash
pnpm dev        # API + web client together, output prefixed per app
pnpm dev:api    # API only  (builds with esbuild, then starts node)
pnpm dev:web    # web only  (Vite with hot reload)
```

Open <http://localhost:5173>. The API answers at
<http://localhost:3001/api/healthz>, and the same path through the proxy at
<http://localhost:5173/api/healthz>.

Hot reload: the web client reloads on save. The API does not watch files —
restart `pnpm dev:api` after changing anything under `artifacts/api-server`
or `lib/`.

Stopping the database: `docker compose down` keeps your data in the
`vessel_vessel-pgdata` volume; `docker compose down -v` wipes it.

Schema changes: edit `lib/db/src/schema`, then

```bash
pnpm db:generate --name what_changed   # writes lib/db/drizzle/NNNN_what_changed.sql
pnpm db:migrate                        # applies it to your database
```

and commit the SQL with the schema. `pnpm db:push` still works for a
throwaway database, but production only ever runs the SQL files
(OPERATIONS.md § 11).

## Checks before you push

```bash
pnpm typecheck   # TypeScript project refs + every app
pnpm test        # vitest in api-server (supertest) and vessel (jsdom)
pnpm exec prettier --write .   # formatting
```

CI (`.github/workflows/ci.yml`) runs the typecheck, the tests, both
production builds, and a check that the generated API clients match
`lib/api-spec/openapi.yaml` (run `pnpm --filter @workspace/api-spec run codegen`
after editing the spec). A second workflow builds the Docker images.

`pnpm test` runs every package and keeps going after a failure, so both
suites report. On Node 25 and newer the web tests rely on
`artifacts/vessel/vitest.setup.ts` to provide `localStorage` (newer Node
pre-defines it as `undefined`); there is nothing to do unless you move it.

`pnpm test` also runs the copy guard (`artifacts/vessel/src/copy-guard.test.ts`),
which fails if protocol or implementation jargon (Nostr, nsec, relay,
Blossom, signer and so on) reaches a user-facing string on any screen. Fix
the wording; only add to its allowlist for strings that are genuinely
developer-facing.

Commits need a DCO sign-off: `git commit -s`. See `CONTRIBUTING.md`.

## Environment variables

Server side, in `/.env` (loaded by `scripts/dev.sh`, which every `dev:*`
script goes through):

| Variable                  | Default                                   | Used by                    |
| ------------------------- | ----------------------------------------- | -------------------------- |
| `DATABASE_URL`            | the Docker PostgreSQL from `compose.yaml` | API, `pnpm db:migrate`     |
| `API_PORT`                | `3001`                                    | becomes `PORT` for the API |
| `WEB_PORT`                | `5173`                                    | becomes `PORT` for Vite    |
| `BASE_PATH`               | `/`                                       | web client base path       |
| `VESSEL_API_PROXY_TARGET` | `http://localhost:$API_PORT`              | Vite dev proxy for `/api`  |
| `LOG_LEVEL`               | `info`                                    | API (pino)                 |

Why the indirection: both apps read `PORT` and nothing in the repo loads
`.env` files (deployments inject variables themselves). `scripts/dev.sh` sources
`.env` and hands each app the port it needs.

Browser side, in `artifacts/vessel/.env.local` (read by Vite, shipped to
the browser, never secret): `VITE_MOQ_RELAY_URL`, `VITE_BLOSSOM_SERVER`,
`VITE_NOSTR_RELAYS`, `VITE_APP_NAME`, `VITE_APP_TAGLINE`. The example file
documents each one.

Production knobs (rate limits, helmet, CSP enforce) are in
`OPERATIONS.md` and are not needed locally.

## Where things live

```
artifacts/
  api-server/src/
    app.ts              Express app: helmet, CORS, rate limits, /api router
    routes/             sessions, recordings, vault, health
    middlewares/        NIP-98 signed-request auth, rate limiting, errors
    tests/              vitest + supertest
  vessel/src/
    App.tsx             wouter routes
    pages/              one file per route
    components/         UI, grouped by feature (studio, vault, onboarding…)
    hooks/              media capture, transports, recording
    lib/                recorder, WebRTC mesh, session API calls, archives
    store/              zustand stores
    workers/            background workers (file hashing)
lib/
  db/                   Drizzle schema + pg pool  (`pnpm --filter @workspace/db run push`)
  api-zod/              request/response schemas shared by API and client
  api-client-react/     generated fetch client + TanStack Query hooks
  api-spec/             OpenAPI source; `pnpm --filter @workspace/api-spec run codegen`
```

Changing the API contract: edit the OpenAPI spec in `lib/api-spec`, run its
`codegen` script to regenerate `lib/api-client-react`, then update the zod
schemas in `lib/api-zod` and the route in `artifacts/api-server`.

Changing the database schema: edit `lib/db/src/schema/*.ts`, then
`pnpm db:generate --name <what_changed>` and `pnpm db:migrate` (see above).

## macOS note

`pnpm-workspace.yaml` removes most platform-specific native binaries from
the lockfile. The macOS (`darwin-*`) and Linux glibc (`linux-x64`,
`linux-arm64`) entries for esbuild, lightningcss, Tailwind's oxide and rollup
are kept, so the workspace installs on a Mac and in the Docker images. If you add a dependency that ships native
binaries and it fails to load locally, check that list first.
