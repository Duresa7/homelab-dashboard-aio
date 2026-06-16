# Intel AMT integration

This ADR records the design choices behind the Intel Active Management
Technology (AMT) integration. AMT is out-of-band management for physical
machines, so it does not fit the same shape as the dashboard's single-endpoint
API integrations.

## Multi-device architecture

AMT uses a device registry stored under `amt.devices` in `app_state` instead of
the normal single-endpoint capability config pattern. A homelab may have many
AMT-capable bare-metal machines, each with its own host, port, username,
password, and TLS setting. Treating those as one capability endpoint would
either hide real per-device state in one large config field or force users to
duplicate the whole integration for every machine.

The registry keeps AMT device lifecycle operations close to the AMT provider:
`GET/POST/PUT/DELETE /api/amt/devices` manages endpoints, while the standard
provider fetch still returns aggregate AMT telemetry at `GET /api/amt`.
Passwords are encrypted at rest with the same app secret-key mechanism used for
other stored secrets.

## WSMAN toolkit choice

AMT talks WSMAN, a SOAP-over-HTTP protocol with verbose XML envelopes and
class-specific request bodies. The integration uses
`@open-amt-cloud-toolkit/wsman-messages` to generate WSMAN/CIM request XML
instead of hand-building SOAP strings throughout the provider.

That keeps dashboard code focused on transport, authentication, response
mapping, and error handling. Response parsing remains intentionally small and
namespace-tolerant because the integration only reads a narrow set of known AMT
fields.

## Digest auth

AMT endpoints require HTTP Digest Authentication. The implementation is manual
and local because the required flow is small: parse `WWW-Authenticate`, compute
the RFC 7616 MD5 response, cache the nonce, and increment `nc` for sequential
requests.

Avoiding a digest-auth package keeps the dependency surface small and makes the
nonce behavior testable. The code never logs credentials, and surfaced errors
include the AMT host and failure class without including usernames or
passwords.

## TLS recommendation

The default AMT port is `16993` with TLS enabled. Port `16992` remains supported
for older or explicitly configured HTTP deployments, but 12th generation and
later Intel platforms have deprecated plain HTTP management paths, so the
dashboard defaults to the TLS WSMAN endpoint.

Many homelab AMT deployments use self-signed firmware certificates. The WSMAN
transport therefore uses the dashboard's `insecureFetch` helper, which accepts
self-signed certificates for this AMT-only path. This is an explicit homelab
tradeoff: prefer encrypted transport by default while still allowing firmware
certificates that are not issued by a public CA.

## Phase 2 KVM deferral

KVM/redirection is out of scope for the first AMT integration. It needs a VNC or
similar viewer experience, a WebSocket proxy from the browser to the management
channel, redirection-port handling, and a separate security review for an
interactive remote-console path.

The initial integration focuses on higher-value dashboard primitives: power
state, power actions, reachability, and hardware inventory. KVM is less useful
without OS-level coordination and session controls, so it is better handled as a
separate phase.

## Polling strategy

AMT status is polled with `withTtlCache` at a 15 second default interval instead
of using SSE or WebSockets. WSMAN is a request-response SOAP protocol for these
operations, not an event stream, and the dashboard only needs coarse state for
cards and power controls.

The TTL cache prevents repeated UI reads from re-polling every configured
machine while still keeping power state fresh enough for a dashboard. Mutating
operations such as power actions and device registry changes clear the cache so
the next read observes the latest known state.

Status: implemented
