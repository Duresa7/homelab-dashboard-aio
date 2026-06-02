import { Agent, fetch as undiciFetch } from 'undici';

// Homelab gear uses self-signed certs; skip TLS verification on these fetches only.
// Exported so integrations that bypass `insecureFetch` (e.g. the Protect
// WebSocket) can reuse the same dispatcher.
export const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

export const insecureFetch = (url, opts = {}) =>
  undiciFetch(url, { ...opts, dispatcher: insecureDispatcher });

/**
 * Wrap an integration fetcher so a failed upstream call logs a warning and
 * resolves to `fallback` instead of throwing. Used for non-critical sub-resource
 * calls (the primary call is left un-wrapped so the route can surface a 502).
 *
 * @param {string} name  integration label used in the warning line
 * @param {(path: string) => Promise<any>} fetchFn
 */
export function makeSafeFetch(name, fetchFn) {
  return async function safeFetch(path, fallback = null) {
    try {
      return await fetchFn(path);
    } catch (err) {
      console.warn(`${name}: ${path} failed → ${err.message}`);
      return fallback;
    }
  };
}
