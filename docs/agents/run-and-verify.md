# Run and Verify

## Offline verification

Run the full local verification suite from the repo root:

```bash
npm run verify
```

`verify` runs type checking, linting, tests, and the production client build. The
suite uses mocks and fixtures and must not depend on access to a live homelab or
LAN-only services.

## Development servers

The development setup uses two processes:

```bash
npm run server
npm run dev
```

`npm run server` starts the Express API server on port `3001`. `npm run dev`
starts the Vite client on `http://localhost:5173`. For a single command, use:

```bash
npm run dev:all
```

The Vite dev server proxies `/api/*` to Express. Keep `changeOrigin: false` in
`client/vite.config.ts`; the server's same-origin write guard expects the
browser `Origin` and proxied `Host` to match during local writes.

## UI work without LAN access

Agents and contributors should assume live homelab integrations are unavailable
unless they are explicitly working on the target network. For UI-only work, set
`DISABLE_ALL=true` and use the dev server. The dashboard should remain usable
with disabled integrations, fixture-backed tests, and mocked API responses.
