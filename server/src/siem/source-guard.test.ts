import { describe, expect, it, vi } from 'vitest';

import {
  isLoopbackHost,
  isSourceAllowed,
  parseAllowedSources,
  resolveBindHost,
} from './source-guard.js';

describe('SIEM source guard', () => {
  describe('parseAllowedSources', () => {
    it('returns null when nothing is configured', () => {
      expect(parseAllowedSources(undefined)).toBeNull();
      expect(parseAllowedSources('')).toBeNull();
      expect(parseAllowedSources(' , ,')).toBeNull();
    });

    it('parses a comma-separated list of IPs and CIDRs', () => {
      const filter = parseAllowedSources('192.0.2.1, 192.0.2.5 ,198.51.100.0/24');
      expect(filter).not.toBeNull();
      expect(filter!.ips).toEqual(new Set(['192.0.2.1', '192.0.2.5']));
      expect(filter!.cidrs).toHaveLength(1);
      expect(filter!.allowAny).toBe(false);
    });

    it('treats "*" as an explicit allow-any opt-out', () => {
      expect(parseAllowedSources('*')!.allowAny).toBe(true);
    });

    it('skips invalid entries and reports them', () => {
      const onInvalid = vi.fn();
      const filter = parseAllowedSources(
        '192.0.2.1,unifi.local,300.1.2.3,192.0.2.0/33,192.0.2.0/2/4',
        onInvalid,
      );
      expect(filter!.ips).toEqual(new Set(['192.0.2.1']));
      expect(filter!.cidrs).toHaveLength(0);
      expect(onInvalid.mock.calls.map((c) => c[0])).toEqual([
        'unifi.local',
        '300.1.2.3',
        '192.0.2.0/33',
        '192.0.2.0/2/4',
      ]);
    });

    it('returns null when every entry is invalid', () => {
      expect(parseAllowedSources('not-an-ip, also bad')).toBeNull();
    });
  });

  describe('isSourceAllowed', () => {
    it('allows everything when no filter is configured (loopback-only bind)', () => {
      expect(isSourceAllowed(null, '127.0.0.1')).toBe(true);
    });

    it('matches exact IPs', () => {
      const filter = parseAllowedSources('192.0.2.1');
      expect(isSourceAllowed(filter, '192.0.2.1')).toBe(true);
      expect(isSourceAllowed(filter, '192.0.2.2')).toBe(false);
    });

    it('matches CIDR ranges', () => {
      const filter = parseAllowedSources('198.51.100.0/24');
      expect(isSourceAllowed(filter, '198.51.100.7')).toBe(true);
      expect(isSourceAllowed(filter, '198.51.100.255')).toBe(true);
      expect(isSourceAllowed(filter, '198.51.101.1')).toBe(false);
    });

    it('normalizes IPv4-mapped IPv6 sources', () => {
      const filter = parseAllowedSources('192.0.2.1');
      expect(isSourceAllowed(filter, '::ffff:192.0.2.1')).toBe(true);
      expect(isSourceAllowed(filter, '::FFFF:192.0.2.9')).toBe(false);
    });

    it('allows any source with "*"', () => {
      const filter = parseAllowedSources('*');
      expect(isSourceAllowed(filter, '203.0.113.99')).toBe(true);
    });

    it('a /0 range allows any IPv4 source', () => {
      const filter = parseAllowedSources('0.0.0.0/0');
      expect(isSourceAllowed(filter, '203.0.113.99')).toBe(true);
    });
  });

  describe('isLoopbackHost', () => {
    it('recognizes loopback addresses', () => {
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('127.1.2.3')).toBe(true);
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
    });

    it('rejects non-loopback addresses', () => {
      expect(isLoopbackHost('0.0.0.0')).toBe(false);
      expect(isLoopbackHost('192.0.2.1')).toBe(false);
      expect(isLoopbackHost('1270.0.0.1')).toBe(false);
    });
  });

  describe('resolveBindHost (default-deny, HD-CAN-004)', () => {
    it('falls back to loopback when binding wide without an allowlist', () => {
      expect(resolveBindHost('0.0.0.0', null)).toEqual({
        host: '127.0.0.1',
        loopbackFallback: true,
      });
      expect(resolveBindHost('192.0.2.10', null)).toEqual({
        host: '127.0.0.1',
        loopbackFallback: true,
      });
    });

    it('keeps a loopback bind as requested without an allowlist', () => {
      expect(resolveBindHost('127.0.0.1', null)).toEqual({
        host: '127.0.0.1',
        loopbackFallback: false,
      });
    });

    it('honors the configured host once an allowlist is set', () => {
      const filter = parseAllowedSources('192.0.2.1');
      expect(resolveBindHost('0.0.0.0', filter)).toEqual({
        host: '0.0.0.0',
        loopbackFallback: false,
      });
    });

    it('honors the configured host with an explicit allow-any opt-out', () => {
      const filter = parseAllowedSources('*');
      expect(resolveBindHost('0.0.0.0', filter)).toEqual({
        host: '0.0.0.0',
        loopbackFallback: false,
      });
    });
  });
});
