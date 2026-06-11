import { Agent, fetch as undiciFetch } from 'undici';

import { errorMessage } from './errors.js';

type FetchInput = Parameters<typeof undiciFetch>[0];
type FetchInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
type FetchResponse = Awaited<ReturnType<typeof undiciFetch>>;

const insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

export const insecureFetch = (url: FetchInput, opts: FetchInit = {}): Promise<FetchResponse> =>
  undiciFetch(url, { ...opts, dispatcher: insecureDispatcher });

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
