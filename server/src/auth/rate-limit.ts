export interface RateLimitOptions {
  maxFailures?: number;

  baseDelayMs?: number;

  maxDelayMs?: number;

  forgiveAfterMs?: number;

  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;

  retryAfterMs: number;
}

interface Entry {
  consecutive: number;
  lastFailureAt: number;
  blockedUntil: number;
}

export interface LoginRateLimiter {
  check(key: string): RateLimitDecision;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;

  key(ip: string | undefined, username: string): string;
}

export function createLoginRateLimiter(opts: RateLimitOptions = {}): LoginRateLimiter {
  const maxFailures = opts.maxFailures ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 2_000;
  const maxDelayMs = opts.maxDelayMs ?? 60_000;
  const forgiveAfterMs = opts.forgiveAfterMs ?? 120_000;
  const now = opts.now ?? Date.now;

  const entries = new Map<string, Entry>();

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
