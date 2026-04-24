# Vessel

Studio-quality remote recording. No subscriptions. No cloud lock-in.

Vessel records every guest in their browser at full local quality, then hands
the master files back to *you* — not to a SaaS vault you have to keep paying
for. Bring your own server, or use the public defaults to get started in under
a minute.

---

## How it works

1. **Create a studio.** Pick a display name. Vessel generates a private studio
   key on your device — no email, no password, no account to remember.
2. **Invite your guests.** Share a single link. Anyone who opens it joins your
   studio in their browser; nothing to install.
3. **Hit record.** Each participant's microphone and camera are captured
   locally at studio quality, so a slow internet connection never lowers the
   final fidelity.
4. **End the session.** All tracks finalize and land in your Vault — separated
   per speaker, ready to drop straight into your editor.
5. **Share or hand off.** One click gets you a clean link for an editor, plus
   per-track download links for collaborators who only need their own audio.

That's the whole product. No subscription tiers, no "you've used your free
hour" pop-ups, no recordings held hostage behind a paywall. Your files belong
to you.

---

## Quick start

```bash
# from the monorepo root
pnpm install
pnpm --filter @workspace/vessel run dev
```

Open the URL printed in the console. The dev server runs at the port supplied
via the `PORT` environment variable (assigned by the workspace runtime), and
mounts under the artifact's `BASE_PATH`.

To configure infrastructure for self-hosting, copy `.env.example` to
`.env.local` and edit:

```bash
cp .env.example .env.local
```

---

## For developers

> The rest of this README is technical detail for people building or
> self-hosting Vessel. Skip it if you just want to record a podcast.

### Architecture

Vessel is a client-heavy SPA built with React 18, Vite, TypeScript, Tailwind v4
and shadcn/ui. There is no proprietary backend — Vessel speaks open protocols
and points at infrastructure you can swap out at any time.

| Concern | Protocol | Default endpoint |
|---|---|---|
| Live in-studio transport | Media-over-QUIC (MoQ) over WebTransport | `wss://relay.quic.video` |
| Finalized file storage | Blossom (HTTP blob server) | `https://blossom.primal.net` |
| Share manifests + identity | Nostr relays (NIP-94 / parameterized replaceable events kind 1063, 30563) | `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band` |
| Local cache (per-participant raw chunks) | IndexedDB via `idb` |  — |

Each of these is configured via a `VITE_*` environment variable
(`.env.example`).

### Cross-origin isolation headers

To unlock `SharedArrayBuffer` (used by some downstream codec workers) and
guarantee predictable WebCodecs / WebTransport behaviour, the Vite dev and
preview servers send:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless   # dev — preserves third-party iframe embedding
Cross-Origin-Embedder-Policy: require-corp     # production preview — strict cross-origin isolation
```

> **Important — production static hosting:** Vite-set headers only apply
> when Vite is the runtime (dev / `vite preview`). When Vessel is published
> through the Replit artifact's `serve = "static"` mode, headers must be
> configured at the **static host / CDN layer**. SharedArrayBuffer-dependent
> features will not be available in production until that's done. WebCodecs
> and WebTransport themselves do **not** require cross-origin isolation, so
> the core recording flow works without these headers — they only matter for
> threaded codec workers that need `SharedArrayBuffer`.
>
> If you self-host behind nginx / Caddy / Cloudflare, add:
>
> ```
> Cross-Origin-Opener-Policy: same-origin
> Cross-Origin-Embedder-Policy: require-corp
> ```
>
> on every HTML response, and audit any third-party assets you load to make
> sure they send `Cross-Origin-Resource-Policy: cross-origin` or `same-site`.

### PWA / offline shell

The app ships a service worker via `vite-plugin-pwa` (`registerType:
"autoUpdate"`). Built assets are precached for an offline app shell;
recording media blobs are *not* cached by the service worker (they live in
IndexedDB and the configured storage server).

### Build

```bash
pnpm --filter @workspace/vessel run build
# emits to artifacts/vessel/dist/public
```

The production target is configured in `.replit-artifact/artifact.toml` as
`serve = "static"`, so any static host works.

---

## Self-hosting

Vessel is designed to run end-to-end on infrastructure you control. None of
the following are required, but each step pulls one more dependency away from
public infrastructure.

### Your own MoQ relay (low-latency live transport)

The MoQ working group provides a reference relay you can deploy yourself.
Easiest path is Fly.io:

```bash
git clone https://github.com/kixelated/moq-rs
cd moq-rs
fly launch                  # accept defaults
fly deploy
```

Then point `VITE_MOQ_RELAY_URL` at your Fly app:

```
VITE_MOQ_RELAY_URL=wss://your-app-name.fly.dev
```

See [github.com/kixelated/moq-rs](https://github.com/kixelated/moq-rs) for the
full deployment guide and other hosting options (Docker, bare-metal).

### Your own storage server (finalized recordings)

Vessel uploads finalized tracks to a Blossom server — a tiny HTTP blob store
that uses content-addressed (SHA-256) URLs.

```bash
git clone https://github.com/hzrd149/blossom-server
cd blossom-server
docker compose up -d
```

Then:

```
VITE_BLOSSOM_SERVER=https://blobs.your-domain.example
```

Reference implementation and protocol spec:
[github.com/hzrd149/blossom](https://github.com/hzrd149/blossom).

### Your own Nostr relays (share metadata + identity)

Share manifests are published as Nostr events (kind 1063 per-track, kind 30563
session manifest). You can publish them to any combination of public relays,
or run your own (`strfry`, `nostr-rs-relay`, etc.).

Browse the live relay directory at
[nostr.watch](https://nostr.watch/relays/find), pick the relays you want, and
list them comma-separated:

```
VITE_NOSTR_RELAYS=wss://relay.your-domain.example,wss://relay.damus.io
```

### Putting it all together

Once you've configured all three, your `.env.local` looks like:

```
VITE_MOQ_RELAY_URL=wss://moq.your-domain.example
VITE_BLOSSOM_SERVER=https://blobs.your-domain.example
VITE_NOSTR_RELAYS=wss://relay.your-domain.example
VITE_APP_NAME=Vessel
VITE_APP_TAGLINE=Your voice. Your studio. Your files.
```

Run `pnpm --filter @workspace/vessel run build`, deploy the contents of
`artifacts/vessel/dist/public/` behind your own static host with
cross-origin-isolation headers configured, and you have a fully self-hosted
studio platform.

---

## License

See repository root for license information.
