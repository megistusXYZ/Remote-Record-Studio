# Vessel — Remote Recording Platform

## Overview

Vessel is a studio-quality remote recording platform designed to offer a polished SaaS experience for remote recording. Users can sign up with a display name and invite guests via a simple link, all while an underlying Nostr-inspired identity system (keypairs stored in localStorage) operates seamlessly in the background, hidden from the user. The platform aims to provide users with control over their voice, studio, and files.

**Product tagline:** "Your voice. Your studio. Your files."

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
    - Onboarding flow supports 2-step creator sign-up and explicit Nostr on-ramp with NIP-07, NIP-46 via paste or invite, and nsec backup key restore.
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
- `artifacts/api-server/src/routes/` — API route handlers.
- `lib/db/src/schema/` — Database schema (identities, sessions, participants, recordings).
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth).

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