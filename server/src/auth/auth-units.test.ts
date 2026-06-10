import { describe, expect, it } from 'vitest';

import { hashPassword, validatePassword, verifyPassword } from './passwords.js';
import { normalizeIp, parseProxyAuthConfig, proxyAssertedUser } from './proxy-auth.js';
import { createLoginRateLimiter } from './rate-limit.js';
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  totpKeyUri,
  verifyTotpCode,
} from './totp.js';

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong password here')).toBe(false);
  });

  it('treats malformed hashes as non-matching', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever12345')).toBe(false);
  });

  it('rejects short and overlong passwords', () => {
    expect(validatePassword('short').ok).toBe(false);
    expect(validatePassword('a'.repeat(129)).ok).toBe(false);
  });

  it('rejects common/guessable passwords regardless of length', () => {
    expect(validatePassword('password12345').ok).toBe(false);
    expect(validatePassword('qwertyuiop123').ok).toBe(false);
  });

  it('rejects passwords built from user identifiers', () => {
    const r = validatePassword('testuser2026', ['testuser', 'Test User']);
    expect(r.ok).toBe(false);
  });

  it('accepts strong passphrases', () => {
    expect(validatePassword('plasma otter veranda 9 quilt').ok).toBe(true);
  });
});

describe('login rate limiter', () => {
  it('allows the first failures then blocks with growing backoff', () => {
    let t = 0;
    const rl = createLoginRateLimiter({ now: () => t });
    const key = rl.key('192.0.2.10', 'Admin');

    for (let i = 0; i < 5; i++) {
      expect(rl.check(key).allowed).toBe(true);
      rl.recordFailure(key);
    }
    // 5th failure fills the window -> blocked for the base delay.
    let d = rl.check(key);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterMs).toBe(2_000);

    // Next failure doubles the delay.
    t += 2_000;
    expect(rl.check(key).allowed).toBe(true);
    rl.recordFailure(key);
    d = rl.check(key);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterMs).toBe(4_000);
  });

  it('caps backoff at the max delay', () => {
    let t = 0;
    const rl = createLoginRateLimiter({ now: () => t });
    const key = rl.key('192.0.2.1', 'admin');
    for (let i = 0; i < 12; i++) {
      rl.recordFailure(key);
      t += rl.check(key).retryAfterMs;
    }
    rl.recordFailure(key);
    const d = rl.check(key);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('clears on success and scopes by ip+username', () => {
    const t = 0;
    const rl = createLoginRateLimiter({ now: () => t });
    const a = rl.key('192.0.2.1', 'admin');
    const b = rl.key('192.0.2.2', 'admin');
    for (let i = 0; i < 5; i++) rl.recordFailure(a);
    expect(rl.check(a).allowed).toBe(false);
    expect(rl.check(b).allowed).toBe(true);
    rl.recordSuccess(a);
    expect(rl.check(a).allowed).toBe(true);
  });

  it('forgives the failure count after a quiet period', () => {
    let t = 0;
    const rl = createLoginRateLimiter({ now: () => t });
    const key = rl.key('192.0.2.1', 'admin');
    for (let i = 0; i < 4; i++) rl.recordFailure(key);
    t += 121_000;
    rl.recordFailure(key);
    expect(rl.check(key).allowed).toBe(true);
  });
});

describe('totp', () => {
  it('verifies a freshly generated code and rejects garbage', async () => {
    const secret = generateTotpSecret();
    const { generate } = await import('otplib');
    const code = await generate({ secret });
    expect(await verifyTotpCode(secret, code)).toBe(true);
    expect(await verifyTotpCode(secret, '000000')).toBe(false);
    expect(await verifyTotpCode(secret, 'abcdef')).toBe(false);
    expect(await verifyTotpCode(secret, '12345')).toBe(false);
  });

  it('builds an otpauth uri with the issuer', () => {
    const uri = totpKeyUri('admin', generateTotpSecret());
    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain(encodeURIComponent('Homelab Dashboard'));
  });

  it('generates 10 recovery codes and burns one on use', async () => {
    const { codes, hashes } = await generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes)
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);

    const remaining = await consumeRecoveryCode(hashes, codes[3].toLowerCase());
    expect(remaining).toHaveLength(9);
    // Burned code no longer works against the remaining set.
    expect(await consumeRecoveryCode(remaining!, codes[3])).toBeNull();
    // Unknown code rejected.
    expect(await consumeRecoveryCode(hashes, 'AAAA-AAAA-AAAA')).toBeNull();
  });

  it('normalizes spacing and dashes in recovery codes', () => {
    expect(normalizeRecoveryCode(' ab2d-3efg-4hjk ')).toBe('AB2D3EFG4HJK');
  });
});

describe('proxy auth', () => {
  it('is disabled by default', () => {
    const cfg = parseProxyAuthConfig({});
    expect(cfg.enabled).toBe(false);
    expect(proxyAssertedUser(cfg, '192.0.2.1', 'admin')).toBeNull();
  });

  it('asserts the user only from a trusted ip', () => {
    const cfg = parseProxyAuthConfig({
      AUTH_PROXY_ENABLED: 'true',
      AUTH_PROXY_HEADER: 'Remote-User',
      AUTH_PROXY_TRUSTED_IPS: '192.0.2.5, 198.51.100.9',
    });
    expect(cfg.header).toBe('remote-user');
    expect(proxyAssertedUser(cfg, '192.0.2.5', 'Admin ')).toBe('admin');
    expect(proxyAssertedUser(cfg, '::ffff:198.51.100.9', 'admin')).toBe('admin');
    expect(proxyAssertedUser(cfg, '192.0.2.99', 'admin')).toBeNull();
    expect(proxyAssertedUser(cfg, undefined, 'admin')).toBeNull();
    expect(proxyAssertedUser(cfg, '192.0.2.5', undefined)).toBeNull();
    expect(proxyAssertedUser(cfg, '192.0.2.5', '')).toBeNull();
  });

  it('normalizes ipv4-mapped ipv6', () => {
    expect(normalizeIp('::ffff:192.0.2.7')).toBe('192.0.2.7');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
  });
});
