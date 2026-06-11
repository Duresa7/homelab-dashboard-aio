# Contributing

Thanks for your interest in improving Homelab Dashboard! This guide covers the
process — how changes flow into the project. For environment setup and running
the app locally, see the [Development section of the README](README.md#development).

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
> branch). Switch the base to **`Dev`** — PRs against `main` that aren't
> release promotions will be re-targeted.

## Pull request flow

1. Branch off the latest `Dev`.
2. Make your changes. Keep PRs focused — one feature or fix per PR.
3. Run the local verification before pushing (this is also what CI runs):
   ```bash
   npm run verify   # typecheck + lint + tests + build
   ```
4. Open a PR **against `Dev`**. Fill in the template.
5. CI must pass before merging:
   - **Typecheck, lint, test, build**
   - **Secret & PII scan** — no real IP addresses, hostnames, credentials,
     or personal data in code, tests, or docs. Use placeholder values
     (`192.0.2.x`, `node-a`, `example.test`) instead.
   - **Dependency review** (when dependencies change)
   - **CodeQL** security analysis
6. Keep your branch up to date with `Dev` — the merge button requires it.

## Commit messages

Follow the conventional style used throughout the history:

```
feat(inventory): add component image uploads
fix(network): firewall policies crashed on live data
docs: explain the branch model
```

A short body explaining _why_ is appreciated for non-trivial changes. Do not
add `Co-Authored-By` or other attribution trailers for AI tools.

## Issues

Bug reports and feature requests live in
[GitHub Issues](https://github.com/Duresa7/homelab-dashboard-aio/issues) —
the issue forms will guide you through what to include. As with code, keep
real IPs, hostnames, and other private details out of reports. Before opening
a PR for a larger change, it's worth opening an issue first to discuss the
approach.

## Architecture context

Significant design decisions are recorded in [docs/adr/](docs/adr/), and the
project's domain vocabulary lives in [CONTEXT.md](CONTEXT.md). Skimming both
is the fastest way to understand why things are shaped the way they are.
