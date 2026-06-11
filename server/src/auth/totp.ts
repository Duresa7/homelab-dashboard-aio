import { randomBytes, randomInt } from 'node:crypto';

import { generateSecret, generateURI, verify } from 'otplib';

import { hashPassword, verifyPassword } from './passwords.js';

export const TOTP_ISSUER = 'Homelab Dashboard';
export const RECOVERY_CODE_COUNT = 10;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpKeyUri(username: string, secret: string): string {
  return generateURI({ issuer: TOTP_ISSUER, label: username, secret });
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  const token = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token)) return false;
  try {
    const result = await verify({ secret, token, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

const RECOVERY_CHARSET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function oneRecoveryCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < 12; i++) {
    chars.push(RECOVERY_CHARSET[randomInt(RECOVERY_CHARSET.length)]);
    if (i === 3 || i === 7) chars.push('-');
  }
  return chars.join('');
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export interface RecoveryCodeSet {
  codes: string[];

  hashes: string[];
}

export async function generateRecoveryCodes(): Promise<RecoveryCodeSet> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, oneRecoveryCode);
  const hashes = await Promise.all(codes.map((c) => hashPassword(normalizeRecoveryCode(c))));
  return { codes, hashes };
}

export async function consumeRecoveryCode(
  storedHashes: string[],
  submitted: string,
): Promise<string[] | null> {
  const normalized = normalizeRecoveryCode(submitted);
  if (normalized.length !== 12) return null;
  for (let i = 0; i < storedHashes.length; i++) {
    if (await verifyPassword(storedHashes[i], normalized)) {
      return [...storedHashes.slice(0, i), ...storedHashes.slice(i + 1)];
    }
  }
  return null;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}
