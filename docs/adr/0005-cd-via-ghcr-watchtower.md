# Continuous delivery via GHCR + Watchtower (pull-based)

The dashboard runs as a Docker container with `network_mode: host` on a homelab
box that lives on a private LAN. GitHub's hosted runners cannot reach that LAN,
so a conventional push-based deploy (CI SSHes in / calls a deploy hook) is not
possible without exposing the box or running a self-hosted runner — the latter a
real footgun on a public repo, where fork PRs could execute on it.

Decision: CI builds the image and **publishes** it to the GitHub Container
Registry; the box **pulls**. The cloud never initiates a connection to the LAN.

- On every push to `main`, the `docker` job in
  [.github/workflows/ci.yml](../../.github/workflows/ci.yml) builds the image
  (gated on `verify` passing) and pushes two tags to
  `ghcr.io/duresa7/homelab-dashboard-aio`: `latest` (moves with `main`) and
  `sha-<short>` (immutable, one per commit). Auth uses the built-in
  `GITHUB_TOKEN` with `packages: write` — no PAT.
- Pull requests build the image with `push: false`. This proves the `Dockerfile`
  still compiles at review time (previously nothing exercised it — `npm run
build` only runs Vite) without granting registry access to forks.
- The box runs [docker-compose.yml](../../docker-compose.yml),
  which pulls the image and runs a label-scoped Watchtower that auto-updates only
  the dashboard container when a new `:latest` appears. Watchtower is opt-in so
  downstream users who pin a tag are unaffected.

Rollback: point `dashboard.image` at a known-good `sha-<short>` tag and `up -d`.

Public-repo hardening that ships with this: all GitHub Actions are SHA-pinned
(with version comments), Dependabot watches both `npm` and `github-actions`, and
a CodeQL workflow scans on PR, push, and weekly schedule.

Branch protection is intentionally light: `main` requires the `verify` and
`docker` status checks on PRs, but the admin may still push directly (Watchtower
then deploys that push, so the local husky pre-commit remains the backstop). This
is a repository setting, not tracked in the repo.

Refined by [ADR 0009](0009-versioned-releases-and-update-check.md): `:latest`
no longer moves with `main`. Main pushes now publish only `:sha-<short>`; a
release workflow (triggered by a `v*` tag) owns `:latest` and the semver tags, so
`docker pull :latest` and Watchtower track published **releases**, not every
commit. The pull-based GHCR + Watchtower model below is otherwise unchanged.

Status: implemented (tag scheme refined by ADR 0009)
