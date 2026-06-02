/**
 * Wrap an async fetcher with a single-slot time-to-live cache, replacing the
 * `let cache = { data, ts }` + manual TTL-check boilerplate repeated across
 * every integration.
 *
 * Behavior matches the hand-rolled version exactly:
 *  - a fresh cache hit (within `ttlMs`) returns the cached value without calling
 *    `fetchFn` and without touching `lastError`;
 *  - on success the value + timestamp are stored and `lastError` is cleared;
 *  - on error the previous cached value/timestamp are left intact (so a stale
 *    value can still satisfy a later in-TTL hit) and `lastError` is recorded,
 *    then the error re-throws so the route can answer 502.
 *
 * `peek()` exposes `{ data, ts, lastError }` for the integration's debug route.
 *
 * @template T
 * @param {() => Promise<T>} fetchFn
 * @param {number} ttlMs
 */
export function withTtlCache(fetchFn, ttlMs) {
  const state = { data: null, ts: 0, lastError: null };

  const cached = async () => {
    const now = Date.now();
    if (state.data && now - state.ts < ttlMs) return state.data;
    try {
      const data = await fetchFn();
      state.data = data;
      state.ts = now;
      state.lastError = null;
      return data;
    } catch (err) {
      state.lastError = err.message;
      throw err;
    }
  };

  cached.peek = () => state;
  return cached;
}
