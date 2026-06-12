export interface ApiErrorPayload {
  error?: unknown;
  message?: unknown;
}

export class ApiError extends Error {
  status: number;
  payload: ApiErrorPayload | null;

  constructor(message: string, status: number, payload: ApiErrorPayload | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

type AuthExpiredHandler = () => void;

let authExpiredHandler: AuthExpiredHandler | null = null;

export function setAuthExpiredHandler(handler: AuthExpiredHandler | null): void {
  authExpiredHandler = handler;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestPath(input: RequestInfo | URL): string {
  const url = requestUrl(input);
  if (url.startsWith('/')) return url;
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';
  return new URL(url, origin).pathname;
}

function shouldExpireAuth(input: RequestInfo | URL, res: Response): boolean {
  if (res.status !== 401 || !authExpiredHandler) return false;
  const path = requestPath(input);
  return path.startsWith('/api/') && !path.startsWith('/api/auth/');
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (shouldExpireAuth(input, res)) authExpiredHandler?.();
  return res;
}

async function readApiErrorPayload(res: Response): Promise<ApiErrorPayload | null> {
  const readable = typeof res.clone === 'function' ? res.clone() : res;
  return readable.json().catch(() => null) as Promise<ApiErrorPayload | null>;
}

function errorMessageFromPayload(payload: ApiErrorPayload | null, fallback: string): string {
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.message === 'string') return payload.message;
  return fallback;
}

export async function readApiError(
  res: Response,
  fallback = `HTTP ${res.status}`,
): Promise<string> {
  return errorMessageFromPayload(await readApiErrorPayload(res), fallback);
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) {
    const payload = await readApiErrorPayload(res);
    throw new ApiError(errorMessageFromPayload(payload, `HTTP ${res.status}`), res.status, payload);
  }
  return (await res.json()) as T;
}

export function jsonRequest(method: string, body: unknown, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    method,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
