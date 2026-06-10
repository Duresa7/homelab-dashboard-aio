# Homelab Dashboard

Homelab Dashboard is a single place to see what is happening across a home lab.
It brings together live telemetry from UniFi networking, Proxmox compute, Docker
containers, UNAS storage, GPU and host sensors, syslog/SIEM events, and the
physical hardware inventory behind those systems.

The app is meant for daily operations: check whether core services are healthy,
spot noisy network clients, wake compute hosts, review recent events, and keep
track of the machines, parts, and service relationships that make up the lab.
When live integrations are unavailable, the dashboard can still run against
fixtures and disabled integration states so UI and workflow changes remain
testable away from the LAN.

## Authentication

The dashboard requires a login. On first run (or after upgrading an install
that has no accounts yet) the app shows a one-time **create admin account**
screen before anything else; that admin can then add more users under
Settings → Users with one of three roles:

- **admin** — everything, including integration setup, user management, and
  debug endpoints
- **member** — can edit inventory and send Wake-on-LAN packets
- **viewer** — read-only dashboard access

Per-user TOTP two-factor auth (authenticator app + one-time recovery codes) can
be enabled under Settings → Account. Sessions last 30 days (sliding) and
"Remember me" controls whether the login survives closing the browser.

Useful knobs:

- `npm run user:seed-admin` — create an `admin` account with a generated
  password, printed once (offline bootstrap without the wizard).
- `npm run user:reset-password -- <username>` — locked-out recovery; sets a new
  generated password and signs that user out everywhere.
- `AUTH_PROXY_ENABLED` / `AUTH_PROXY_HEADER` / `AUTH_PROXY_TRUSTED_IPS` — opt-in
  reverse-proxy SSO (Authentik/Authelia forward auth). The asserted username
  must match an existing local user; the local account decides the role.
- `TRUST_PROXY` — set when running behind a reverse proxy so client IPs and
  HTTPS detection use `X-Forwarded-*`.

The full design and security-audit notes live in
[docs/adr/0006-authentication-and-security-hardening.md](docs/adr/0006-authentication-and-security-hardening.md).

## Inventory photos

Machines, components, and devices can each carry up to 6 photos (Inventory →
open an item → Photos, in edit mode). Uploads are re-encoded to WebP with EXIF
stripped and stored on the app host under `data/images/` next to the SQLite
state — **even when the state DB is Postgres or MySQL**, image files stay on
local disk, so back up `data/images/` together with the database. Orphaned
files (e.g. after an item is deleted) are swept on boot and via
`POST /api/images/gc` (admin).

## Development

Install dependencies from the repo root:

```bash
npm install
```

Run the API server and Vite client together:

```bash
npm run dev:all
```

Or run them in separate terminals:

```bash
npm run server
npm run dev
```

The client dev server runs at `http://localhost:5173` and proxies `/api/*` to
the Express server on port `3001`. In production, the Express server also serves
the built client.

For the full run and verification contract used by agents and contributors, see
[AGENTS.md](AGENTS.md) and [docs/agents/run-and-verify.md](docs/agents/run-and-verify.md).

## Running the published image

CI publishes a multi-stage Docker image to the GitHub Container Registry on every
push to `main`:

- `ghcr.io/duresa7/homelab-dashboard-aio:latest` — moves with `main` (bleeding edge).
- `ghcr.io/duresa7/homelab-dashboard-aio:sha-<short>` — immutable, one per commit.

Pin a `sha-` tag for a stable deployment, or track `:latest` if you want each
merge. Provide a `.env` (see the variables the app reads) and an SSH key mount
for GPU/sensor access, then:

```bash
docker compose -f docker-compose.deploy.yml pull
docker compose -f docker-compose.deploy.yml up -d
```

`docker-compose.deploy.yml` pulls the published image and runs an optional,
label-scoped [Watchtower](https://containrrr.dev/watchtower/) that auto-updates
**only** this container when a new `:latest` is published. To deploy by hand
instead, drop the `watchtower` service and re-run `pull` + `up -d` when you
choose. To roll back, set `dashboard.image` to a known-good `sha-<short>` tag and
`up -d` again.

To build locally instead of pulling, use the default
[docker-compose.yml](docker-compose.yml) (`docker compose up -d --build`).

The deployment rationale (pull-based because the cloud runner can't reach the
LAN) is recorded in
[docs/adr/0005-cd-via-ghcr-watchtower.md](docs/adr/0005-cd-via-ghcr-watchtower.md).
