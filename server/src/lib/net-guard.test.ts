import { describe, expect, it } from 'vitest';

import { assertAllowedHost, BlockedHostError, hostFromInput, isBlockedIp } from './net-guard.js';

describe('isBlockedIp', () => {
  it('blocks link-local, metadata, and unspecified', () => {
    for (const ip of ['169.254.0.1', '169.254.169.254', '0.0.0.0']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    expect(isBlockedIp('::')).toBe(true);
    expect(isBlockedIp('fe80::1')).toBe(true);
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true);
  });

  it('allows loopback, private LAN, and public addresses', () => {
    for (const ip of ['127.0.0.1', '192.168.1.10', '10.0.0.5', '172.16.0.1', '8.8.8.8']) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
    expect(isBlockedIp('::1')).toBe(false);
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
  });

  it('returns false for non-IP strings (hostname handling lives elsewhere)', () => {
    expect(isBlockedIp('example.com')).toBe(false);
    expect(isBlockedIp('not-an-ip')).toBe(false);
  });
});

describe('hostFromInput', () => {
  it('extracts the host from URLs and bare host[:port] strings', () => {
    expect(hostFromInput('https://192.168.1.1:8443/proxy')).toBe('192.168.1.1');
    expect(hostFromInput('proxmox.lan:8006')).toBe('proxmox.lan');
    expect(hostFromInput('http://[::1]:9000')).toBe('::1');
    expect(hostFromInput('169.254.169.254')).toBe('169.254.169.254');
  });
});

describe('assertAllowedHost', () => {
  it('rejects link-local/metadata/unspecified literals', async () => {
    await expect(
      assertAllowedHost('http://169.254.169.254/latest/meta-data'),
    ).rejects.toBeInstanceOf(BlockedHostError);
    await expect(assertAllowedHost('http://169.254.0.5:80')).rejects.toBeInstanceOf(
      BlockedHostError,
    );
    await expect(assertAllowedHost('http://0.0.0.0:8006')).rejects.toBeInstanceOf(BlockedHostError);
    await expect(assertAllowedHost('http://[fe80::1]:8006')).rejects.toBeInstanceOf(
      BlockedHostError,
    );
  });

  it('allows loopback, private-LAN, and public targets', async () => {
    await expect(assertAllowedHost('http://127.0.0.1:9000')).resolves.toBeUndefined();
    await expect(assertAllowedHost('https://192.168.1.20:443')).resolves.toBeUndefined();
    await expect(assertAllowedHost('https://10.10.0.2:8006')).resolves.toBeUndefined();
  });

  it('rejects an empty host', async () => {
    await expect(assertAllowedHost('   ')).rejects.toBeInstanceOf(BlockedHostError);
  });
});
