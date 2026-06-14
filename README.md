# Homelab Dashboard

I built Homelab Dashboard because I got tired of opening five tabs to answer one
question. Switches and access points live in UniFi. VMs live in Proxmox.
Containers in Portainer, storage in the UNAS web UI, GPU load and temperatures
over SSH, syslog somewhere else again. Every vendor ships its own dashboard, and
none of them showed me the few things I check every day. So I built one that
does.

It's one page for the whole lab, built for daily operations rather than deep
configuration: is everything healthy, what's noisy on the network, what's
running where, and what hardware sits behind it all. I wanted something minimal
that surfaces what I actually care about, not another tool to babysit.

<!-- TODO: drop a screenshot of the dashboard here -->

## What it pulls together

- **Network**: UniFi clients, devices, and health
- **Compute**: Proxmox nodes, VMs, and containers, with Wake-on-LAN
- **Containers**: Docker state and per-container stats, via Portainer
- **Storage**: UniFi UNAS capacity, drives, and fan/system status
- **Sensors**: NVIDIA GPU load and host temperatures (lm-sensors), read locally or over SSH
- **Events**: syslog/SIEM ingestion from UniFi gear
- **Inventory**: the machines, parts, and service relationships behind all of it

## Features

Beyond reading from your gear, it's built to run the lab day to day:

- **First-run setup wizard**: point it at your gear and choose a database from the browser, with no config files to hand-write.
- **Hardware inventory**: machines, components, and spare devices, each with photos, service relationships, identifiers, and a per-item problem log.
- **Wake-on-LAN**: wake a compute host straight from the dashboard.
- **Event log**: syslog/SIEM capture from UniFi gear, with a retention window you set.
- **Alerts**: flag the metrics you care about once they cross a threshold.
- **Accounts and access**: admin, member, and viewer roles, optional TOTP two-factor, and reverse-proxy SSO.
- **Update notifications**: admins get a badge when a new release ships; it notifies, never auto-pulls.
- **Your choice of database**: SQLite by default, or point it at Postgres or MySQL.
- **Encrypted secrets**: integration API keys and database passwords are encrypted at rest (AES-256-GCM) with a key only your server holds, or kept in environment variables if you'd rather.
- **Runs empty**: every integration is off until you switch it on, so you can explore the whole UI before connecting any gear.

## Deploy with Docker

You need a host with Docker and Docker Compose already installed. Any Linux box
works: a VM, an LXC, a spare mini PC, an ARM board.

Grab the compose file and start it:

```bash
curl -fsSLO https://raw.githubusercontent.com/Duresa7/homelab-dashboard-aio/main/docker-compose.yml
docker compose up -d
```

<details>
<summary>Or copy this <code>docker-compose.yml</code> directly</summary>

```yaml
services:
  dashboard:
    image: ghcr.io/duresa7/homelab-dashboard-aio:latest
    container_name: homelab-dashboard
    restart: unless-stopped
    # Host networking keeps real syslog source IPs and avoids unprivileged-port pain.
    network_mode: host
    # .env is optional; integrations can also be configured from the UI.
    env_file:
      - path: .env
        required: false
    environment:
      NODE_ENV: production
    volumes:
      - ./data:/app/data
      # Optional: SSH key for GPU/sensor stats over SSH. Uncomment, then set
      # GPU_SSH_KEY_PATH in .env.
      # - ${HOME}/.ssh/id_homelab:/home/node/.ssh/id_homelab:ro
    ulimits:
      nofile: 65536
    labels:
      com.centurylinklabs.watchtower.enable: 'true'

  # Optional auto-updater. Remove this service to update by hand instead
  # (docker compose pull && docker compose up -d).
  watchtower:
    image: containrrr/watchtower:latest
    container_name: homelab-watchtower
    restart: unless-stopped
    environment:
      WATCHTOWER_LABEL_ENABLE: 'true'
      WATCHTOWER_POLL_INTERVAL: '300'
      WATCHTOWER_CLEANUP: 'true'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

</details>

Open `http://<host-ip>:3001` and create your admin account on the first-run
screen. That's the whole setup: no `.env`, no config files to write first. The
image is multi-arch, so the same command works on a regular server or an ARM
board like a Raspberry Pi.

By default, everything you create (inventory, settings, uploaded photos, the
database) lives in a `./data` folder next to the compose file. Back up that
folder and your dashboard moves with it. (Point it at Postgres or MySQL instead
and only the photos and config stay on local disk.)

## Turning on integrations

Out of the box the dashboard talks to nothing. You can wire up your gear two
ways: in the **setup wizard** in the browser (the easy path, with each secret
encrypted at rest), or with a **`.env` file** beside the compose file if you'd
rather manage configuration as environment variables. For the `.env` route, copy
the template and fill in only the parts you use:

```bash
curl -fsSLO https://raw.githubusercontent.com/Duresa7/homelab-dashboard-aio/main/.env.example
mv .env.example .env
# edit .env, then re-run:
docker compose up -d
```

Each integration has an on/off switch plus its own connection settings:

| Integration            | Switch                                 | What you provide                              |
| ---------------------- | -------------------------------------- | --------------------------------------------- |
| UniFi network          | `UNIFI_ENABLED=true`                   | controller URL + API key                      |
| Proxmox                | `PROXMOX_ENABLED=true`                 | API token (id + secret)                       |
| Docker (via Portainer) | `PORTAINER_ENABLED=true`               | Portainer URL + API key                       |
| UniFi UNAS             | `UNAS_ENABLED=true`                    | UNAS URL + local API key                      |
| GPU + host sensors     | `GPU_ENABLED` / `SENSORS_ENABLED=true` | local access, or SSH to the host              |
| Syslog / SIEM          | `SIEM_ENABLED=true`                    | point your gear's remote logging at this host |

The full list, with a comment on every option, is in [`.env.example`](.env.example).

<details>
<summary>A minimal <code>.env</code> to copy and trim</summary>

```bash
# Everything is off by default; switch on only what you use.
UNIFI_ENABLED=false
UNIFI_BASE_URL=
UNIFI_API_KEY=

PROXMOX_ENABLED=false
PROXMOX_BASE_URL=
PROXMOX_TOKEN_ID=
PROXMOX_TOKEN_SECRET=
PROXMOX_NODE=

PORTAINER_ENABLED=false
PORTAINER_BASE_URL=
PORTAINER_API_KEY=

UNAS_ENABLED=false
UNAS_BASE_URL=
UNAS_API_KEY=

SIEM_ENABLED=false

# Optional: bring your own key for encrypting stored secrets (otherwise one is
# auto-generated at data/secret.key). 64 hex chars, or any passphrase.
# APP_ENCRYPTION_KEY=
```

</details>

> Reading GPU or temperature stats over SSH needs a key inside the container.
> Uncomment the `id_homelab` volume in `docker-compose.yml`, place your key
> there, and set `GPU_SSH_KEY_PATH` in `.env`. Skip this if you don't collect
> sensors over SSH.

Secrets you enter in the setup wizard (integration API keys and any Postgres or
MySQL password) are encrypted at rest with AES-256-GCM. The key is generated once
and kept at `data/secret.key`, so back up `data/` as a unit; a stolen database
backup alone can't be read without it. To supply your own key instead (for
example a Docker secret kept off the data volume), set `APP_ENCRYPTION_KEY`.
Prefer a secret to stay in the environment? Set its variable (see the table and
`.env.example`) and pick "Environment variable" for that integration in the
wizard; the app reads it from the environment and never stores it.

## Staying updated

`docker-compose.yml` includes an optional
[Watchtower](https://containrrr.dev/watchtower/) that watches only this
container and pulls a new image when a release is published. To update by hand
instead, delete the `watchtower` service and run:

```bash
docker compose pull && docker compose up -d
```

The dashboard also checks GitHub for newer releases and shows admins an update
badge in the top bar, plus a **Settings → About** tab with the current version
and release notes. It only notifies; you (or Watchtower) choose when to pull.
Switch the check off with `UPDATE_CHECK_ENABLED=false`.

Two image tracks are published to the GitHub Container Registry:

- `ghcr.io/duresa7/homelab-dashboard-aio:latest` is the newest tagged **release**, and what most people should run.
- `ghcr.io/duresa7/homelab-dashboard-aio:sha-<short>` is the **cutting-edge** build from the latest `main` commit, rebuilt on every push. Point `dashboard.image` at one to ride the bleeding edge, or pin `:X.Y.Z` to freeze a specific release.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers local
development setup, the branch model (feature → `Dev` → `main`), and how releases
are cut.
