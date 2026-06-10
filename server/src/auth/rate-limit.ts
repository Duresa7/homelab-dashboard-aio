// In-memory login throttle: per ip+username consecutive-failure counter with
// exponential backoff once the burst allowance is spent. No hard lockout — an
// attacker can slow a legitimate user down but never lock them out
// permanently. Single-process only, which matches how the server runs.

export interface RateLimitOptions {
  /** Burst of failures tolerated before backoff kicks in. */
  maxFailures?: number;
  /** First backoff delay; doubles per extra consecutive failure. */
  baseDelayMs?: number;
  /** Backoff ceiling. */
  maxDelayMs?: number;
  /** Quiet period after which the failure count is forgiven. */
  forgiveAfterMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** When blocked, how long until the next attempt is allowed. */
  retryAfterMs: number;
}

interface Entry {
  /** Consecutive failures since the last success / quiet period. */
  consecutive: number;
  lastFailureAt: number;
  blockedUntil: number;
}

export interface LoginRateLimiter {
  check(key: string): RateLimitDecision;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
  /** ip+username keys are normalized here so callers build them one way. */
  key(ip: string | undefined, username: string): string;
}

export function createLoginRateLimiter(opts: RateLimitOptions = {}): LoginRateLimiter {
  const maxFailures = opts.maxFailures ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 2_000;
  const maxDelayMs = opts.maxDelayMs ?? 60_000;
  const forgiveAfterMs = opts.forgiveAfterMs ?? 120_000;
  const now = opts.now ?? Date.now;

  const entries = new Map<string, Entry>();

  // Cheap stale-entry GC so the map can't grow unboundedly under scanning.
  const sweep = (t: number) => {
    if (entries.size < 1000) return;
    for (const [k, e] of entries) {
      if (t - e.lastFailureAt > forgiveAfterMs && e.blockedUntil <= t) entries.delete(k);
    }
  };

  return {
    key(ip: string | undefined, username: string): string {
      return `${ip ?? 'unknown'} ${username.toLowerCase()}`;
    },

    check(key: string): RateLimitDecision {
      const t = now();
      const e = entries.get(key);
      if (e && e.blockedUntil > t) return { allowed: false, retryAfterMs: e.blockedUntil - t };
      return { allowed: true, retryAfterMs: 0 };
    },

    recordFailure(key: string): void {
      const t = now();
      sweep(t);
      const e = entries.get(key) ?? { consecutive: 0, lastFailureAt: t, blockedUntil: 0 };
      if (t - e.lastFailureAt > forgiveAfterMs) e.consecutive = 0;
      e.consecutive += 1;
      e.lastFailureAt = t;
      if (e.consecutive >= maxFailures) {
        const over = e.consecutive - maxFailures;
        e.blockedUntil = t + Math.min(maxDelayMs, baseDelayMs * 2 ** over);
      }
      entries.set(key, e);
    },

    recordSuccess(key: string): void {
      entries.delete(key);
    },
  };
}
