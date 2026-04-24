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
- `/vault` — Vault home (sidebar nav + session-grouped recordings + per-track download)
- `/settings` — General settings + collapsible Advanced (storage URL, relay URL, backup key, danger zone)

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
- `artifacts/vessel/src/components/studio/SavingOverlay.tsx` — "Saving your session..." overlay with per-participant progress bars (component built; superseded by SessionComplete in Module 4).

### Recording Engine + Vault Redesign (Module 4)
- `artifacts/vessel/src/lib/recorder.ts` — `ChunkedRecorder` class wrapping `MediaRecorder`. Picks best supported MIME type (vp9/vp8/webm fallback chain), accumulates `Blob` chunks via 5s timeslices, emits friendly events (`recording-started`, `chunk-saved-locally`, `recording-complete`). Returns final `Blob` from `stop()`.
- `artifacts/vessel/src/lib/blossom.ts` — `BlossomUploadQueue` STUB. Simulates chunked upload to a storage server (~220ms per chunk, ~12 chunks per file), emits `sync-started`/`chunk-synced`/`sync-complete` events with `{ synced, total, percent, failed }` progress. Computes SHA-256 of the final blob via `crypto.subtle`. Real Blossom HTTP upload comes in a later module.
- `artifacts/vessel/src/lib/recordings-storage.ts` — IndexedDB persistence for final recording blobs. `saveRecordingBlob(id, blob)`, `loadRecordingBlob(id)`, `deleteRecordingBlob(id)`, `clearAllLocalRecordings()`, `downloadBlob(blob, filename)`, `downloadRecordingById(id, filename)`. Uses URL scheme `idb://<recordingId>` to mark blobs that live only locally (vs. real remote URLs).
- `artifacts/vessel/src/hooks/use-recording.ts` — React hook orchestrating the full recording lifecycle: owns one `ChunkedRecorder` + one `BlossomUploadQueue` per recording. Returns `{ start, stop, isRecording, isFinalizing, isSyncing, syncProgress, syncStatus, result, error, isSupported, reset }`. On `stop()`: finalizes blob → saves to IndexedDB → triggers simulated sync → returns `RecordingResult { recordingId, blob, meta, blobHash, blobUrl, syncStatus }`.
- `artifacts/vessel/src/components/studio/SessionComplete.tsx` — Full-screen overlay with two phases. Phase 1 (syncing): pulsing waveform SVG + per-track progress bars (avatar + name + percent + spinner→checkmark). Phase 2 (complete): animated checkmark SVG + canvas-based confetti burst (no external lib) + per-track download cards (Download Track / Copy Link buttons) + View Vault / Start New CTAs. Guest variant: smaller "Thanks for recording with X" card with optional download + Close.
- `artifacts/vessel/src/components/vault/VaultSidebar.tsx` — Left rail nav with three items (My Vault, Shared with Me, Settings) + sticky "+ New Session" CTA at the bottom. Used by both VaultScreen and SettingsScreen.
- `artifacts/vessel/src/components/vault/EmptyState.tsx` — Reusable empty state with mic+sparkle SVG illustration.
- `artifacts/vessel/src/components/vault/VaultScreen.tsx` — Owns the full-screen layout (sidebar + main). Fetches via `useListRecordings({ pubkey })`, groups recordings by `sessionId` into session cards. Each card: title + date + total size + participant chips + "Download All" + "View Tracks" expand. Expanded state lists individual track rows with per-track download (calls `downloadRecordingById`).
- `artifacts/vessel/src/components/vault/SettingsScreen.tsx` — General section (display name save, 8-color avatar swatch picker persisted in `localStorage` key `vessel_avatar_color`, default invite message in `vessel_invite_message`) + collapsible Advanced section (storage URL `vessel_storage_url`, live preview relay URL `vessel_relay_url`, Show/Copy backup key, danger zone with `clearAllLocalRecordings()` + `signOut()`).
- `artifacts/vessel/src/pages/vault.tsx` + `pages/settings.tsx` — Thin wrappers that gate on identity then render the new screens (no Layout wrapper since the screens own the full viewport).
- **Integration in StudioScreen**: Auto-starts the recorder when `session.status === "live"` and a localStream is ready (with retry on failure — ref clears on catch). On Stop click (host), shows SessionComplete overlay, awaits sync completion, POSTs metadata via `useCreateRecording` (guarded by `recordingPersistedRef`, promise tracked on `persistPromiseRef`). When the host clicks "View in Vault" / "Start New Session", awaits the persistence promise BEFORE calling `onStopRecording` (PATCH ended) and navigating — so we never lose track records on unmount. Guests are auto-shown the SessionComplete (guest variant) when `session.status` flips to "ended" while they're recording, ensuring their track is finalized + persisted before they navigate away.
- **Forbidden-term audit**: identifier names (e.g., `participantPubkey`, `deriveAvatarColorFromPubkey`) may contain forbidden words; rendered UI strings must not. The terms `Nostr / nsec / npub / keypair / pubkey / Blossom / MoQ / WebTransport / MediaRecorder / getUserMedia / IndexedDB / QUIC` never appear in user-visible text in any Module 4 file.
- **Known limitations**: (1) Recorder is locked to the initial localStream — switching camera/mic mid-recording does not rebind the active recorder. (2) IndexedDB is unbounded — no quota check yet; future module should add retention limits. (3) Real Blossom upload is still simulated — chunks aren't actually sent to a remote server.

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
