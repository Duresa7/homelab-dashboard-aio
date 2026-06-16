# Placeholder & redaction conventions

The repo is public and runs a layered secret/PII scan (gitleaks rules + Husky
pre-push + CI `security.yml`, plus an operator-private `PII_DENYLIST` injected at
CI time). The scanning was solid, but the _placeholder values_ a contributor is
supposed to use were scattered across `CONTRIBUTING.md`, the PR template, the
issue templates, and the gitleaks rule descriptions, and they read as tailored to
the maintainer's own lab. This ADR records one canonical, generic placeholder
scheme so contributors have a single simple rule set, and notes the choices that
were non-obvious.

## Canonical placeholders

| Thing                                           | Placeholder                                          |
| ----------------------------------------------- | ---------------------------------------------------- |
| Private / LAN IPv4                              | `192.168.255.x`                                      |
| Public / external IPv4 (and multi-subnet tests) | `192.0.2.x`, `198.51.100.x`, `203.0.113.x` (RFC5737) |
| IPv6                                            | `2001:db8::/32` (RFC3849)                            |
| MAC                                             | `AA:BB:CC:DD:EE:FF`                                  |
| Hostname / cluster nodes                        | `example.test`, `node-a` / `node-b` / `node-c`       |
| Username                                        | `changeme-user`                                      |
| Password                                        | `change-me-soon-purple-otter-42`                     |
| Email                                           | `changeme@example.com`                               |
| Secrets / API tokens                            | left blank                                           |

The contributor-facing copy lives in `CONTRIBUTING.md`; the templates and the
gitleaks rule descriptions point at it rather than restating it.

## Why two IPv4 ranges instead of one

`192.168.255.x` is the friendly, everyday "a device on my LAN" placeholder: it
keeps the familiar `192.168` shape, but `.255` is a subnet almost nobody actually
runs. That distinction is load-bearing — the `private-ipv4` gitleaks rule
allowlists only `192.168.255.x`, so every _other_ RFC1918 address (a likely real
leak, including the common `192.168.0.x` / `192.168.1.x` defaults) is still
blocked. Allowlisting a real-world-common subnet would have gutted the rule.

The RFC5737 documentation ranges stay for two cases a single subnet can't serve:

- **Public / external addresses** (a WAN IP, an external log source) — semantically
  these are not LAN addresses, so reusing the private placeholder would be wrong.
- **Tests that need several distinct networks** — e.g. the SIEM CIDR matcher
  (`server/src/siem/source-guard.test.ts`) asserts one subnet is in range and a
  _different_ one is not, and the SSRF guard (`server/src/lib/net-guard.test.ts`)
  exercises multiple RFC1918 ranges (assembled from octets at runtime so no literal
  private address appears). A single allowlisted `/24` cannot express "a different
  network."

Existing fixtures were migrated to `192.168.255.x` only where the value clearly
meant a LAN device; public-IP fields and the multi-subnet tests kept their RFC5737
values.

## Why this exact password

The password placeholder doubles as the test-suite password, so it must clear the
real policy (length 10–128, zxcvbn score ≥ 3 with the username fed in as a
penalized input — see
[0006-authentication-and-security-hardening.md](0006-authentication-and-security-hardening.md)).
A `changeme-password`-style value fails: zxcvbn rates the literal word "password"
as the most-guessable token, and the `changeme` overlap with `changeme-user` is
penalized again. `change-me-soon-purple-otter-42` reads as an obvious placeholder,
avoids the word "password", and scores ≥ 3.

## What was deliberately left out

- **No app-side rejection of `changeme-*` values.** This is a convention, not an
  enforced check; bootstrap is already interactive, so there is no default
  credential to reject.
- **`PII_DENYLIST` stays.** It protects the operator's real hostnames/IPs/domain
  and is orthogonal to contributor-facing placeholder simplicity.

Status: implemented
