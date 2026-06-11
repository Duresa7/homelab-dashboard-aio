# Homelab Dashboard Security Audit - 2026-06-11

## Scope

- Target: full repository-wide scan of `Homelab-Dashboard`.
- Scan bundle: `C:\tmp\codex-security-scans\Homelab-Dashboard\7dedbcb_20260611023647`.
- Final Codex Security reports:
  - Markdown: `C:\tmp\codex-security-scans\Homelab-Dashboard\7dedbcb_20260611023647\report.md`
  - HTML: `C:\tmp\codex-security-scans\Homelab-Dashboard\7dedbcb_20260611023647\report.html`
- Note: delegated deep fanout could not complete normally because the workspace reported it was out of credits. The final scan is an ordinary repository-wide scan assembled from completed discovery artifacts plus central validation.

## Executive Summary

The scan found four still-open security issues and two issue families fixed in this PR.

The largest remaining product decision is authentication: the dashboard is host-networked and LAN-reachable, while the API has no application auth layer. The existing same-origin guard is useful browser CSRF protection, but it is not an authorization control for direct clients.

## Open Findings

| ID         | Severity | Confidence | Finding                                                                          |
| ---------- | -------- | ---------- | -------------------------------------------------------------------------------- |
| HD-CAN-001 | Medium   | High       | LAN-reachable API has unauthenticated privileged reads and mutations.            |
| HD-CAN-002 | Medium   | High       | Setup connection tests provide unauthenticated server-side HTTP and SQL probing. |
| HD-CAN-003 | Medium   | High       | Credential-bearing outbound paths disable TLS certificate verification.          |
| HD-CAN-004 | Low      | Medium     | SIEM UDP ingestion accepts unauthenticated messages from any source by default.  |

### HD-CAN-001 - LAN-reachable API has unauthenticated privileged reads and mutations

The API is reachable on a host-network listener and has no application auth middleware. Mutating routes rely on `makeSameOriginGuard`, which explicitly allows requests with no `Origin` and no `Referer`; read routes do not use the guard.

Affected areas include:

- `server/src/state/index.ts`
- `server/src/setup/index.ts`
- `server/src/integrations/wol.ts`
- provider, SIEM, Proxmox history, and sensor read routes
- `docker-compose.deploy.yml`

Recommended remediation: add an application authentication boundary for API routes, or enforce a deployment contract requiring an authenticating reverse proxy or VPN. Treat same-origin checks as CSRF defense only.

### HD-CAN-002 - Setup connection tests provide unauthenticated server-side HTTP and SQL probing

Setup test routes accept caller-selected HTTP base URLs and SQL host/port settings, then issue outbound requests or database connection attempts from the dashboard host.

Recommended remediation: require operator authentication on setup test routes and add an egress policy for test destinations, especially loopback, link-local, RFC1918, and metadata-like addresses.

### HD-CAN-003 - Credential-bearing outbound paths disable TLS certificate verification

The shared integration fetch helper and SQL SSL config use `rejectUnauthorized: false` while sending API tokens or database credentials.

Recommended remediation: default to normal certificate validation, add per-upstream CA bundle or fingerprint pinning for self-signed homelab devices, and make insecure TLS an explicit per-endpoint opt-in.

### HD-CAN-004 - SIEM UDP ingestion accepts unauthenticated messages from any source by default

When SIEM is enabled and `SIEM_ALLOWED_SOURCES` is unset, the UDP listener accepts syslog datagrams from any reachable sender.

Recommended remediation: require `SIEM_ALLOWED_SOURCES` when binding SIEM on a non-loopback address, or default to deny-all/localhost-only until the operator configures allowed device IPs.

## Fixed In This PR

### Endpoint-change integration secret replay

Persistent integration config previously retained old provider secrets when saving a changed `baseUrl`. This could replay Proxmox, UniFi, Portainer, or UNAS credentials to a newly selected endpoint.

Fix:

- `server/src/setup/integration-config.ts` now requires fresh secret fields when saving a different base URL.
- Regression coverage added in `server/src/setup/integration-config.test.ts` and `server/src/setup/index.test.ts`.

### Same-driver DB password replay

Database setup previously retained a stored PostgreSQL/MySQL password based only on driver equality. A changed host/database/user could inherit the old password.

Fix:

- `server/src/setup/index.ts` now only retains the stored password when host, port, database, user, and SSL setting match the current endpoint.
- Regression coverage added in `server/src/setup/index.test.ts`.

### Stored bookmark active URL persistence

Hydrated or imported bookmark state could keep non-http URLs that bypassed the edit form's URL validator.

Fix:

- `client/src/lib/bookmarks.ts` now runs stored bookmarks through `validateBookmarkUrl` and drops non-http(s) values.
- Regression coverage added in `client/src/lib/bookmarks.test.ts`.

## Validation

Focused checks run:

- `npm test -- server/src/setup/index.test.ts`
- `npm test -- server/src/setup/integration-config.test.ts`
- `npm test -- client/src/lib/bookmarks.test.ts`

Full repository verification:

- `npm run verify` passed.
- Lint completed with existing warnings and no errors.
