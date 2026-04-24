# Vessel — Remote Recording Platform

## Overview

Vessel is a studio-quality remote recording platform designed to offer a polished SaaS experience for remote recording. It simplifies the user journey, allowing sign-ups with just a display name and enabling guest invitations via a simple link. The project aims to provide users with full control over their audio ("Your voice. Your studio. Your files."). It leverages a Nostr-inspired identity system, abstracting away complex cryptographic details from the end-user. The platform focuses on delivering high-quality audio and video recording capabilities, secure storage, and intuitive session management.

## User Preferences

- Never mention "Nostr", "Blossom", "keypair", "relay" in any UI text.
- Do not mention `Nostr / nsec / npub / keypair / pubkey / Blossom / MoQ / WebTransport / MediaRecorder / getUserMedia / IndexedDB / QUIC` in user-visible text.
- The only exception for forbidden terms is `BackupKeySignInModal` which may show "nsec1…" because the user is explicitly importing one.

## System Architecture

Vessel is built as a monorepo using `pnpm workspaces`, targeting Node.js 24 and TypeScript 5.9.

**Frontend (`vessel` artifact):**
- **Framework:** React with Vite.
- **Styling:** Tailwind CSS v4, augmented with custom CSS variables as part of the "Broadcast Dark" design system.
- **Design System:** "Broadcast Dark" features Syne (headlines), DM Sans (body/UI), and JetBrains Mono (technical) fonts. The primary accent color is `#00d4aa` (mint/teal) on a near-black background (`#080b0f`).
- **Identity Management:** Pluggable signer architecture with three on-ramps: (1) **local studio key** (default one-tap path — generates an in-memory secret encrypted at rest with AES-GCM keyed off displayName + device fingerprint), (2) **browser extension** (NIP-07 via `applesauce-signers/ExtensionSigner`), (3) **remote signer** (NIP-46 via `applesauce-signers/NostrConnectSigner`). The remote-signer surface offers two NIP-46 sub-flows: pasting a signer-issued `bunker://` URL, OR generating a `nostrconnect://` invite (URL + QR) for the user to approve inside their signer app — paste is intentionally bunker-only because a foreign `nostrconnect://` URL carries the original client privkey implicitly and can't be honored from the outside. All event signing flows through `identity._signer.signEvent(...)` — no call site touches `_secretKey` directly. Storage v3 (`vessel_identity_v3`) auto-migrates from legacy v2; rename re-encrypts persisted secrets so the new displayName-derived key still decrypts on reload. On reload, extension identities re-validate the live extension pubkey against the stored one and clear if the user switched accounts; remote identities proactively re-open their relay subscription so signing is ready before the first archive event. Sign-out tears down the NIP-46 transport before clearing identity. The word "Nostr" is allowed in the user-visible UI only on this explicit sign-in surface (per product brief); everywhere else the broader brand-substitute terms apply. See `lib/identity.ts`, `lib/relay-pool.ts`, `hooks/use-identity.ts`, `components/onboarding/NostrSignInModal.tsx`.
- **Session Management:** Provides functionalities for creating, joining, canceling sessions, and generating invite links.
- **Studio:** Features include media device management (`use-media-devices.ts`), a flexible video grid (`VideoGrid.tsx`), and a control bar (`ControlBar.tsx`) for recording and device settings.
- **Recording Engine:** Uses `ChunkedRecorder` (wrapping `MediaRecorder`) to capture audio/video, storing chunks locally in IndexedDB (`recordings-storage.ts`).
- **Vault:** A dashboard for managing recordings, grouped by session, with options for per-track downloads and sharing.
- **Sharing:** Implements `publishSessionArchive` to create NIP-94 inspired session archives (Kind 1063 for tracks, Kind 30563 for manifest).
- **UI Pages:** Includes a marketing landing page (`/`), onboarding (`/start`), home dashboard (`/home`), session creation (`/session/new`), the studio room (`/session/:id`), guest join flow (`/join/:inviteCode`), vault (`/vault`), and settings (`/settings`).
- **Key UI Components:** Reusable design primitives are located in `artifacts/vessel/src/components/vessel-ui/`.

**Backend (`api-server` artifact):**
- **Framework:** Express 5.
- **Database:** PostgreSQL with Drizzle ORM.
- **Validation:** Zod (`zod/v4`) and `drizzle-zod`.
- **API Definition:** OpenAPI spec (`openapi.yaml`) is the source of truth, with Orval used for API codegen.
- **Routes:** API route handlers are organized in `artifacts/api-server/src/routes/`.
- **Database Schema:** Defined in `lib/db/src/schema/` (identities, sessions, participants, recordings).
- **API Conventions:** `GET /api/sessions/:idOrInvite` and `POST /api/sessions/:idOrInvite/join` accept either a session UUID or an 8-character invite code, resolved server-side. User-scoped requests require `pubkey` as a query parameter.

**General Architecture Notes:**
- Identity is stored in `localStorage` (`vessel_identity_v3`) — local-key identities encrypt the secret with AES-GCM, extension identities store only signerType + pubkey, remote identities store the bunker URL + relays + encrypted client-side NIP-46 secret. Guest identities live in `sessionStorage`. Legacy `vessel_identity_v2` blobs are migrated forward on first load and then removed.
- All key commands are executed using `pnpm`.

## External Dependencies

- **Database:** PostgreSQL
- **ORM:** Drizzle ORM
- **API Codegen:** Orval
- **Styling:** Tailwind CSS
- **Identity/Cryptography:** `nostr-tools`, `applesauce-signers` (`PrivateKeySigner` for local keys, `ExtensionSigner` for NIP-07 browser extensions, `NostrConnectSigner` for NIP-46 remote signers — all lazy-wired through a shared relay pool in `lib/relay-pool.ts`)
- **State Management:** Zustand
- **QR Code Generation:** `qrcode.react`