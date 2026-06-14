import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  getSecretKey,
  isEncryptedValue,
  resetSecretKeyCache,
} from './secrets.js';

const HEX_KEY = 'a'.repeat(64);

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a value', () => {
    const key = Buffer.from(HEX_KEY, 'hex');
    const enc = encryptSecret('super-secret-api-key', key);
    expect(isEncryptedValue(enc)).toBe(true);
    expect(JSON.stringify(enc)).not.toContain('super-secret-api-key');
    expect(decryptSecret(enc, key)).toBe('super-secret-api-key');
  });

  it('fails closed on a tampered ciphertext', () => {
    const key = Buffer.from(HEX_KEY, 'hex');
    const enc = encryptSecret('value', key);
    const tampered = { ...enc, ct: Buffer.from('different bytes').toString('base64') };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it('fails with the wrong key', () => {
    const enc = encryptSecret('value', Buffer.from(HEX_KEY, 'hex'));
    expect(() => decryptSecret(enc, Buffer.from('b'.repeat(64), 'hex'))).toThrow();
  });
});

describe('isEncryptedValue', () => {
  it('rejects plain strings and partial shapes', () => {
    expect(isEncryptedValue('plain')).toBe(false);
    expect(isEncryptedValue(null)).toBe(false);
    expect(isEncryptedValue({ v: 1, iv: 'x' })).toBe(false);
  });
});

describe('getSecretKey', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'homelab-key-test-'));
    resetSecretKeyCache();
  });
  afterEach(async () => {
    resetSecretKeyCache();
    await rm(dir, { recursive: true, force: true });
  });

  it('uses a 64-hex APP_ENCRYPTION_KEY directly', async () => {
    const key = await getSecretKey({
      env: { APP_ENCRYPTION_KEY: HEX_KEY },
      keyPath: path.join(dir, 'k'),
    });
    expect(key.equals(Buffer.from(HEX_KEY, 'hex'))).toBe(true);
  });

  it('derives a stable key from a passphrase', async () => {
    const a = await getSecretKey({
      env: { APP_ENCRYPTION_KEY: 'a passphrase' },
      keyPath: path.join(dir, 'k'),
    });
    resetSecretKeyCache();
    const b = await getSecretKey({
      env: { APP_ENCRYPTION_KEY: 'a passphrase' },
      keyPath: path.join(dir, 'k'),
    });
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
  });

  it('generates and persists an owner-only key file when no env key is set', async () => {
    const keyPath = path.join(dir, 'secret.key');
    const first = await getSecretKey({ env: {}, keyPath });
    expect(first.length).toBe(32);
    resetSecretKeyCache();
    const second = await getSecretKey({ env: {}, keyPath });
    expect(first.equals(second)).toBe(true);

    if (process.platform !== 'win32') {
      const mode = (await stat(keyPath)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });
});
