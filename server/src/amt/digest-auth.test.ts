import { describe, expect, it } from 'vitest';

import {
  buildAuthorizationHeader,
  computeDigestResponse,
  parseWwwAuthenticate,
} from './digest-auth.js';

describe('parseWwwAuthenticate', () => {
  it('parses realm, nonce, qop, and opaque from a Digest challenge', () => {
    const header =
      'Digest realm="Digest:AF52D00000000000000000000000000", ' +
      'nonce="qrK9YQAAAAAAAAAA1+Q0V6Xk0000000", stale="false", qop="auth", ' +
      'opaque="0123456789abcdef"';
    expect(parseWwwAuthenticate(header)).toEqual({
      realm: 'Digest:AF52D00000000000000000000000000',
      nonce: 'qrK9YQAAAAAAAAAA1+Q0V6Xk0000000',
      qop: 'auth',
      opaque: '0123456789abcdef',
    });
  });

  it('prefers "auth" when qop is a comma-separated list', () => {
    const header = 'Digest realm="r", nonce="n", qop="auth-int,auth"';
    expect(parseWwwAuthenticate(header).qop).toBe('auth');
  });

  it('defaults qop to "auth" when the directive is absent', () => {
    const header = 'Digest realm="r", nonce="n"';
    expect(parseWwwAuthenticate(header).qop).toBe('auth');
  });

  it('omits opaque when the server does not send one', () => {
    const challenge = parseWwwAuthenticate('Digest realm="r", nonce="n", qop="auth"');
    expect(challenge.opaque).toBeUndefined();
  });

  it('rejects a non-Digest or empty challenge', () => {
    expect(() => parseWwwAuthenticate('Basic realm="r"')).toThrow(/not a Digest/i);
    expect(() => parseWwwAuthenticate('')).toThrow(/Missing WWW-Authenticate/i);
    expect(() => parseWwwAuthenticate('Digest realm="r"')).toThrow(/missing realm or nonce/i);
  });
});

describe('computeDigestResponse', () => {
  // Canonical RFC 2617 §3.5 MD5 test vector.
  it('matches the RFC 2617 reference vector', () => {
    const response = computeDigestResponse({
      username: 'Mufasa',
      password: 'Circle Of Life',
      realm: 'testrealm@example.com',
      nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
      nc: '00000001',
      cnonce: '0a4f113b',
      qop: 'auth',
      method: 'GET',
      uri: '/dir/index.html',
    });
    expect(response).toBe('6629fae49393a05397450978507c4ef1');
  });

  it('changes when the nonce count changes', () => {
    const base = {
      username: 'admin',
      password: 'P@ssw0rd',
      realm: 'Digest:1234',
      nonce: 'abc',
      cnonce: 'def',
      qop: 'auth',
      method: 'POST',
      uri: '/wsman',
    };
    const r1 = computeDigestResponse({ ...base, nc: '00000001' });
    const r2 = computeDigestResponse({ ...base, nc: '00000002' });
    expect(r1).not.toBe(r2);
  });
});

describe('buildAuthorizationHeader', () => {
  const params = {
    username: 'admin',
    password: 'P@ssw0rd',
    realm: 'Digest:1234',
    nonce: 'abc',
    nc: '00000001',
    cnonce: 'def',
    qop: 'auth',
    method: 'POST',
    uri: '/wsman',
    opaque: 'op4q',
  };

  it('embeds every digest directive and the computed response', () => {
    const header = buildAuthorizationHeader(params);
    expect(header).toMatch(/^Digest /);
    expect(header).toContain('username="admin"');
    expect(header).toContain('realm="Digest:1234"');
    expect(header).toContain('nonce="abc"');
    expect(header).toContain('uri="/wsman"');
    expect(header).toContain('qop=auth');
    expect(header).toContain('nc=00000001');
    expect(header).toContain('cnonce="def"');
    expect(header).toContain('algorithm=MD5');
    expect(header).toContain('opaque="op4q"');
    expect(header).toContain(`response="${computeDigestResponse(params)}"`);
  });

  it('never leaks the password into the header', () => {
    expect(buildAuthorizationHeader(params)).not.toContain('P@ssw0rd');
  });

  it('omits opaque when not provided', () => {
    const noOpaque = { ...params, opaque: undefined };
    expect(buildAuthorizationHeader(noOpaque)).not.toContain('opaque');
  });
});
