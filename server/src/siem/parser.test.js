import { describe, expect, it } from 'vitest';

import { classifySyslog } from './classifier.js';
import { parseCef, parseRfc3164, parseSyslog } from './parser.js';

describe('SIEM parser', () => {
  it('parses RFC 3164 syslog envelopes', () => {
    const parsed = parseRfc3164(
      '<134>Jun  1 12:34:56 UCG-Fiber kernel: [WAN_IN-3003-A] DROP SRC=1.2.3.4',
    );

    expect(parsed).toMatchObject({
      format: 'rfc3164',
      facility: 16,
      severity: 6,
      hostname: 'UCG-Fiber',
      tag: 'kernel',
      message: '[WAN_IN-3003-A] DROP SRC=1.2.3.4',
    });
    expect(parsed.logTime).toEqual(expect.any(Number));
  });

  it('parses CEF headers and escaped extension values', () => {
    const parsed = parseCef(
      String.raw`CEF:0|Ubiquiti|UniFi|9.3|admin-login|Admin\|Login|8|UNIFIhost=UCG-Fiber msg=Admin login duser=alice\=ops`,
    );

    expect(parsed).toMatchObject({
      cefVersion: 0,
      vendor: 'Ubiquiti',
      product: 'UniFi',
      signatureId: 'admin-login',
      name: 'Admin|Login',
      cefSeverity: 8,
    });
    expect(parsed.fields).toMatchObject({
      UNIFIhost: 'UCG-Fiber',
      msg: 'Admin login',
      duser: 'alice=ops',
    });
  });

  it('layers CEF over an RFC 3164 envelope and maps severity', () => {
    const parsed = parseSyslog(
      String.raw`<13>Jun  1 12:34:56 UNVR app: CEF:0|Ubiquiti|UniFi|9.3|ids|Threat detected|9|UNIFIhost=UCG-Fiber UNIFIcategory=threat`,
    );

    expect(parsed).toMatchObject({
      format: 'cef',
      severity: 1,
      hostname: 'UNVR',
      tag: 'app',
    });
    expect(parsed.cef.fields.UNIFIcategory).toBe('threat');
  });

  it('keeps unparseable lines instead of dropping them', () => {
    expect(parseSyslog('plain text event')).toMatchObject({
      format: 'rfc3164',
      severity: 6,
      message: 'plain text event',
    });
  });
});

describe('SIEM classifier', () => {
  it('classifies UniFi gateway firewall messages', () => {
    const parsed = parseSyslog(
      '<134>Jun  1 12:34:56 UCG-Fiber kernel: [WAN_IN-3003-A] DROP SRC=1.2.3.4',
    );
    expect(classifySyslog(parsed, '198.51.100.10')).toEqual({
      device_kind: 'gateway',
      category: 'firewall',
      source_ip: '198.51.100.10',
    });
  });

  it('classifies CEF controller events by emitted category', () => {
    const parsed = parseSyslog(
      String.raw`CEF:0|Ubiquiti|UniFi|9.3|vpn|VPN user connected|5|dvchost=UNVR UNIFIcategory=vpn`,
    );
    expect(classifySyslog(parsed, '198.51.100.10')).toEqual({
      device_kind: 'controller',
      category: 'vpn',
      source_ip: '198.51.100.10',
    });
  });
});
