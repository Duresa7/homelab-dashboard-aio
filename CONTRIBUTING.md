# Contributing

Thanks for your interest in improving Homelab Dashboard! This guide covers how
changes flow into the project: how to run the app locally, the branch model, and
how releases are cut.

## Development setup

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

To build and run the full container from source instead of pulling the published
image, use [docker-compose.dev.yml](docker-compose.dev.yml):

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

## Branch model

```
your-branch ──PR──▶ Dev ──release PR──▶ main
```

- **`main` is the live release.** Every push to it publishes a new Docker
  image that deployments auto-update from, so nothing lands there directly.
- **`Dev` is the integration branch.** All day-to-day work targets `Dev`.
  It accumulates finished features until a release is cut by promoting
  `Dev → main`.
- **Feature branches** come off `Dev` and merge back into `Dev` via pull
  request. Use a short descriptive name, e.g. `feat/firewall-page` or
  `fix/storage-units`.

> **Heads-up:** GitHub pre-fills new PRs to target `main` (the default
> branch). Switch the base to **`Dev`**; PRs against `main` that aren't
> release promotions will be re-targeted.

## Pull request flow

1. Branch off the latest `Dev`.
2. Make your changes. Keep PRs focused: one feature or fix per PR.
3. Run the local verification before pushing (this is also what CI runs):
   ```bash
   npm run verify   # typecheck + lint + tests + build
   ```
4. Open a PR **against `Dev`**. Fill in the template.
5. CI must pass before merging:
   - **Typecheck, lint, test, build**
   - **Secret & PII scan**: no real IP addresses, hostnames, credentials,
     or personal data in code, tests, or docs. Use the canonical placeholders
     below ([Placeholder & redaction conventions](#placeholder--redaction-conventions)).
   - **Dependency review** (when dependencies change)
   - **CodeQL** security analysis
6. Keep your branch up to date with `Dev`; the merge button requires it.

## Placeholder & redaction conventions

Never put real IPs, hostnames, MAC addresses, credentials, or personal data in
code, tests, or docs — the public repo and its scanners reject them. Use these
canonical placeholders everywhere instead:

| Thing                       | Use                                            | Notes                                                                                                            |
| --------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Private / LAN IPv4          | `192.168.255.x`                                | The everyday "my device's IP" placeholder.                                                                       |
| Public / external IPv4      | `192.0.2.x`, `198.51.100.x`, `203.0.113.x`     | RFC5737 docs ranges. Use these for WAN/public IPs and any test that needs several distinct subnets (CIDR, SSRF). |
| IPv6                        | `2001:db8::/32`                                | RFC3849 docs range.                                                                                              |
| MAC address                 | `AA:BB:CC:DD:EE:FF`                            |                                                                                                                  |
| Hostname / cluster nodes    | `example.test`, `node-a` / `node-b` / `node-c` |                                                                                                                  |
| Username                    | `changeme-user`                                |                                                                                                                  |
| Password                    | `change-me-soon-purple-otter-42`               | A deliberately fake passphrase that still clears the strength check.                                             |
| Email                       | `changeme@example.com`                         | An `example.*` / `.test` domain — not a real one like `email.com`.                                               |
| API keys / tokens / secrets | leave blank                                    | `.env.example` ships these empty so a blank is the "you must fill this in" signal.                               |

**Why two IPv4 ranges?** `192.168.255.x` is the friendly placeholder for a LAN
device — it has the familiar `192.168` shape, but a `.255` subnet is one almost
nobody actually runs, so every _other_ RFC1918 address (a likely real leak) is
still blocked. The RFC5737 ranges are for public/external addresses and for tests
that need multiple distinct networks, which a single subnet can't express. The
rationale is recorded in
[docs/adr/0011-placeholder-conventions.md](docs/adr/0011-placeholder-conventions.md).

## Commit messages

Follow the conventional style used throughout the history:

```
feat(inventory): add component image uploads
fix(network): firewall policies crashed on live data
docs: explain the branch model
```

A short body explaining _why_ is appreciated for non-trivial changes. Do not
add `Co-Authored-By` or other attribution trailers for AI tools.

## Cutting a release

Releases are tag-driven. Bump the version, then push the tag:

```bash
npm version patch   # or minor / major; commits package.json and tags vX.Y.Z
git push --follow-tags
```

The [release workflow](.github/workflows/release.yml) verifies the commit, builds
the multi-arch image with the version baked in, publishes `:X.Y.Z`, `:X.Y`, and
`:latest`, and creates a GitHub Release with generated notes, which is the source
the in-app update check reads. Prerelease tags like `vX.Y.Z-rc.1` are published as
prereleases and do not move `:latest`.

The deployment rationale (pull-based, because the cloud runner can't reach the
LAN) is in [docs/adr/0005-cd-via-ghcr-watchtower.md](docs/adr/0005-cd-via-ghcr-watchtower.md);
the release and versioning model is in
[docs/adr/0009-versioned-releases-and-update-check.md](docs/adr/0009-versioned-releases-and-update-check.md).

## Dependency updates

Dependabot opens npm and GitHub-Actions update PRs against **`Dev`**, so they run
through the same gate as any other change. A _critical_ security bump can be
promoted out of the normal cadence by opening a `Dev → main` release PR for it
directly, rather than waiting for the next scheduled release.

## Issues

Bug reports and feature requests live in
[GitHub Issues](https://github.com/Duresa7/homelab-dashboard-aio/issues).
The issue forms will guide you through what to include. As with code, keep
real IPs, hostnames, and other private details out of reports. Before opening
a PR for a larger change, it's worth opening an issue first to discuss the
approach.

## Architecture context

Significant design decisions are recorded in [docs/adr/](docs/adr/), and the
project's domain vocabulary lives in [CONTEXT.md](CONTEXT.md). Skimming both
is the fastest way to understand why things are shaped the way they are.
