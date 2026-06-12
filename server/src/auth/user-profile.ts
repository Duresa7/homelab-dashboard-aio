import type { UserRecord } from './types.js';

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$/;

export function publicUser(u: UserRecord) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    role: u.role,
    totpEnabled: u.totpEnabled,
    createdAt: u.createdAt,
    passwordChangedAt: u.passwordChangedAt,
  };
}

export function isValidUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_RE.test(value.toLowerCase());
}

export function isValidEmail(value: unknown): boolean {
  return (
    typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}
