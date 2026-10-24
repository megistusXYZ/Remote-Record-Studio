# Vessel

[![CI](https://img.shields.io/github/actions/workflow/status/megistusXYZ/Remote-Record-Studio/ci.yml?branch=main&label=CI)](https://github.com/megistusXYZ/Remote-Record-Studio/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-00d4aa.svg)](./LICENSE)

Open-source remote recording for podcasts and interviews. Every participant is
recorded on their own device at full quality, encrypted before upload, and
delivered to the host. No subscription, and the files stay yours.

## Features

- **Local multi-track recording.** A 48 kHz WAV master and camera file per
  participant, saved as it records so a reload or crash loses nothing.
- **Live preview.** Peer-to-peer video between participants, with TURN for
  restrictive networks.
- **One-link invites.** Guests join from a browser. No install, no account.
- **Encrypted delivery.** Tracks are encrypted on the device and sealed to the
  host before they leave it.
- **Editor-ready export.** Aligned tracks, a Reaper project, markers and a
  speaker-labelled transcript made on the host's machine.
- **Self-hostable.** One Docker Compose file runs the whole stack.

## Quick start

Requires Node.js 24, pnpm 10, and Docker or PostgreSQL 14+.

```bash
git clone https://github.com/megistusXYZ/Remote-Record-Studio.git
cd Remote-Record-Studio
pnpm install
cp .env.example .env
pnpm dev:db && pnpm db:migrate
pnpm dev
```

The web app runs on <http://localhost:5173> and the API on port 3001. See
[docs/LOCAL-DEVELOPMENT.md](./docs/LOCAL-DEVELOPMENT.md) for details.

## Deploying

[`deploy/compose.yaml`](./deploy/compose.yaml) runs Caddy with TLS, the API,
PostgreSQL, a sync server, a storage server, TURN and daily backups. Follow
[OPERATIONS.md](./OPERATIONS.md#10-deploy-with-docker-compose).

## Project layout

```
artifacts/api-server   Express 5 API
artifacts/vessel       React 19 + Vite web client
lib/                   Shared packages: database schema, API spec, generated clients
deploy/                Docker images and the compose stack
docs/                  Development and privacy documentation
```

## Documentation

- [Local development](./docs/LOCAL-DEVELOPMENT.md)
- [Operations](./OPERATIONS.md)
- [Privacy and discoverability](./docs/PRIVACY-AND-DISCOVERABILITY.md)

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first;
every commit needs a DCO sign-off (`git commit -s`). This project follows the
[Contributor Covenant](./CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities privately as described in
[SECURITY.md](./SECURITY.md), not in public issues.

## License

[AGPL-3.0-or-later](./LICENSE). Third-party notices are in
[NOTICE.md](./NOTICE.md).
