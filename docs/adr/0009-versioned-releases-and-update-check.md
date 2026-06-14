# Versioned releases and in-app update check

[ADR 0005](0005-cd-via-ghcr-watchtower.md) set up pull-based CD: CI pushed
`:latest` on every `main` commit and an opt-in Watchtower auto-updated the box.
That made "an update" mean "the last commit," there was no human version (frozen
at `0.1.0`, no tags, no GitHub Releases), the running container had no idea what
it was, and nothing in the UI told an operator a newer build existed.

Decision: introduce real releases and a notify-only in-app update check.

- **Releases are tag-driven.** Pushing a `v*` tag runs
  [release.yml](../../.github/workflows/release.yml): it re-verifies the commit,
  builds the image with the version baked in, publishes `:X.Y.Z`, `:X.Y`, and
  `:latest`, and creates a GitHub Release with generated notes. `package.json`
  `version` stays the single source of truth (`npm version` bumps + tags it).
- **`:latest` now means the latest release.** Main pushes publish only
  `:sha-<short>` (testing/rollback). So `docker pull :latest`, Watchtower, and the
  update indicator all agree on "latest release." Prerelease tags
  (`vX.Y.Z-rc.1`) publish as prereleases and never move `:latest`.
- **The running version is baked into the image.** `release.yml` passes
  `APP_VERSION`/`APP_COMMIT`/`APP_BUILD_TIME` build args (also OCI labels);
  [server/src/version](../../server/src/version/index.ts) reads them. A build
  with no `APP_VERSION` (local/dev) is flagged `isDevBuild` and never nags.
- **The check runs server-side, cached.** The server polls the GitHub Releases
  API (`releases/latest`, which excludes prereleases) every 6h, caches the result,
  and exposes `GET /api/version`, `GET /api/update`, and an admin-only
  `POST /api/update/check`. One shared cache, no per-browser rate-limit fan-out,
  graceful when GitHub is unreachable. Gated by `UPDATE_CHECK_ENABLED` (and the
  existing `DISABLE_ALL`).
- **Notify-only.** The app never touches the Docker socket. Admins see a top-bar
  badge and a Settings → About tab (current vs latest, release notes, the `pull`
  commands); they (or Watchtower) perform the update. Self-update from inside the
  container — killing/recreating itself over a privileged socket — was rejected as
  fragile and a needless attack surface.
- **Multi-arch.** Release images build for `linux/amd64,linux/arm64` (QEMU on the
  runner; `better-sqlite3` compiles per-arch in the builder stage) so ARM homelab
  hardware can run the published image.

Consequences: cutting a release is now one `npm version` + `git push --follow-tags`.
Operators on `:latest` move at release cadence, not per commit; anyone wanting
bleeding edge pins a `:sha-` tag. The update check adds outbound traffic to
`api.github.com`, disable-able in one switch for air-gapped setups.

Status: implemented
