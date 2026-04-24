# Vessel — Remote Recording Platform

## Overview

**Vessel** is a studio-quality remote recording platform. To users it looks and feels like a polished SaaS product. Users sign up with just a display name and can invite guests via a simple link. Under the hood it uses a Nostr-inspired identity system (keypairs stored in localStorage) — users never see any of this.

**Product tagline:** "Your voice. Your studio. Your files."

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + TypeScript (artifact: `vessel`, path: `/`)
- **Styling**: Tailwind CSS v4 + custom CSS variables (Broadcast Dark design system)
- **Build**: esbuild (CJS bundle for API server)

## Design System — "Broadcast Dark"

- **Fonts**: Syne (display/headlines), DM Sans (body/UI), JetBrains Mono (technical)
- **Accent color**: `#00d4aa` (mint/teal)
- **Background**: `#080b0f` (near-black with blue tint)
- **Key principle**: Never mention "Nostr", "Blossom", "keypair", "relay" in any UI text

## Artifacts

- **vessel** — React + Vite frontend (path: `/`)
- **api-server** — Express 5 REST API (path: `/api`)

## Pages

- `/` — Onboarding (name entry, generates identity silently)
- `/home` — Dashboard (vault stats, recent sessions + recordings)
- `/session/new` — Create a new recording session
- `/session/:id` — Studio room (recording controls, participants, invite link)
- `/join/:inviteCode` — Guest join flow
- `/vault` — Recordings list
- `/settings` — Profile settings + Advanced (identity export)

## Key Files

- `artifacts/vessel/src/hooks/use-identity.ts` — Identity abstraction (hides keypair)
- `artifacts/vessel/src/pages/` — All page components
- `artifacts/api-server/src/routes/` — API route handlers
- `lib/db/src/schema/` — Database schema (identities, sessions, participants, recordings)
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Architecture Notes

- Identity (pubkey + displayName) is stored in `localStorage` under key `vessel_identity`
- Pubkey is a 32-byte random hex string (Nostr-compatible format, but Nostr is never mentioned in UI)
- API endpoints require `pubkey` as a query param for user-scoped requests
- The `api-zod/src/index.ts` only exports from `./generated/api` (NOT `./generated/types`) to avoid duplicate export conflicts after codegen — must be fixed after each codegen run if the types directory gets regenerated
