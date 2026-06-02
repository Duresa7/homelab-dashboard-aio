import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { withTtlCache } from './cache.js';
import { makeSafeFetch } from './http.js';
import { isEnabled, trimBaseUrl, formatUptime } from './env.js';

describe('withTtlCache', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the cached value within the TTL without re-calling', async () => {
    const fetchFn = vi.fn(async () => ({ stamp: Date.now() }));
    const cached = withTtlCache(fetchFn, 1000);
    const a = await cached();
    vi.advanceTimersByTime(500);
    const b = await cached();
    expect(b).toBe(a);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the TTL expires', async () => {
    let n = 0;
    const cached = withTtlCache(async () => ({ n: ++n }), 1000);
    expect((await cached()).n).toBe(1);
    vi.advanceTimersByTime(1001);
    expect((await cached()).n).toBe(2);
  });

  it('records lastError and re-throws on failure, preserving stale data', async () => {
    let mode = 'ok';
    const cached = withTtlCache(async () => {
      if (mode === 'fail') throw new Error('boom');
      return { ok: true };
    }, 1000);
    const good = await cached();
    vi.advanceTimersByTime(2000);
    mode = 'fail';
    await expect(cached()).rejects.toThrow('boom');
    expect(cached.peek().lastError).toBe('boom');
    expect(cached.peek().data).toBe(good);
  });
});

describe('makeSafeFetch', () => {
  it('returns the fallback and warns on error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const safe = makeSafeFetch('Test', async () => {
      throw new Error('down');
    });
    expect(await safe('/x', 'fb')).toBe('fb');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Test: /x failed'));
    warn.mockRestore();
  });

  it('passes through the value on success', async () => {
    const safe = makeSafeFetch('Test', async (p) => `ok:${p}`);
    expect(await safe('/y')).toBe('ok:/y');
  });
});

describe('env helpers', () => {
  const prev = process.env.DISABLE_ALL;
  afterEach(() => {
    if (prev === undefined) delete process.env.DISABLE_ALL;
    else process.env.DISABLE_ALL = prev;
  });

  it('isEnabled respects defaults and falsy values', () => {
    delete process.env.DISABLE_ALL;
    expect(isEnabled(undefined, true)).toBe(true);
    expect(isEnabled(undefined, false)).toBe(false);
    expect(isEnabled('false')).toBe(false);
    expect(isEnabled('off')).toBe(false);
    expect(isEnabled('true')).toBe(true);
  });

  it('isEnabled honors the DISABLE_ALL kill-switch', () => {
    process.env.DISABLE_ALL = 'true';
    expect(isEnabled('true')).toBe(false);
    process.env.DISABLE_ALL = 'false';
    expect(isEnabled('true')).toBe(true);
  });

  it('trimBaseUrl strips trailing slashes', () => {
    expect(trimBaseUrl('http://x/')).toBe('http://x');
    expect(trimBaseUrl('http://x///')).toBe('http://x');
    expect(trimBaseUrl(undefined)).toBe('');
  });

  it('formatUptime formats day/hour', () => {
    expect(formatUptime(0)).toBe('—');
    expect(formatUptime(3600)).toBe('1h');
    expect(formatUptime(90000)).toBe('1d 1h');
  });
});
