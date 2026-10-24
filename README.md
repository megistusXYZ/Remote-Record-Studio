# Vessel

[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-00d4aa.svg)](./LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-00d4aa.svg)](./CONTRIBUTING.md)
[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-2.1-00d4aa.svg)](./CODE_OF_CONDUCT.md)
[![CI](https://img.shields.io/github/actions/workflow/status/megistusXYZ/Remote-Record-Studio/ci.yml?branch=main&label=CI)](https://github.com/megistusXYZ/Remote-Record-Studio/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/megistusXYZ/Remote-Record-Studio?include_prereleases&sort=semver&label=release&color=00d4aa)](https://github.com/megistusXYZ/Remote-Record-Studio/releases/latest)

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
- **PostgreSQL** ≥ 14 — or Docker, and the included `compose.yaml` runs one
  for you

```bash
# 1. Clone and install
git clone https://github.com/megistusXYZ/Remote-Record-Studio.git
cd Remote-Record-Studio
pnpm install

# 2. Configure your environment
cp .env.example .env
# The defaults point at the Docker PostgreSQL started in step 3. Edit
# DATABASE_URL if you run your own server.

# 3. Start PostgreSQL (skip if you run your own) and push the schema
pnpm dev:db
pnpm db:push

# 4. Start everything — API on :3001, web on :5173
pnpm dev
```

Open <http://localhost:5173>, create your studio, and you're recording.
[`docs/LOCAL-DEVELOPMENT.md`](./docs/LOCAL-DEVELOPMENT.md) covers ports,
environment variables, running the apps separately, and tests.

> **Running Vessel for the public?** Read [`OPERATIONS.md`](./OPERATIONS.md)
> first. It covers CDN/WAF setup, security headers, the rate-limit
> rollback switches, abuse-response runbooks, and the curl recipes for
> verifying posture after each deploy.

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
- [x] Live transcript with speaker diarization
- [ ] Native desktop apps (Windows / macOS / Linux)
- [ ] Native mobile apps (iOS / Android)
- [ ] Plugin SDK for custom export pipelines

See the [open issues](https://github.com/megistusXYZ/Remote-Record-Studio/issues) for the
weekly view.

## Contributing

Pull requests are welcome and encouraged. Please skim
[`CONTRIBUTING.md`](./CONTRIBUTING.md) before you open one — it covers
the short version: sign your commits with `git commit -s` (we use the
[Developer Certificate of Origin](https://developercertificate.org/)),
follow the code style, and check the PR checklist.

- For small fixes, just open a PR.
- For anything bigger than a paragraph, please open an issue first so we
  can sketch it out together.
- Be kind in code reviews. Be specific in commit messages. Be the
  contributor you wish you had.

If you're new to the codebase, look for issues tagged
[`good first issue`](https://github.com/megistusXYZ/Remote-Record-Studio/labels/good%20first%20issue).

A list of people who've already contributed lives in
[`CONTRIBUTORS.md`](./CONTRIBUTORS.md).

This project follows the
[Contributor Covenant Code of Conduct](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.

### Maintainer setup (one-time, GitHub UI)

A few things have to be enabled in the GitHub web UI by the repo owner —
they can't be checked into the repo. Once the templates and CI workflow
in this PR have landed on `main`, please:

1. **Settings → Branches → Add branch protection rule** for `main`:
   - Require a pull request before merging (with at least 1 approving review).
   - Require status checks to pass: select the **`Typecheck`** check
     from the new `CI` workflow.
   - Require branches to be up to date before merging.
   - (Recommended) Require signed commits, so DCO sign-off can be
     verified cryptographically.
   - Do **not** allow force pushes or deletions on `main`.
2. **Settings → General → Pull Requests**: enable "Allow squash
   merging" and disable merge commits if you prefer a linear history
   (optional, but matches the rebased-on-main checklist in PRs).
3. **Settings → Sponsors**: once a verified GitHub Sponsors account
   exists, uncomment the `github:` line in
   [`.github/FUNDING.yml`](./.github/FUNDING.yml).

## Security

Found a vulnerability? Please **don't** open a public issue. See
[`SECURITY.md`](./SECURITY.md) for the disclosure process and the
private address to report it to.

## License

Vessel is licensed under the **[GNU Affero General Public License v3.0 or
later](./LICENSE)** (AGPL-3.0-or-later).

In plain English:

- You can run Vessel for any purpose, modify it, and self-host it. Free,
  forever.
- If you run a **modified** version as a network service, you must offer
  your users the modified source code under the same license. (This is the
  "AGPL clause" — it's what stops a closed-source SaaS from forking Vessel
  and walking away with the code.)
- Unmodified self-hosting has no source-disclosure obligation beyond what
  the AGPL already grants the world.

By contributing to Vessel, you agree that your contributions will be
licensed under the AGPL-3.0-or-later. See [`CONTRIBUTING.md`](./CONTRIBUTING.md)
for details, including the Developer Certificate of Origin sign-off
required on every commit.

Third-party assets and acknowledgements are listed in
[`NOTICE.md`](./NOTICE.md).

---

<p align="center">
  Built with care for people who think "the cloud" is a weather phenomenon.
</p>
