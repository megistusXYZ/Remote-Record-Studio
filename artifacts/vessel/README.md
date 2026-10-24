# Vessel web client

The browser app: landing page, studio, vault and sharing. React 19, Vite,
TypeScript, Tailwind v4.

Run it from the repository root with `pnpm dev` (see
[docs/LOCAL-DEVELOPMENT.md](../../docs/LOCAL-DEVELOPMENT.md)); deploy it with
the compose stack (see [OPERATIONS.md](../../OPERATIONS.md)).

## How it works

| Concern | How | Configured by |
|---|---|---|
| Recording | Each participant records on their own device: a 48 kHz WAV master plus a camera file, written to IndexedDB as it is made, so a reload or crash loses nothing | — |
| Live preview | Peer-to-peer WebRTC between participants, with short-lived TURN credentials from the API when a network blocks direct connections | `TURN_*` on the API |
| In-call messages | Presence, chat and connection setup, encrypted under a per-session key and passed through sync servers | `VESSEL_RELAYS` / `VITE_NOSTR_RELAYS` |
| Storage | Finished files are encrypted on the device, each with its own key, then uploaded to a storage server the studio chooses | `VESSEL_STORAGE_SERVER` / `VITE_BLOSSOM_SERVER` |
| Sharing | Share links carry the key in the URL fragment, which never reaches a server | — |
| Delivery to the host | Each guest's share link is sealed to the host's key and recorded by the API | — |
| Export and transcript | An editor-ready bundle (tracks aligned, Reaper project, markers) and a speaker-labelled transcript made on the host's machine with Whisper, served by the site | — |

Deployment settings reach the browser at runtime through `/config.js`,
written by the web container from its environment; the `VITE_*` variables in
[`.env.example`](./.env.example) are the build-time equivalents.

## Scripts

```bash
pnpm --filter @workspace/vessel run dev        # dev server (needs PORT and BASE_PATH; pnpm dev sets them)
pnpm --filter @workspace/vessel run build      # production build into dist/public
pnpm --filter @workspace/vessel run test       # vitest
pnpm --filter @workspace/vessel run typecheck
```

`dev` and `build` first copy the background-blur runtime and fetch the speech
model into `public/` (both git-ignored); set `VESSEL_SKIP_MODEL=1` to skip the
model download.

## Headers

The dev and preview servers send the same security headers as the
production Caddy configuration (`deploy/Caddyfile`): cross-origin isolation
(`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy:
credentialless`), `Referrer-Policy: no-referrer`, a Permissions-Policy, and a
Content-Security-Policy that ships in report-only mode until
`VESSEL_CSP_ENFORCE=true`.

## Copy rules

User-facing text never names the underlying protocols. `src/copy-guard.test.ts`
fails the build if it does; the glossary lives in the test.

## License

AGPL-3.0, see the repository root.
