import { createHash } from 'node:crypto';

/**
 * HTTP Digest Authentication (RFC 7616 / RFC 2617), MD5 only.
 *
 * Intel AMT requires digest auth on the WSMAN endpoint even over TLS, and only
 * speaks the MD5 algorithm (not SHA-256). This module parses the server
 * challenge, computes the response hash, and builds the Authorization header.
 */

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop: string;
  opaque?: string;
}

export interface DigestParams {
  username: string;
  password: string;
  realm: string;
  nonce: string;
  /** Nonce count, 8 hex digits, e.g. "00000001". */
  nc: string;
  /** Client nonce. */
  cnonce: string;
  qop: string;
  /** HTTP method, e.g. "POST". */
  method: string;
  /** Request URI / path, e.g. "/wsman". */
  uri: string;
  opaque?: string;
}

function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

/** Pull a quoted or bare directive value out of a WWW-Authenticate header. */
function directive(header: string, key: string): string | undefined {
  const re = new RegExp(`${key}\\s*=\\s*(?:"([^"]*)"|([^,\\s]+))`, 'i');
  const m = header.match(re);
  if (!m) return undefined;
  return m[1] ?? m[2];
}

/**
 * Parse a `WWW-Authenticate: Digest ...` challenge header into its directives.
 * Throws if the header is missing the mandatory realm/nonce.
 */
export function parseWwwAuthenticate(header: string): DigestChallenge {
  if (!header) throw new Error('Missing WWW-Authenticate header');
  if (!/^\s*Digest\b/i.test(header)) {
    throw new Error('WWW-Authenticate header is not a Digest challenge');
  }

  const realm = directive(header, 'realm');
  const nonce = directive(header, 'nonce');
  if (realm == null || nonce == null) {
    throw new Error('Digest challenge missing realm or nonce');
  }

  // qop may be a comma-separated list (e.g. "auth,auth-int"); prefer plain "auth".
  const qopRaw = directive(header, 'qop') ?? 'auth';
  const qop = qopRaw
    .split(',')
    .map((q) => q.trim())
    .includes('auth')
    ? 'auth'
    : qopRaw.split(',')[0].trim();

  const opaque = directive(header, 'opaque');
  return opaque == null ? { realm, nonce, qop } : { realm, nonce, qop, opaque };
}

/**
 * Compute the Digest `response` value for qop=auth:
 *   HA1 = MD5(username:realm:password)
 *   HA2 = MD5(method:uri)
 *   response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
 */
export function computeDigestResponse(params: DigestParams): string {
  const { username, password, realm, nonce, nc, cnonce, qop, method, uri } = params;
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  return md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
}

/**
 * Build the full `Authorization: Digest ...` header value. The password is used
 * only to compute the response hash and never appears in the output.
 */
export function buildAuthorizationHeader(params: DigestParams): string {
  const response = computeDigestResponse(params);
  const parts = [
    `username="${params.username}"`,
    `realm="${params.realm}"`,
    `nonce="${params.nonce}"`,
    `uri="${params.uri}"`,
    `qop=${params.qop}`,
    `nc=${params.nc}`,
    `cnonce="${params.cnonce}"`,
    `response="${response}"`,
    'algorithm=MD5',
  ];
  if (params.opaque != null) parts.push(`opaque="${params.opaque}"`);
  return `Digest ${parts.join(', ')}`;
}
