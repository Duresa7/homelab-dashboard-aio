import { errorMessage } from '../lib/errors.js';
import type { NodeUnavailable } from '../../../shared/wire.ts';

export interface NodeTarget {
  node: string;
  mode: string;
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
  targetsJson?: string;

  primaryNode?: string;

  defaults: TargetDefaults;
}

let setupTargetsJson: string | undefined;
let setupPrimaryNode: string | undefined;

export function configureSetupNodeTargets(opts: {
  targetsJson?: string;
  primaryNode?: string;
}): void {
  setupTargetsJson = opts.targetsJson?.trim() || undefined;
  setupPrimaryNode = opts.primaryNode?.trim() || undefined;
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

export function resolveNodeTargets(opts: ResolveNodeTargetsOpts): NodeTarget[] {
  const { defaults } = opts;
  const targetsJson = opts.targetsJson?.trim() || setupTargetsJson;
  const primaryNode = opts.primaryNode?.trim() || setupPrimaryNode;
  const map = parseTargetsMap(targetsJson);

  if (map) {
    const targets: NodeTarget[] = [];
    for (const [node, raw] of Object.entries(map)) {
      const mode = str(raw.mode) || defaults.mode;
      const host = str(raw.host) || (mode === 'local' ? '' : defaults.host);
      if (mode !== 'local' && !host) continue;
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
