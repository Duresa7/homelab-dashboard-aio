import { errorMessage } from './errors.js';

export interface TtlCacheState<T> {
  data: T | null;
  ts: number;
  lastError: string | null;
}

export interface CachedFn<T> {
  (): Promise<T>;

  peek(): TtlCacheState<T>;

  clear(): void;
}

export function withTtlCache<T>(fetchFn: () => Promise<T>, ttlMs: number): CachedFn<T> {
  const state: TtlCacheState<T> = { data: null, ts: 0, lastError: null };

  const cached = async (): Promise<T> => {
    const now = Date.now();
    if (state.data && now - state.ts < ttlMs) return state.data;
    try {
      const data = await fetchFn();
      state.data = data;
      state.ts = now;
      state.lastError = null;
      return data;
    } catch (err) {
      state.lastError = errorMessage(err);
      throw err;
    }
  };

  cached.peek = () => state;
  cached.clear = () => {
    state.data = null;
    state.ts = 0;
    state.lastError = null;
  };
  return cached;
}
