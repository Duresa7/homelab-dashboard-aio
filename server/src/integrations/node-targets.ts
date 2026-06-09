// Per-node remote-target resolution shared by the GPU and sensors integrations.
//
// A homelab Proxmox cluster has N nodes; per-node GPU/temperature data must be
// collected from each one. Targets come from a config map (PROXMOX_NODE_TARGETS,
// keyed by canonical Proxmox node name) with a single-host fallback so existing
// installs keep working. Some nodes are firewalled from the dashboard host but
// reachable via a peer — hence the optional jumpHost (SSH ProxyJump).
import { errorMessage } from '../lib/errors.js';
import type { NodeUnavailable } from '../../../shared/wire.ts';

export interface NodeTarget {
  /** Canonical Proxmox node name — the join key for the UI. */
  node: string;
  mode: string; // 'ssh' | 'local'
  host: string;
  user: string;
  port: number;
  keyPath: string;
  jumpHost?: string;
  jumpUser?: string;
  jumpPort?: number;
}

export interface TargetDefaults {
  mode: string;
  host: string;
  user: string;
  port: number;
  keyPath: string;
}

export interface ResolveNodeTargetsOpts {
  /** Raw PROXMOX_NODE_TARGETS env value: JSON map of node name -> overrides. */
  targetsJson?: string;
  /** Canonical primary node name (PROXMOX_NODE) for the single-host fallback. */
  primaryNode?: string;
  /** Single-host defaults; also the fallback target when no map is configured. */
  defaults: TargetDefaults;
}

type RawTarget = {
  mode?: unknown;
  host?: unknown;
  user?: unknown;
  port?: unknown;
  keyPath?: unknown;
  jumpHost?: unknown;
  jumpUser?: unknown;
  jumpPort?: unknown;
};

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function int(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseTargetsMap(json?: string): Record<string, RawTarget> | null {
  if (!json || !json.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, RawTarget>;
  } catch {
    return null;
  }
}

/**
 * Build the list of per-node remote targets.
 *
 * With a valid PROXMOX_NODE_TARGETS map, returns one target per entry (each
 * inheriting the single-host defaults for any field it omits). Otherwise falls
 * back to a single target — the existing single-host config — attributed to the
 * primary node name, so single-host installs are unchanged.
 */
export function resolveNodeTargets(opts: ResolveNodeTargetsOpts): NodeTarget[] {
  const { targetsJson, primaryNode, defaults } = opts;
  const map = parseTargetsMap(targetsJson);

  if (map) {
    const targets: NodeTarget[] = [];
    for (const [node, raw] of Object.entries(map)) {
      const mode = str(raw.mode) || defaults.mode;
      const host = str(raw.host) || (mode === 'local' ? '' : defaults.host);
      if (mode !== 'local' && !host) continue; // an SSH target needs a host
      targets.push({
        node,
        mode,
        host,
        user: str(raw.user) || defaults.user,
        port: int(raw.port) ?? defaults.port,
        keyPath: str(raw.keyPath) ?? defaults.keyPath,
        jumpHost: str(raw.jumpHost),
        jumpUser: str(raw.jumpUser),
        jumpPort: int(raw.jumpPort),
      });
    }
    if (targets.length) return targets;
  }

  if (defaults.mode === 'local' || defaults.host) {
    return [
      {
        node: str(primaryNode) || defaults.host || 'node',
        mode: defaults.mode,
        host: defaults.host,
        user: defaults.user,
        port: defaults.port,
        keyPath: defaults.keyPath,
      },
    ];
  }

  return [];
}

export interface PerNodeCollection<T> {
  results: Array<{ node: string; data: T }>;
  unavailable: NodeUnavailable[];
}

/**
 * Run `fetchOne` for every target concurrently. A target that rejects is
 * recorded in `unavailable` and never fails the whole batch; a target that
 * resolves — even to an "empty" value (no GPU / no sensors) — counts as a
 * success. This is the graceful-degradation core: one unreachable node must
 * not blank the rest of the cluster.
 */
export async function collectPerNode<T>(
  targets: NodeTarget[],
  fetchOne: (target: NodeTarget) => Promise<T>,
): Promise<PerNodeCollection<T>> {
  const settled = await Promise.allSettled(
    targets.map(async (target) => ({ node: target.node, data: await fetchOne(target) })),
  );
  const results: Array<{ node: string; data: T }> = [];
  const unavailable: NodeUnavailable[] = [];
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') results.push(outcome.value);
    else unavailable.push({ node: targets[i].node, reason: errorMessage(outcome.reason) });
  });
  return { results, unavailable };
}
