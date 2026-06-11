# Authentication layer + security hardening (issue #41)

The dashboard previously trusted anyone who could reach the port: no login, no
API auth, only a same-origin guard on writes and a `DEBUG_ENDPOINTS_ENABLED`
env gate. This ADR records the auth design and the security-audit findings and
fixes that shipped with it.

## Auth model

- **Multi-user accounts** (`users` table in the state DB): lowercase `username`
  (login id), display name, optional email (informational only — there is no
  SMTP; password recovery is admin reset or the offline CLI), argon2id password
  hash.
- **Three roles** enforced server-side by a central matrix
  (`server/src/auth/middleware.ts:requiredRoleFor`):
  - **viewer** — any authenticated user; all GET data routes (state reads,
    providers, sensors, SIEM incl. SSE, `/api/setup/status|capabilities`).
  - **member** — state writes (`PUT/DELETE /api/state/*`, `_import`) and
    `POST /api/wol/wake`.
  - **admin** — `/api/setup/*` config reads+writes (they reveal hosts and
    usernames), `/api/users/*`, and all `*/debug` endpoints (which additionally
    keep the `DEBUG_ENDPOINTS_ENABLED` env gate).
    The whole protection table lives in one reviewable function instead of being
    scattered across route modules; the gate itself default-denies every `/api`
    path not on a small public allowlist.
- **Auth is mandatory.** Zero users in the active state DB → bootstrap mode:
  only `GET /api/auth/status` and `POST /api/auth/bootstrap` work and the
  client forces a full-screen "create admin account" flow. This one invariant
  covers fresh installs, upgrades of existing installs, and switching the DB
  backend mid-onboarding (the new DB has zero users → the screen reappears).
  The first account is always an admin. Offline rescue/seeding:
  `npm run user:seed-admin`, `npm run user:reset-password -- <username>`.

## Sessions

- 32-byte random token in an `hd_session` cookie: `HttpOnly`, `SameSite=Lax`,
  `Path=/`, `Secure` when the request is HTTPS (directly or via
  `X-Forwarded-Proto` from a proxy trusted through `TRUST_PROXY`).
- The DB stores only the **SHA-256 of the token** — a leaked DB does not yield
  usable session cookies.
- 30-day sliding expiry; renewal writes throttled to once per hour per
  session. "Remember me" unchecked → no `Max-Age` (browser-session cookie);
  the server row still expires on the sliding window.
- Password change revokes all other sessions; admin password reset and role
  changes revoke the affected user's sessions. Expired rows are swept at boot
  and daily.

## Password policy (NIST 800-63B style)

Length 10–128 plus a zxcvbn score ≥ 3, with the user's username/display
name/email fed in as penalized inputs. **No composition rules** — they push
users toward `Password1!` patterns. zxcvbn's ~30k-word dictionaries subsume a
separate top-10k common-password blocklist, so none is vendored. The client
shows a live meter (dictionaries dynamic-imported, out of the main bundle);
the server enforces the same check on every password-setting endpoint.

## TOTP 2FA (optional, per user)

QR enrollment (`otpauth://` URI rendered server-side via `qrcode`), 6-digit
codes verified with ±30s tolerance, 10 single-use recovery codes stored
argon2-hashed and burned on use; plaintext shown exactly once. Login becomes a
two-step flow via a short-lived (5 min) in-memory pending token. **Accepted
risk:** the TOTP secret is stored plaintext in the DB — it must be readable to
verify codes, and encrypting it with a key on the same single box adds no real
barrier. Noted for a future KMS/keyfile setup.

## Login rate limiting

In-memory (single process) per ip+username: 5 consecutive failures, then
exponential backoff 2s → 60s cap; a 2-minute quiet period forgives the
counter. **No hard lockout** — an attacker can slow the real user down but
never lock them out. Failures are logged with username and source IP. 429
responses carry `Retry-After`.

## Reverse-proxy auth (optional, off by default)

`AUTH_PROXY_ENABLED=true` + `AUTH_PROXY_HEADER` (default `remote-user`) +
`AUTH_PROXY_TRUSTED_IPS` (exact IPs). A header asserted from a trusted proxy
maps onto an **existing local user**; the role always comes from the local
account and unknown usernames are rejected. SSO (Authentik/Authelia) decides
_who logs in_, never who exists or what they may do. Set `TRUST_PROXY` so
`req.ip`/`req.secure` reflect `X-Forwarded-*`.

## CSRF posture

`SameSite=Lax` cookies are the primary CSRF defense; the pre-existing
same-origin guard (Origin/Referer vs Host) stays on every mutating route —
including the new auth routes — as defense in depth. Requests with neither
Origin nor Referer (CLI/curl) pass the guard but still need a valid session.

## Audit findings fixed

- `/api/health` leaked the full integration inventory (which services exist,
  whether they hold API keys) pre-auth. Now unauthenticated callers get only
  `{ok:true}` (the client heartbeat needs that); the full payload requires a
  session.
- `GET /api/setup/config` / `GET /api/setup/db` exposed integration hosts and
  usernames (redacted secrets, but still topology) to anyone — now admin-only.
- Debug endpoints (`/api/state/debug`, `/api/sensors/debug`, provider
  `/debug`, legacy `/api/debug`) were gated only by an env var — now admin
  **and** the env var.
- `helmet` security headers with a tailored CSP:
  `default-src 'self'`, `script-src 'self'`, `connect-src 'self'`,
  `style-src 'self' 'unsafe-inline'` (inline style attributes from the UI
  libs), `img-src * data: blob:` — images stay open because bookmark tiles
  load favicons from arbitrary user-added LAN hosts and brand icons come from
  icon CDNs; images are not the load-bearing directive.
- Mid-session 401s flip the client to the login screen via a fetch wrapper
  (`client/src/lib/auth.ts:installAuthExpiryInterceptor`) instead of surfacing
  as generic errors — chosen over threading 401 handling through every call
  site in `lib/`.

## Notes

- The auth store shares the state DB Kysely instance and the portable
  migration runner, so SQLite/Postgres/MySQL all work (`004_users`,
  `005_sessions`).
- The Vite dev proxy needs no changes: `changeOrigin:false` preserves the Host
  header for the same-origin guard, and cookies are port-agnostic across
  :5173 → :3001.

Status: implemented
