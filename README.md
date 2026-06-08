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
