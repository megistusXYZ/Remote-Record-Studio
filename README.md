# Vessel

> **Studio-quality remote recording. Open source. Your tape, your studio.**

Vessel is a self-hostable, open-source platform for recording podcasts and
interviews remotely without sounding like you're shouting from a closet on the
other side of the planet. Each guest is recorded locally at full quality, then
delivered straight to the host. No subscriptions, no cloud lock-in, no "oops
we lost your file" emails six months from now.

If we get hit by a bus tomorrow, your recordings still exist. That's the
whole point.

---

## Why Vessel?

Most remote-recording tools treat your audio like a hostage: they hold it
behind a paywall, route it through their cloud, and decide when (and whether)
you get to keep your own work. Vessel takes the opposite stance.

- **You own the recording.** Files are captured on each participant's device
  and delivered directly to the host. We don't keep copies.
- **You own the identity.** Sign in is a private key on your device. No
  email, no password, nothing for us to leak.
- **You own the platform.** It's open source. Run it on our servers, run it
  on yours, run it in your basement on a raspberry pi if that's your thing.
- **No subscription tax.** Vessel is free, and free of the recurring kind too.

## Features

- 🎙 **Studio-quality multi-track recording** — every participant captured
  locally, no compression artifacts from sketchy connections.
- 🎥 **Up to 4K video per guest** when their camera and bandwidth can handle it.
- 🖥 **Screen sharing** — present slides, demos, or a second camera feed
  without leaving the studio.
- 🔗 **One-link invites** — share by URL or QR code. Guests join from any
  modern browser. No app install, no account.
- 📱 **Installable PWA** — pin Vessel to your dock or home screen and launch
  it like a native app. Works on desktop and mobile.
- 📁 **Direct delivery** — finished tracks land with the host as soon as the
  session ends.
- 🔐 **Federated identity** — participants own their own credentials and can
  carry them between Vessel instances.
- 🎚 **Persistent device preferences** — Vessel remembers your mic, camera,
  and join-muted choices between sessions.
- 🌗 **Broadcast Dark UI** — built for late-night editing sessions and people
  who hate flashbangs. Fully responsive from phone to ultrawide.
- 📜 **Open formats only** — no proprietary container, no DRM, nothing you
  can't open in twenty years.

## How it works

The short version:

1. The host creates a **studio** and gets a shareable invite link.
2. Each guest joins from a browser. Their browser captures their own audio
   and video at full local quality.
3. While the session runs, low-bitrate previews stream between participants
   so everyone can see and hear each other in real time.
4. The full-quality tracks are encrypted on the participant's device, then
   uploaded directly to the host's destination of choice.
5. When the session ends, the host gets clean per-participant tracks ready
   to drop into their editor.

The Vessel server's job is matchmaking and metadata — sending invites,
keeping the room in sync, and getting out of the way. It never sees your
media.

## Quick start

Vessel is a [pnpm](https://pnpm.io/) monorepo. You'll need:

- **Node.js** ≥ 20
- **pnpm** ≥ 9
- **PostgreSQL** ≥ 14

```bash
# 1. Clone and install
git clone https://github.com/megistusXYZ/Remote-Record-Studio.git
cd Remote-Record-Studio
pnpm install

# 2. Configure your environment
cp .env.example .env
# Edit .env — at minimum you need DATABASE_URL and SESSION_SECRET

# 3. Push the database schema
pnpm --filter @workspace/api-server run db:push

# 4. Start everything
pnpm --filter @workspace/api-server run dev   # API on :3001
pnpm --filter @workspace/vessel run dev       # Web on :5173
```

Open <http://localhost:5173>, create your studio, and you're recording.

## Project layout

```
artifacts/
├── api-server/        Express 5 API + session orchestration
├── vessel/            React + Vite web client (the studio)
└── mockup-sandbox/    Internal component preview (dev only)
lib/                   Shared TypeScript packages
```

This is a [pnpm workspace](https://pnpm.io/workspaces). Each app is its own
package and can be developed in isolation.

## Tech stack

| Layer       | Choice                                       |
| ----------- | -------------------------------------------- |
| Frontend    | React 19 · Vite · TypeScript · Tailwind CSS  |
| Animation   | Framer Motion                                |
| Backend     | Node.js · Express 5 · TypeScript             |
| Database    | PostgreSQL · Drizzle ORM                     |
| Routing     | wouter (client) · Express (server)           |
| State       | TanStack Query                               |
| Identity    | Open identity protocol — your key, your call |

## Roadmap

Vessel is actively in development. Some big rocks on the horizon:

- [x] Multi-track local recording
- [x] Federated identity & sign-in
- [x] One-link guest invites (with QR code)
- [x] Screen sharing
- [x] Installable PWA — guests can join from mobile or desktop browsers
- [ ] Live transcript with speaker diarization
- [ ] Native desktop apps (Windows / macOS / Linux)
- [ ] Native mobile apps (iOS / Android)
- [ ] Plugin SDK for custom export pipelines

See the [open issues](https://github.com/megistusXYZ/Remote-Record-Studio/issues) for the
weekly view.

## Contributing

Pull requests are welcome and encouraged.

- For small fixes, just open a PR.
- For anything bigger than a paragraph, please open an issue first so we
  can sketch it out together.
- Be kind in code reviews. Be specific in commit messages. Be the
  contributor you wish you had.

If you're new to the codebase, look for issues tagged
[`good first issue`](https://github.com/megistusXYZ/Remote-Record-Studio/labels/good%20first%20issue).

## Security

Found a vulnerability? Please **don't** open a public issue. Email
`security@vessel.example` and we'll work with you on a coordinated
disclosure.

## License

[MIT](./LICENSE) — do what you like, just don't sue us if your podcast
flops.

---

<p align="center">
  Built with care for people who think "the cloud" is a weather phenomenon.
</p>
