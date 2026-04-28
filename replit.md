# Vessel — Remote Recording Platform

## Overview

Vessel is a studio-quality remote recording platform designed to offer a polished SaaS experience for remote recording. Users can sign up with a display name and invite guests via a simple link, all while an underlying Nostr-inspired identity system (keypairs stored in localStorage) operates seamlessly in the background, hidden from the user. The platform aims to provide users with control over their voice, studio, and files.

**Product tagline:** "Your voice. Your studio. Your files."

**License:** AGPL-3.0-or-later (root `LICENSE`). Repo includes `CONTRIBUTING.md` (DCO sign-off required), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md`, `NOTICE.md` (third-party asset attributions), and `RELEASING.md` (maintainer release process). Placeholder contact addresses (`security@vessel.example`, `conduct@vessel.example`) need to be replaced with real ones once a project domain is set up.

**Release process:** Pushing a SemVer tag (`vX.Y.Z`, optionally with `-prerelease` suffix) to `main` triggers `.github/workflows/release.yml`, which verifies the tag is on `main`, runs `pnpm run build`, and publishes a GitHub Release with auto-generated notes. Notes are categorized by PR labels via `.github/release.yml` (breaking / feature / bug / performance / security / documentation; `chore`, `dependencies`, `ignore-for-release` are excluded). Tags with a hyphenated suffix are auto-marked as pre-releases. README badge row includes a "latest release" badge. See `RELEASING.md` for the full procedure.

## User Preferences

- **Key principle**: Never mention "Nostr", "Blossom", "keypair", "relay" in any UI text.
- The terms `Nostr / nsec / npub / keypair / pubkey / Blossom / MoQ / WebTransport / MediaRecorder / getUserMedia / IndexedDB / QUIC` never appear in user-visible text.
- The only exception for Nostr terms in UI text: `BackupKeySignInModal` may show "nsec1…" because the user is explicitly importing one.
- The "Archive Info" tab in the Share Modal uses the user-friendly label "Archive ID" — never says "naddr" or "Nostr".

## System Architecture

**Monorepo and Core Technologies:**
- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24, **Package manager**: pnpm, **TypeScript version**: 5.9
- **API framework**: Express 5, **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Frontend**: React + Vite + TypeScript (artifact: `vessel`, path: `/`)
- **Styling**: Tailwind CSS v4 + custom CSS variables (Broadcast Dark design system)
- **Build**: esbuild (CJS bundle for API server)

**Design System — "Broadcast Dark":**
- **Fonts**: Syne (display/headlines), DM Sans (body/UI), JetBrains Mono (technical)
- **Accent color**: `#00d4aa` (mint/teal)
- **Background**: `#080b0f` (near-black with blue tint)

**Application Artifacts:**
- **vessel** — React + Vite frontend (path: `/`)
- **api-server** — Express 5 REST API (path: `/api`)

**Key Features and Implementations:**

- **Identity and Onboarding:**
    - Pluggable signer architecture (`VesselIdentity`) supporting local, extension, and remote signers.
    - Local-key identities store encrypted `_secretKey` derived from `displayName + deviceFingerprint`.
    - Three sign-in builders: `signInWithExtension` (NIP-07), `signInWithRemoteSigner` (NIP-46), and `startNostrConnectInvite`.
    - Zustand store (`identityStore`) manages identity state, with async `signOut` for cleanup.
    - Onboarding flow supports 3-step creator sign-up (name → storage → forced backup-key step gated by confirmation checkbox → welcome) and explicit Nostr on-ramp with NIP-07, NIP-46 via paste or invite, and nsec backup key restore.
    - Guest join flow is zero-friction, requiring explicit consent.

- **Lobby & Session Management:**
    - Session API wrappers for creation, joining, cancellation, and invite URL generation.
    - Lobby screen manages creation, joining, and displays waiting room with invite links, QR, and participant lists.
    - Participants are represented by animated cards with avatars, roles, and status indicators.

- **Studio Experience:**
    - Transport layer abstraction (`moq.ts`) with connection quality assessment.
    - Media device management (`useMediaDevices`, `useLocalStream`) for camera/mic selection and local stream acquisition/control.
    - Studio screen includes header, media error/WebTransport degradation banners, video grid, and control bar.
    - Video grid auto-fits participants; video tiles display muted local video, avatars, audio meters, and status.
    - Control bar includes device picker, mic/cam toggles, and a host-only record button.

- **Recording Engine & Vault:**
    - `ChunkedRecorder` class for `MediaRecorder` integration, supporting best MIME types, chunk accumulation, and event emission.
    - `BlossomUploadQueue` STUB simulates chunked uploads with progress events and SHA-256 computation.
    - IndexedDB (`recordings-storage.ts`) for persistence of recording blobs, with download functionality.
    - `use-recording` hook orchestrates the full recording lifecycle: start, stop, finalize, persist to IndexedDB, and trigger simulated sync.
    - `SessionComplete` overlay handles syncing progress, confetti animation, and displays per-track download cards.
    - Vault redesign includes a sidebar navigation, session-grouped recordings, and track-level download options.
    - Settings screen allows display name, avatar color, invite message customization, and advanced options (storage URL, relay URL, backup key, data clearing).

- **Sharing, Polish & Final Module:**
    - `publishSessionArchive` builds and signs Kind 1063 (per-track) and Kind 30563 (manifest) NIP-94 inspired events.
    - `ShareModal` offers three tabs for sharing, auto-archiving on open, and copy-to-clipboard functionality.
    - `use-keyboard-shortcuts` hook for global keyboard shortcuts, with modifiers and native key target handling.
    - Enhanced empty states for lobby and waiting rooms.
    - Improved landing page SEO metadata.

**Storage Policy:**
- Full identity (`vessel_identity_v2` in `localStorage`): encrypted nsec + displayName + optional email, persistent.
- Guest identity (`vessel_identity_v2` in `sessionStorage`): same encrypted shape but ephemeral.
- Encryption strength is for convenience; future modules may add opt-in PIN/passphrase.

**API Conventions:**
- `GET /api/sessions/:idOrInvite` and `POST /api/sessions/:idOrInvite/join` accept session UUID or 8-char invite code, resolved server-side.
- Join responses always return the real session UUID for client navigation.

**Key File Locations:**
- `artifacts/vessel/src/index.css` — Broadcast Dark design system.
- `artifacts/vessel/public/` — Branded PWA assets (favicon.svg, pwa-192/512, apple-touch-icon, maskable). Regenerate with `node scripts/generate-pwa-icons.mjs` after editing favicon.svg.
- `artifacts/vessel/vite.config.ts` — VitePWA plugin config: manifest icons, workbox precache (excludes oversized hero art), iOS-friendly standalone display.
- `artifacts/api-server/src/routes/` — API route handlers.
- `lib/db/src/schema/` — Database schema (identities, sessions, participants, recordings).
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth).

### Quick Record (Solo)

A standalone, single-person recording flow at `/record` for users who don't need a multi-person session — think "instant Loom-style clip". No invite, no scheduling, no second participant required.

- **Entry points**: dedicated card on the dashboard (`LobbyScreen` default state), desktop header nav, and direct deep-link.
- **Component**: `artifacts/vessel/src/components/record/SoloRecordScreen.tsx` (page wrapper at `artifacts/vessel/src/pages/record.tsx`, route registered in `App.tsx`).
- **Reuses every existing recording primitive** — no studio code is touched:
  - `useMediaDevices` + `useLocalStream` for camera/mic acquisition and device selection.
  - `useScreenShare` for optional screen + system-audio capture.
  - `useRecording` for the camera+mic track recorder.
  - `useScreenRecording` for the parallel screen-clip recorder (mirrored on/off via the same effect pattern as the studio).
  - `publishPersonalArchive` (`lib/session-archive.ts`) auto-archives on stop with a `quick-record:<recordingId>` sentinel session id and the title "Quick Record".
  - `rememberPersonalReceipt` persists the share/receipt URLs locally.
- **State machine**: `setup → recording → finalizing → done` (with an `error` branch). On `done` the share URL is auto-copied to the clipboard. Partial publish failures show a non-fatal warning chip but still surface the URL.
- **System-audio guidance copy**: explicit, jargon-free wording ("Entire Screen / A Tab", "Share audio", "Chrome and Edge"). No technical terms from the forbidden vocabulary list ever reach the UI.
- **V1 scope**: Quick Records do not write a vault row (no `createRecording` API call) — they live as personal archives + receipts only. Vault integration is intentional follow-up work once Solo Quick-Loom is validated.
- **Mobile FAB**: the existing `MobileBottomNav` "Record" FAB still routes to `/session/new` to preserve current behavior; mobile users reach Quick Record via the dashboard card.
- **Tests**: `SoloRecordScreen.test.tsx` covers the gating, full state-machine happy path, the publish-failure warning path, the empty-recorder error path, and pins the system-audio hint copy against forbidden vocabulary.

## External Dependencies

- **Node.js**: 24
- **TypeScript**: 5.9
- **Express**: 5 (API framework)
- **PostgreSQL**: (Database)
- **Drizzle ORM**: (Database ORM)
- **Zod**: (`zod/v4` for validation)
- **Orval**: (API codegen from OpenAPI)
- **React**: (Frontend library)
- **Vite**: (Frontend build tool)
- **Tailwind CSS**: v4 (Styling framework)
- **esbuild**: (Build tool for API server)
- **applesauce-signers**: (For pluggable signer architecture)
- **zustand**: (State management library)
- **qrcode.react**: (For QR code generation)
- **framer-motion**: (For animations, e.g., record button morph)
- **nostr-tools/pure**: (For `finalizeEvent` in session archiving)
- **Web Share API**: (For sharing invite links)
- **IndexedDB**: (Browser-side storage for recording blobs)