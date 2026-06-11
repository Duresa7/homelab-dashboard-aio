import { useSyncExternalStore } from 'react';

export type UserRole = 'admin' | 'member' | 'viewer';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  role: UserRole;
  totpEnabled: boolean;
  createdAt: number;
  passwordChangedAt: number;
}

export interface AuthState {
  usersExist: boolean | null;
  user: AuthUser | null;
  via: 'session' | 'proxy' | null;
}

export interface AuthSessionInfo {
  id: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  remember: boolean;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

type Listener = () => void;

let authState: AuthState = { usersExist: null, user: null, via: null };
const listeners = new Set<Listener>();

function setAuthState(next: AuthState): void {
  authState = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, () => authState);
}

export function getAuthState(): AuthState {
  return authState;
}

export function canEdit(user: AuthUser | null): boolean {
  return user?.role === 'admin' || user?.role === 'member';
}

export function isAdmin(user: AuthUser | null): boolean {
  return user?.role === 'admin';
}

let interceptorInstalled = false;

export function installAuthExpiryInterceptor(): void {
  if (interceptorInstalled || typeof window === 'undefined') return;
  interceptorInstalled = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    if (res.status === 401 && authState.user) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.startsWith('/') ? url : new URL(url, window.location.origin).pathname;
      if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) {
        setAuthState({ ...authState, user: null, via: null });
      }
    }
    return res;
  };
}

interface ApiError {
  error?: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as ApiError;
    return body.error || fallback;
  } catch {
    return fallback;
  }
}

export async function fetchAuthStatus(): Promise<AuthState> {
  const res = await fetch('/api/auth/status');
  if (!res.ok) throw new Error(await readError(res, `auth status failed (${res.status})`));
  const body = (await res.json()) as {
    usersExist: boolean;
    authenticated: boolean;
    user?: AuthUser;
    via?: 'session' | 'proxy';
  };
  const next: AuthState = {
    usersExist: body.usersExist,
    user: body.authenticated && body.user ? body.user : null,
    via: body.via ?? null,
  };
  setAuthState(next);
  return next;
}

export interface LoginResult {
  totpRequired?: boolean;
  pendingToken?: string;
  retryAfterMs?: number;
}

export async function login(
  username: string,
  password: string,
  remember: boolean,
): Promise<LoginResult> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, remember }),
  });
  const body = (await res.json().catch(() => ({}))) as ApiError & LoginResult & { user?: AuthUser };
  if (!res.ok) {
    const err = new Error(body.error || `login failed (${res.status})`);
    if (body.retryAfterMs)
      (err as Error & { retryAfterMs?: number }).retryAfterMs = body.retryAfterMs;
    throw err;
  }
  if (body.totpRequired && body.pendingToken) {
    return { totpRequired: true, pendingToken: body.pendingToken };
  }
  if (body.user) setAuthState({ usersExist: true, user: body.user, via: 'session' });
  return {};
}

export async function loginTotp(pendingToken: string, code: string): Promise<void> {
  const res = await fetch('/api/auth/login/totp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pendingToken, code }),
  });
  const body = (await res.json().catch(() => ({}))) as ApiError & { user?: AuthUser };
  if (!res.ok) throw new Error(body.error || `code rejected (${res.status})`);
  if (body.user) setAuthState({ usersExist: true, user: body.user, via: 'session' });
}

export async function bootstrapAdmin(input: {
  username: string;
  displayName: string;
  email: string | null;
  password: string;
}): Promise<void> {
  const res = await fetch('/api/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as ApiError & { user?: AuthUser };
  if (!res.ok) throw new Error(body.error || `account creation failed (${res.status})`);
  if (body.user) setAuthState({ usersExist: true, user: body.user, via: 'session' });
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {
    void 0;
  });
  setAuthState({ ...authState, user: null, via: null });
}

export async function changePassword(current: string, next: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current, next }),
  });
  if (!res.ok) throw new Error(await readError(res, `password change failed (${res.status})`));
}

export async function updateProfile(patch: {
  displayName?: string;
  email?: string | null;
}): Promise<void> {
  const res = await fetch('/api/auth/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = (await res.json().catch(() => ({}))) as ApiError & { user?: AuthUser };
  if (!res.ok) throw new Error(body.error || `profile update failed (${res.status})`);
  if (body.user) setAuthState({ ...authState, user: body.user });
}

export async function listSessions(): Promise<AuthSessionInfo[]> {
  const res = await fetch('/api/auth/sessions');
  if (!res.ok) throw new Error(await readError(res, `sessions failed (${res.status})`));
  const body = (await res.json()) as { sessions: AuthSessionInfo[] };
  return body.sessions;
}

export async function revokeSession(id: string): Promise<void> {
  const res = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await readError(res, `revoke failed (${res.status})`));
}

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export async function totpSetup(): Promise<TotpSetup> {
  const res = await fetch('/api/auth/totp/setup', { method: 'POST' });
  if (!res.ok) throw new Error(await readError(res, `setup failed (${res.status})`));
  return (await res.json()) as TotpSetup;
}

export async function totpEnable(code: string): Promise<string[]> {
  const res = await fetch('/api/auth/totp/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = (await res.json().catch(() => ({}))) as ApiError & { recoveryCodes?: string[] };
  if (!res.ok) throw new Error(body.error || `enable failed (${res.status})`);
  if (authState.user) {
    setAuthState({ ...authState, user: { ...authState.user, totpEnabled: true } });
  }
  return body.recoveryCodes ?? [];
}

export async function totpDisable(password: string): Promise<void> {
  const res = await fetch('/api/auth/totp/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await readError(res, `disable failed (${res.status})`));
  if (authState.user) {
    setAuthState({ ...authState, user: { ...authState.user, totpEnabled: false } });
  }
}

export async function listUsers(): Promise<AuthUser[]> {
  const res = await fetch('/api/users');
  if (!res.ok) throw new Error(await readError(res, `users failed (${res.status})`));
  return ((await res.json()) as { users: AuthUser[] }).users;
}

export async function createUser(input: {
  username: string;
  displayName: string;
  email: string | null;
  password: string;
  role: UserRole;
}): Promise<AuthUser> {
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as ApiError & { user?: AuthUser };
  if (!res.ok || !body.user) throw new Error(body.error || `create failed (${res.status})`);
  return body.user;
}

export async function updateUser(
  id: number,
  patch: { displayName?: string; email?: string | null; role?: UserRole },
): Promise<AuthUser> {
  const res = await fetch(`/api/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = (await res.json().catch(() => ({}))) as ApiError & { user?: AuthUser };
  if (!res.ok || !body.user) throw new Error(body.error || `update failed (${res.status})`);
  return body.user;
}

export async function deleteUser(id: number): Promise<void> {
  const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await readError(res, `delete failed (${res.status})`));
}

export async function resetUserPassword(id: number, password: string): Promise<void> {
  const res = await fetch(`/api/users/${id}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await readError(res, `reset failed (${res.status})`));
}

export async function revokeUserSessions(id: number): Promise<void> {
  const res = await fetch(`/api/users/${id}/revoke-sessions`, { method: 'POST' });
  if (!res.ok) throw new Error(await readError(res, `revoke failed (${res.status})`));
}
