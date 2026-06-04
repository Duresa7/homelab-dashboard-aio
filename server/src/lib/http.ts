import { Agent, fetch as undiciFetch } from 'undici';

import { errorMessage } from './errors.js';

type FetchInput = Parameters<typeof undiciFetch>[0];
type FetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

// Homelab gear uses self-signed certs; skip TLS verification on these fetches only.
const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

export const insecureFetch = (url: FetchInput, opts: FetchInit = {}): Promise<FetchResponse> =>
  undiciFetch(url, { ...opts, dispatcher: insecureDispatcher });

/**
 * Wrap an integration fetcher so a failed upstream call logs a warning and
 * resolves to `fallback` instead of throwing. Used for non-critical sub-resource
 * calls (the primary call is left un-wrapped so the route can surface a 502).
 *
 * @param name    integration label used in the warning line
 * @param fetchFn the underlying fetcher (called with just a path)
 */
export function makeSafeFetch<T>(
  name: string,
  fetchFn: (path: string) => Promise<T>,
): (path: string, fallback?: T | null) => Promise<T | null> {
  return async function safeFetch(path: string, fallback: T | null = null): Promise<T | null> {
    try {
      return await fetchFn(path);
    } catch (err) {
      console.warn(`${name}: ${path} failed → ${errorMessage(err)}`);
      return fallback;
    }
  };
}
