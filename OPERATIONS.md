# Operating Vessel in Production

This is the maintainer's runbook for operating a public Vessel deployment.
It covers the things that aren't visible from the application code: putting
the right things in front of the origin, what to do when the server is
under abuse, and how to pull every safety knob if something goes wrong.

If you are running Vessel locally for development, you do not need this
document.

---

## 1. Put a CDN / WAF in front of the origin

> **This is mandatory, not optional.** The API server runs with
> `trust proxy` on so it reads the client IP from `X-Forwarded-For`.
> If the origin is reachable directly, an attacker can spoof
> `X-Forwarded-For` and bypass per-IP rate limits entirely. Lock the
> origin down to your CDN's egress IPs (Cloudflare publishes them at
> <https://www.cloudflare.com/ips/>) — either via a cloud firewall, a
> security group, or `iptables` on the host. Verify with a curl from
> outside the CDN: it should hang or get a TLS error.

Application-level rate limiting (see § 4) protects the database and the
process, but it cannot protect the origin from a real volumetric DDoS —
the bytes arrive and pay for themselves before any code runs. Always run
Vessel behind something that can absorb traffic at the edge.

We recommend **Cloudflare** for first-time deployments; the free tier
covers the controls below. Equivalent setups on Bunny, Fastly, AWS
CloudFront + WAF, or your own NGINX reverse proxy are fine — the
specific names below are Cloudflare-flavored, but the concepts are
universal.

Minimum settings:

| Concern              | Setting                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------- |
| TLS                  | "Full (strict)" or equivalent — origin must serve a real cert.                           |
| HSTS                 | Enabled, **at least one week** to start, no preload until you're sure.                   |
| TLS minimum version  | TLS 1.2 (TLS 1.3 if all your guests can reach it).                                       |
| Bot Fight Mode       | On (Cloudflare). Equivalent on other CDNs.                                               |
| Rate limiting (edge) | 600 req/min/IP for `/api/*`, 30 req/min/IP for `/api/sessions/*` GETs, unlimited otherwise. |
| Cache rules          | Cache everything under `/assets/*`; never cache `/api/*`, `/index.html`, `/config.js`, `/sw.js`. |
| Security headers     | Leave the ones the app sends in place. Optionally add CDN-side HSTS preload.            |

The application server already sets HSTS (`max-age=1y, includeSubDomains`),
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`X-Content-Type-Options: nosniff`, and `Cross-Origin-Resource-Policy:
cross-origin`. Don't strip these at the CDN.

Confirm posture by running the deployed site through
<https://securityheaders.com> after each major change. Aim for **at
least an A grade**.

## 2. Required environment variables

The API reads these from its process environment. `deploy/compose.yaml`
sets them from `deploy/.env` (template: `deploy/.env.example`).

| Variable                                                              | Purpose                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`                                                        | PostgreSQL connection string. Required.                                   |
| `PORT`                                                                | TCP port the API listens on. Required.                                    |
| `NODE_ENV`                                                            | `production` in production.                                               |
| `LOG_LEVEL`                                                           | pino level: `trace`, `debug`, `info` (default), `warn`, `error`.          |
| `TURN_URLS`, `TURN_SHARED_SECRET`, `TURN_TTL_SECONDS`, `STUN_URLS`    | Live preview relay credentials, § 4a.                                     |
| `VESSEL_*`                                                            | Abuse controls and headers, § 4.                                          |

The web client holds no secrets. Its deployment settings (`VESSEL_DOMAIN`,
`VESSEL_RELAYS`, `VESSEL_STORAGE_SERVER`, …) are read by the web container
at start and handed to the browser; see § 10.

There is no session secret: the API keeps no sessions and sets no cookies.
Every request that changes state carries a signature from the caller's key,
bound to the request URL and body (`require-signed-request.ts`).

## 3. Rotating secrets

| Secret               | Where         | How to rotate                                                                                                                                                             |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`  | `deploy/.env` | `ALTER USER vessel PASSWORD '<new>'` on the database, update the file, then `up -d` (api, migrate and backup restart with the new value).                                   |
| `TURN_SHARED_SECRET` | `deploy/.env` | Update the file, then `up -d api turn`. Credentials issued before the change expire within `TURN_TTL_SECONDS`; a call in progress keeps its allocation.                     |

Generate values with `openssl rand -hex 32`. Rotate at once if you suspect a
leak; otherwise once a year is plenty.

## 4. Rate-limiting & quota controls (rollback switch table)

Every safety feature added in the pre-launch hardening pass is gated by
an environment variable so an operator can disable it instantly without
a redeploy. Set the variable, restart the API server workflow, done.

| Subsystem                      | Env var                                          | Default | Disable command                                |
| ------------------------------ | ------------------------------------------------ | ------- | ---------------------------------------------- |
| Per-IP rate limit (all `/api`) | `VESSEL_RATE_LIMIT_ENABLED`                      | `true`  | `VESSEL_RATE_LIMIT_ENABLED=false`              |
| Shared mode (per-IP + per-account) | `VESSEL_RATE_LIMIT_MODE`                     | `observe` (ships in observe; flip to `enforce` after a week of clean telemetry) | `VESSEL_RATE_LIMIT_MODE=off` (acts on both subsystems) |
| Public-IP window length (ms)   | `VESSEL_RATE_LIMIT_PUBLIC_WINDOW_MS`             | `60000` | (override to taste)                            |
| Public-IP requests/window      | `VESSEL_RATE_LIMIT_PUBLIC_PER_WINDOW`            | `120`   | (raise to loosen, lower to tighten)            |
| Session-lookup window (ms)     | `VESSEL_RATE_LIMIT_LOOKUP_WINDOW_MS`             | `60000` | —                                              |
| Session-lookup requests/window | `VESSEL_RATE_LIMIT_LOOKUP_PER_WINDOW`            | `30`    | —                                              |
| Per-account write quotas       | `VESSEL_QUOTA_ENABLED`                           | `true`  | `VESSEL_QUOTA_ENABLED=false`                   |
| Sessions create / hour         | `VESSEL_QUOTA_SESSIONS_CREATE_PER_WINDOW`        | `30`    | —                                              |
| Sessions join / hour           | `VESSEL_QUOTA_SESSIONS_JOIN_PER_WINDOW`          | `60`    | —                                              |
| Recordings write / hour        | `VESSEL_QUOTA_RECORDINGS_WRITE_PER_WINDOW`       | `500`   | —                                              |
| Helmet security headers (API)  | `VESSEL_HELMET_ENABLED`                          | `true`  | `VESSEL_HELMET_ENABLED=false`                  |
| Web client CSP                 | `VESSEL_CSP_ENFORCE`                             | `false` (Report-Only) | leave at `false` for Report-Only |

Signed requests are bound to their body and each auth event is accepted once; the
"already used" memory is per process (two minutes). Behind a load balancer with
several API instances a replay could land on a different instance, so pin
clients to one instance or back the cache with a shared store before scaling out.

**`/api/healthz` is never rate-limited** — your monitoring can hit it as
often as it likes without tripping anything. It answers 200 only when the
database answers too, and 503 `{"status":"degraded"}` otherwise, so point
uptime monitoring at it.

### How the modes work

- `enforce` — exceeded requests get HTTP 429 + `Retry-After`.
- `observe` — exceeded requests are **logged with a warning but allowed
  through**. Use this for the first week after enabling a new limiter
  to confirm legitimate users aren't being caught.
- `off` — both per-IP limiters AND per-account quotas become complete
  no-ops. Mode is shared across subsystems. To turn off only one,
  use the per-subsystem `*_ENABLED` flag.

To find observed-but-not-blocked traffic in the logs, search for the
string `rate-limit observed (would-block)`.

## 4a. TURN for the live preview

The live preview is a peer-to-peer WebRTC mesh. Peers behind strict NATs
(office networks, some mobile carriers) cannot connect without a TURN
relay. Run [coturn](https://github.com/coturn/coturn) and let the API hand
out short-lived credentials:

```
# turnserver.conf (minimal)
listening-port=3478
tls-listening-port=5349
realm=your-domain.example
use-auth-secret
static-auth-secret=<same value as TURN_SHARED_SECRET>
fingerprint
no-multicast-peers
```

API environment:

| Variable             | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `TURN_URLS`          | Comma-separated `turn:`/`turns:` URLs the browser should use.            |
| `TURN_SHARED_SECRET` | coturn's `static-auth-secret`. Never ships to the browser.               |
| `TURN_TTL_SECONDS`   | Credential lifetime, default 43200 (12 hours).                          |
| `STUN_URLS`          | Optional override of the public STUN defaults.                           |

`GET /api/turn` (signed) returns the ICE server list with a credential tied
to the caller. Open UDP 3478 and TCP 5349 (plus the relay port range) on the
host. Without TURN configured the endpoint returns STUN only.

## 5. Verify the security posture (curl recipes)

Run these against your deployed origin (or `localhost` in dev) after
every deploy. They take five seconds and catch most regressions.

```sh
# 1. API health endpoint should return 200 (503 means the database is down)
#    and the security headers.
curl -sSI https://your-domain.example/api/healthz

# 2. Unknown API path should return a generic 404 — no stack trace, no
#    framework branding.
curl -sS  https://your-domain.example/api/__nope

# 3. Web client should set Referrer-Policy: no-referrer and CSP-Report-Only.
curl -sSI https://your-domain.example/ | grep -iE '^(referrer-policy|content-security-policy|permissions-policy|x-content-type-options)'

# 4. Oversized body should be rejected with a 413 before parsing.
curl -sS -X POST https://your-domain.example/api/sessions \
  -H "Content-Type: application/json" \
  --data-binary @- <<<"$(head -c 50000 /dev/urandom | base64)"
```

## 6. Abuse response

### A specific invite code is being spammed

The fastest stop is to **delete the session** — invite codes resolve to
the session row, so removing the row makes the code 404 immediately.

```sql
-- as the host of the session, find it:
SELECT id, title, invite_code, host_pubkey
FROM sessions
WHERE invite_code = 'abc12xyz';

-- delete (cascades to participants, but NOT to recordings — those are
-- owner-scoped and the host can keep them):
DELETE FROM participants WHERE session_id = '<uuid>';
DELETE FROM sessions     WHERE id        = '<uuid>';
```

If you need to keep the session but disable the invite:

```sql
UPDATE sessions
SET invite_code = encode(gen_random_bytes(8), 'hex')
WHERE id = '<uuid>';
```

The host's existing browser tab will need to refresh to pick up the new
invite. Anyone holding the old code now gets a 404.

### A specific account (pubkey) is creating too much

If a single identity is hitting quotas and you want to ban them
outright, add an edge-side block: easiest is a Cloudflare WAF rule that
matches the JWT-style `Authorization: Nostr` header and rejects with
403.

For a more permanent block, add a tiny denylist middleware in front of
`requireSignedRequest` that 403s known-bad pubkeys. We have not shipped
this in core because the operator's denylist policy is going to be very
deployment-specific; track the work as a follow-up if you find yourself
needing it more than once.

### Volumetric attack on the origin

Edge-side controls (§ 1) are your only real defense here. If you are
seeing legitimate-looking traffic at a rate the origin can't serve,
turn on Cloudflare's "I'm under attack" mode (or your CDN's equivalent)
and keep it on until the wave passes.

## 7. Reporting / incident contact

Set up a public address that maintainers can be reached at for security
reports. Recommended:

- **`security@your-domain.example`** — receives the email a researcher
  sends per [`SECURITY.md`](./SECURITY.md).
- **`abuse@your-domain.example`** — receives reports of misuse of
  your specific deployment (spam invite codes, harassment, etc.).

Forward both to a real human inbox or a tracker that pages someone.
Vessel is a recording platform; an abuse report can be time-sensitive.

## 8. Dependency hygiene

CI runs `pnpm audit --prod --audit-level=high` non-blockingly on every
PR (`.github/workflows/ci.yml#audit`). Dependabot opens grouped
weekly PRs for minor/patch updates and individual PRs for security
advisories (`.github/dependabot.yml`).

If a high or critical advisory lands, CI will surface it but won't
block the merge. Triage manually:

```sh
pnpm audit --prod --audit-level=high
pnpm update <package>            # minor/patch
pnpm add <package>@<safe-version> --filter <workspace>  # specific pin
```

`minimumReleaseAge: 1440` in `pnpm-workspace.yaml` already guards
against same-day-of-release supply-chain attacks; keep it on.

## 9. Performance probing

Before promoting a hardening change to enforce mode, run a quick local
load probe and confirm the latency budget hasn't moved:

```sh
# Install once: pnpm add -g autocannon
autocannon -c 50 -d 30 http://localhost:8080/api/healthz
```

Acceptance numbers (single instance, p99 under 50 concurrent
connections):

- p50 latency: should not regress more than **0.5 ms** from the
  pre-hardening baseline.
- p99 latency: should not regress more than **2 ms** from the
  pre-hardening baseline.
- RSS memory: should not climb more than **5 MB** above baseline at
  steady state.

If any number is outside the budget, set the relevant subsystem to
`off` (see § 4) and open an issue before promoting further.

## 10. Deploy with Docker Compose

`deploy/compose.yaml` is the whole stack: Caddy (TLS and the web client),
the API, PostgreSQL, a one-shot migration step, a sync server (strfry), a
storage server (blossom-server), a TURN relay (coturn) and a daily backup.
The flagship and a self-hosted instance use the same file.

### What you need

- A Linux host with 2 vCPUs, 4 GB RAM and 40 GB of disk to start, x86-64 or
  arm64, running Docker Engine 24 or newer with the Compose plugin.
- A domain. The stack uses four names, all pointing at the host:

  | Name                 | Record | CDN proxy                | Serves                      |
  | -------------------- | ------ | ------------------------ | --------------------------- |
  | `vessel.example.com` | A/AAAA | yes                      | the app and `/api`          |
  | `relay.example.com`  | A/AAAA | yes (websockets pass)    | sync server                 |
  | `files.example.com`  | A/AAAA | no, DNS-only (see below) | storage server              |
  | `turn.example.com`   | A/AAAA | no, DNS-only (required)  | TURN; UDP cannot be proxied |

  Cloudflare's proxy caps each request body at 100 MB on the free plan. Whole
  recordings exceed that, so keep `files` DNS-only or upgrade the plan.

- Host firewall: open 80 and 443 (TCP and UDP) to everyone so Caddy can obtain
  certificates for the DNS-only names too, plus 3478 (TCP and UDP) and the TURN
  relay range 49160–49200 (UDP). If every hostname is proxied you may limit 443
  to the CDN's ranges (§ 1); the DNS-only names then need Cloudflare origin
  certificates instead of Let's Encrypt.

### First start

```sh
git clone https://github.com/megistusXYZ/Remote-Record-Studio.git vessel
cd vessel
cp deploy/.env.example deploy/.env
openssl rand -hex 32    # paste as POSTGRES_PASSWORD
openssl rand -hex 32    # paste as TURN_SHARED_SECRET
$EDITOR deploy/.env     # domain, email, the two secrets, TURN_URLS
docker compose -f deploy/compose.yaml --env-file deploy/.env pull
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
docker compose -f deploy/compose.yaml --env-file deploy/.env ps
```

`migrate` runs once and exits 0; `api` starts after it. Caddy obtains a
certificate for each hostname on its first request. Then check:

```sh
curl -sS https://vessel.example.com/api/healthz     # {"status":"ok","nowMs":...}
curl -sSI https://files.example.com/ | head -1      # HTTP/2 200
```

and run the recipes in § 5. Open the site, create a studio, start a session
from a second device on a mobile connection: the live preview should connect,
which proves TURN.

### Day two

- **Update**: `git pull` (for the compose file and configs), then `pull` and
  `up -d` again. Migrations run first; a failed migration stops the rollout
  and the API is not replaced until it is fixed.
- **Pin a version**: set `VESSEL_IMAGE_TAG=v0.3.0` in `deploy/.env`. Rolling
  back is the same with the previous tag, as long as no migration in between
  dropped anything (read the files in `lib/db/drizzle`).
- **Logs**: `docker compose -f deploy/compose.yaml --env-file deploy/.env logs -f api web`.
- **Data**: the named volumes `pgdata`, `strfry-db`, `blossom-data`,
  `caddy-data` and `db-backups`. `down` keeps them; `down -v` destroys them.
- **One API container**: the signed-request replay cache is per process
  (§ 4), so scale the machine before scaling out.
- **Build locally instead of pulling**: add `--build` to `up`. Images build
  for the host's own architecture.
- **Name your servers**: `relay.info` in `deploy/strfry.conf` and the rules
  in `deploy/blossom.yml` are yours to edit; `up -d relay files` applies them.

### Settings the browser receives

The web container writes `/config.js` at start from `VESSEL_RELAYS`,
`VESSEL_STORAGE_SERVER` and `VESSEL_MOQ_RELAY_URL` (defaults: this
deployment's own sync and storage servers). Changing them is `up -d web`,
no rebuild. The `VITE_*` variables in `artifacts/vessel/.env.example` are
the build-time equivalents for custom builds.

## 11. Database migrations

The schema lives in `lib/db/src/schema`; the SQL migrations generated from
it live in `lib/db/drizzle` and are committed.

- After a schema change: `pnpm db:generate --name <what_changed>`, read the
  SQL, commit both.
- Apply locally: `pnpm db:migrate`. `pnpm db:push` remains a shortcut for a
  throwaway development database.
- In production the `migrate` service applies pending files before the API
  starts (`dist/migrate.mjs` in the API image).
- Databases created with `db:push` before migrations existed: the first
  migration uses `IF NOT EXISTS`, so applying it records the baseline without
  touching data.

## 12. Backups and restore

The `backup` service writes a `pg_dump` custom-format file to the
`db-backups` volume once a day and keeps `BACKUP_KEEP_DAYS` (default 14) of
them. Copy them off the host on a schedule; a backup on the same disk is not
a backup.

```sh
C="docker compose -f deploy/compose.yaml --env-file deploy/.env"
$C exec backup ls -lh /backups                                   # list
$C cp backup:/backups/vessel-<stamp>.dump .                      # copy one out
$C exec -T postgres pg_restore -U vessel -d vessel --clean --if-exists \
  < vessel-<stamp>.dump                                          # restore (replaces current rows)
```

Recordings are not in PostgreSQL. They live on participants' devices and on
the storage server (`blossom-data`, or the bucket configured in
`deploy/blossom.yml`); back that volume up with your usual file tooling.

