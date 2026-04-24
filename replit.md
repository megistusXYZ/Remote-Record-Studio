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

- `/` — Landing page (marketing; auto-redirects to /home if identity exists in localStorage)
- `/start` — Onboarding (name entry, generates identity silently, redirects to /home)
- `/home` — Dashboard (vault stats, recent sessions + recordings)
- `/session/new` — Create a new recording session
- `/session/:id` — Studio room (recording controls, participants, invite link)
- `/join/:inviteCode` — Guest join flow (invite code is resolved to real session UUID on the backend)
- `/vault` — Recordings list
- `/settings` — Profile settings + Advanced (identity export)

## Key Files

### Identity / Onboarding (Module 1)
- `artifacts/vessel/src/lib/identity.ts` — Identity abstraction. Generates real Nostr keypairs (nostr-tools), encrypts the secret key (nsec) with AES-GCM (PBKDF2-SHA256, 100k iterations) using a key derived silently from displayName + a deviceFingerprint stored in localStorage. Lazy-loads applesauce-signers/SimpleSigner.
- `artifacts/vessel/src/store/identityStore.ts` — Zustand store with promise-cached `hydrate()` for React StrictMode safety.
- `artifacts/vessel/src/hooks/use-identity.ts` — React hook wrapping the store. Backward-compatible (pubkey, displayName, setDisplayName, isLoaded) plus new methods (createNewIdentity, createGuestIdentity, importFromBackup, signOut, identity, avatarColor, isGuest).
- `artifacts/vessel/src/components/onboarding/SignUpScreen.tsx` — 2-step creator sign-up with animated checkmark; ref-locked submission for race-safety.
- `artifacts/vessel/src/components/onboarding/BackupKeySignInModal.tsx` — Power-user nsec restore modal.
- `artifacts/vessel/src/components/onboarding/GuestJoinScreen.tsx` — Zero-friction guest join; fetches session via invite code, shows host avatar, requires explicit consent.

### Lobby & Session Management (Module 2)
- `artifacts/vessel/src/lib/session.ts` — Session API wrappers: `createSession(identity, { title })`, `joinSession(idOrInvite, identity)`, `cancelSession(id)`, `buildInviteUrl(inviteCode)` (returns canonical `/join/:code` URL), `extractInviteCodeFromInput(raw)` (handles full URLs OR bare codes — supports both new `/join/:code` and legacy `?session=` formats).
- `artifacts/vessel/src/components/lobby/LobbyScreen.tsx` — Main lobby with two states: `default` (greeting + create card + join card + recent sessions sidebar) and `waitingRoom` (invite link + QR + participant list + Start/Cancel). Pure presentational; all mutations come through props.
- `artifacts/vessel/src/components/lobby/InviteModal.tsx` — Dialog with copy-to-clipboard + QR code (qrcode.react) + Web Share API.
- `artifacts/vessel/src/components/lobby/ParticipantCard.tsx` — Animated participant row with avatar (color from pubkey), role/you badge, status dot, mic/cam icons.
- `artifacts/vessel/src/pages/home.tsx` — Thin orchestrator wiring LobbyScreen state="default" with createSession/joinSession handlers; redirects to `/` if no identity.
- `artifacts/vessel/src/pages/session-studio.tsx` — Routes by `session.status`: `waiting` → LobbyScreen waitingRoom, `live` → StudioScreen, `ended` → auto-redirect to `/vault`. Polls every 3s while waiting. Wires handleStartRecording (PATCH live), handleStopRecording (PATCH ended → /vault), handleCancelSession, handleLeave.

### Studio (Module 3)
- `artifacts/vessel/src/lib/moq.ts` — Transport layer abstraction. `isWebTransportAvailable()` (capability detect), `useConnectionQuality()` hook (reads `navigator.connection.effectiveType` → good/fair/poor/unknown), `getConnectionQualityLabel()` (friendly text), `connectMoQ()` stub. No real peer streaming yet — wired in a future module.
- `artifacts/vessel/src/hooks/use-media-devices.ts` — Two hooks: `useMediaDevices()` (enumerateDevices, persists camera/mic selection in localStorage, refreshes on devicechange) and `useLocalStream({ cameraId, micId, cameraEnabled, micEnabled })` (getUserMedia with capability guard, race-safe with cancellation flag, auto-stops superseded tracks, friendly error messages for NotAllowed/NotFound/NotReadable, toggles `track.enabled` for mute/cam-off without re-acquisition).
- `artifacts/vessel/src/components/studio/StudioScreen.tsx` — Main wrapper. Header (wordmark + session title + recording status/timer + connection quality dots + participant count). Two banners: media-error (red) + WebTransport-degradation (amber, says "Live preview is limited in this browser. Your recording will still be full quality."). VideoGrid + ControlBar + InviteModal. Recording timer ticks only while status="live", resets otherwise. Local participant gets real MediaStream; remote participants render avatar fallback (no peer streams yet).
- `artifacts/vessel/src/components/studio/VideoGrid.tsx` — Auto-fit grid (1 → max-w-720 centered, 2 → 2-col, 3-4 → 2x2, 5+ → 3-col on lg).
- `artifacts/vessel/src/components/studio/VideoTile.tsx` — Tile with `<video muted>` (local only, prevents echo) OR avatar fallback OR shimmer placeholder. Bottom-left name pill + bottom-right AudioMeter + top-left LOCAL badge + red border + mic-off icon when muted.
- `artifacts/vessel/src/components/studio/ControlBar.tsx` — Fixed-bottom bar (h-20). Three groups: settings (DevicePickerPopover trigger), center (mic + cam 56px round buttons + framer-motion morphing record button visible to host only — animates green→red on record), right (Invite + Leave with confirm). Timer label "Stop · MM:SS" or "HH:MM:SS" below record button.
- `artifacts/vessel/src/components/studio/DevicePickerPopover.tsx` — shadcn Popover content with camera list + mic list + live preview thumbnail.
- `artifacts/vessel/src/components/studio/SavingOverlay.tsx` — "Saving your session..." overlay with per-participant progress bars (component built; not yet wired into the flow — pending real upload integration in a future module).

### Landing & UI Primitives (Module 0)
- `artifacts/vessel/src/pages/landing.tsx` — Marketing landing page (hero, features, how-it-works, comparison, footer). Handles `?session=XXX` query → redirect to `/join/XXX`.
- `artifacts/vessel/src/components/vessel-ui/` — Design primitives (VesselButton, VesselCard, VesselBadge, AudioMeter, RecordingDot)
- `artifacts/vessel/src/pages/` — All page components

## Storage policy

- **Full identity** (`vessel_identity_v2` in `localStorage`): encrypted nsec + displayName + optional email. Survives across browser sessions; only way to restore is via the encrypted blob OR the user's exported nsec backup key.
- **Guest identity** (`vessel_identity_v2` in `sessionStorage`): same encrypted shape but ephemeral by design — guest pubkeys should NOT persist past tab close. This is intentional, not a bug.
- **Encryption strength** is "convenience over strong at-rest secrecy" for MVP. Key is derived from displayName+deviceFingerprint (low-entropy). A future module may add an opt-in PIN/passphrase for users who want true at-rest security.

## API conventions

- Both `GET /api/sessions/:idOrInvite` and `POST /api/sessions/:idOrInvite/join` accept either a session UUID or an 8-char invite code; the server resolves via `findSessionByIdOrInvite()` in `routes/sessions.ts`.
- Join responses always return the real session UUID; clients should navigate using that, not the invite code.

## Other Key Files

- `artifacts/vessel/src/index.css` — Broadcast Dark design system (CSS vars, Tailwind theme, utility classes)
- `artifacts/api-server/src/routes/` — API route handlers
- `lib/db/src/schema/` — Database schema (identities, sessions, participants, recordings)
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Architecture Notes

- Identity is stored in `localStorage` under key `vessel_identity_v2` as `{iv, salt, ciphertext, displayName, email}` — the `ciphertext` is the AES-GCM-encrypted nsec; the symmetric key is derived via PBKDF2-SHA256(displayName + deviceFingerprint).
- Pubkey is a real Nostr secp256k1 public key (32-byte hex), but "Nostr/nsec/npub/keypair/relay/pubkey/Blossom" must NEVER appear in normal UI text. The only exception: `BackupKeySignInModal` may show "nsec1…" because the user is explicitly importing one.
- API endpoints require `pubkey` as a query param for user-scoped requests.
- The `api-zod/src/index.ts` only exports from `./generated/api` (NOT `./generated/types`) to avoid duplicate export conflicts after codegen — must be fixed after each codegen run if the types directory gets regenerated.
