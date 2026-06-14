import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const HEX_KEY = /^[0-9a-fA-F]{64}$/;
// Not secret: only domain-separates this scrypt use so the same passphrase can't
// derive a colliding key for some other purpose. A raw 64-hex APP_ENCRYPTION_KEY
// skips the KDF entirely.
const KDF_SALT = 'homelab-dashboard/secret-key/v1';
// Mirrors DATA_DIR in storage/config.ts. Kept local so this module has no import
// dependency on storage/config (which imports this one).
const DATA_DIR = 'data';
// Marks a secret serialized as a single string (e.g. a DB password in a JSON
// config file) rather than the structured EncryptedValue object.
const STRING_PREFIX = 'encv1:';

export interface EncryptedValue {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

export function isEncryptedValue(value: unknown): value is EncryptedValue {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<EncryptedValue>;
  return (
    v.v === 1 && typeof v.iv === 'string' && typeof v.tag === 'string' && typeof v.ct === 'string'
  );
}

export function encryptSecret(plaintext: string, key: Buffer): EncryptedValue {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** Throws if the auth tag fails (wrong key or tampered ciphertext). */
export function decryptSecret(value: EncryptedValue, key: Buffer): string {
  const decipher = createDecipheriv(ALGO, key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const ct = Buffer.from(value.ct, 'base64');
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** A secret encoded as one opaque string, for fields typed as plain strings
 * (e.g. a DB password persisted in JSON). */
export function isEncryptedString(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(STRING_PREFIX);
}

export function encryptSecretToString(plaintext: string, key: Buffer): string {
  const payload = JSON.stringify(encryptSecret(plaintext, key));
  return STRING_PREFIX + Buffer.from(payload, 'utf8').toString('base64');
}

export function decryptSecretFromString(value: string, key: Buffer): string {
  const payload = Buffer.from(value.slice(STRING_PREFIX.length), 'base64').toString('utf8');
  const parsed: unknown = JSON.parse(payload);
  if (!isEncryptedValue(parsed)) throw new Error('not an encrypted secret string');
  return decryptSecret(parsed, key);
}

function deriveKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (HEX_KEY.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return scryptSync(trimmed, KDF_SALT, KEY_BYTES);
}

function defaultKeyPath(): string {
  return path.resolve(DATA_DIR, 'secret.key');
}

let cachedKey: Buffer | null = null;

export interface KeyOpts {
  env?: NodeJS.ProcessEnv;
  keyPath?: string;
}

/** Resolve the key without any disk write: `APP_ENCRYPTION_KEY` (64-hex used
 * directly, else a passphrase through scrypt), else an existing `data/secret.key`.
 * Returns null when neither exists (the async {@link getSecretKey} can generate
 * one). Caches whatever it finds. */
export function getSecretKeySync(opts: KeyOpts = {}): Buffer | null {
  if (cachedKey) return cachedKey;
  const env = opts.env ?? process.env;
  const keyPath = opts.keyPath ?? defaultKeyPath();

  const fromEnv = env.APP_ENCRYPTION_KEY?.trim();
  if (fromEnv) {
    cachedKey = deriveKey(fromEnv);
    return cachedKey;
  }

  try {
    const text = readFileSync(keyPath, 'utf8').trim();
    if (HEX_KEY.test(text)) {
      cachedKey = Buffer.from(text, 'hex');
      return cachedKey;
    }
  } catch {
    // no key file yet
  }
  return null;
}

/**
 * Resolve the at-rest encryption key, caching it for the process. Falls back to
 * generating an auto key file at `data/secret.key` (0600) when no
 * `APP_ENCRYPTION_KEY` and no existing file are present. Losing the key means
 * stored secrets can't be decrypted and must be re-entered.
 */
export async function getSecretKey(opts: KeyOpts = {}): Promise<Buffer> {
  const existing = getSecretKeySync(opts);
  if (existing) return existing;

  const env = opts.env ?? process.env;
  const keyPath = opts.keyPath ?? defaultKeyPath();
  const key = randomBytes(KEY_BYTES);
  // Under test, keep an ephemeral in-memory key instead of writing one into the
  // project's data dir, so the suite has no on-disk side effects.
  if (env.NODE_ENV === 'test' && !opts.keyPath) {
    cachedKey = key;
    return cachedKey;
  }
  await mkdir(path.dirname(keyPath), { recursive: true });
  const tmp = `${keyPath}.tmp-${process.pid}`;
  await writeFile(tmp, `${key.toString('hex')}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tmp, keyPath);
  cachedKey = key;
  return cachedKey;
}

/** Test-only: drop the cached key so a different env/keyPath takes effect. */
export function resetSecretKeyCache(): void {
  cachedKey = null;
}
