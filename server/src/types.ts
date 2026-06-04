/**
 * Shared server-side types.
 *
 * The normalized response shapes each integration emits are inferred from their
 * object literals (and mirror `client/src/types/index.ts` on the wire). What we
 * cannot usefully type is the *input* side: the raw JSON decoded from upstream
 * homelab APIs (UniFi, Proxmox, Portainer, UNAS, …) is large,
 * vendor-defined, and loosely versioned. We treat it as `Upstream` at the
 * integration boundary and narrow it into typed normalized shapes in each mapper.
 *
 * This alias is the single sanctioned `any` edge in the server codebase — every
 * other value is strictly typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Upstream = any;

/** Status descriptor every integration exports for /api/health + startup logs. */
export interface IntegrationStatus {
  enabled: boolean;
  configured: boolean;
  baseUrl?: string;
}
