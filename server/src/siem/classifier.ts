import type { ParsedSyslog } from './parser.js';

const HOSTNAME_RULES: [RegExp, string][] = [
  [/^(UDM|UCG|UDMP|UDR|UXG)/i, 'gateway'],
  [/^(USW|US-|USL|USP|USXG)/i, 'switch'],
  [/^(UAP|U7|U6|UFLHD|UAC)/i, 'ap'],
  [/^(UNVR|UNAS|UCKP|UCK|CKG2|CK)/i, 'controller'],
];

function inferDeviceKind(parsed: ParsedSyslog): string {
  const cefHost = parsed.cef?.fields?.UNIFIhost || parsed.cef?.fields?.dvchost;
  const candidates = [cefHost, parsed.hostname].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    for (const [re, kind] of HOSTNAME_RULES) {
      if (re.test(candidate)) return kind;
    }
  }
  if (parsed.format === 'cef') return 'controller';
  return 'unknown';
}

// Lowercased CEF categories UniFi emits — passed through as-is when present.
const CEF_CATEGORIES = new Set([
  'monitoring',
  'security',
  'threat',
  'admin',
  'vpn',
  'firewall',
  'client',
  'update',
  'system',
  'ids',
]);

function inferCategory(parsed: ParsedSyslog): string {
  const cefFields: Record<string, string> = parsed.cef?.fields || {};
  const cefCat = (cefFields.UNIFIcategory || cefFields.cat || '').toLowerCase();
  if (CEF_CATEGORIES.has(cefCat)) return cefCat;
  const cefSub = (cefFields.UNIFIsubCategory || '').toLowerCase();
  if (cefSub.includes('vpn')) return 'vpn';
  if (cefSub.includes('ids') || cefSub.includes('ips') || cefSub.includes('threat')) return 'ids';
  if (cefSub.includes('admin')) return 'admin';
  if (cefSub.includes('firewall')) return 'firewall';
  if (cefSub.includes('wifi') || cefSub.includes('client')) return 'client';

  const tag = (parsed.tag || '').toLowerCase();
  const msg = parsed.message || '';

  // UniFi iptables prefixes: [WAN_IN-3003-A], [LAN_LOCAL-...].
  if (/^\[?(?:WAN|LAN|GUEST|VLAN)[_\-](?:IN|OUT|LOCAL)/i.test(msg)) return 'firewall';
  if (tag === 'kernel' && /\b(?:DROP|ACCEPT|REJECT|src=|SRC=)/i.test(msg)) return 'firewall';

  if (tag === 'hostapd' || tag === 'wpa_supplicant') return 'client';
  if (/\bSTA\s+[0-9a-f:]{17}\s+IEEE 802\.11/i.test(msg)) return 'client';
  if (
    /(?:authenticated|associated|disassociated|deauthenticated)/i.test(msg) &&
    /STA|client/i.test(msg)
  ) {
    return 'client';
  }

  if (/(?:suricata|snort)/i.test(tag) || /(?:suricata|snort)/i.test(msg)) return 'ids';
  if (/\b(?:signature|threat|alert)\s+id\b/i.test(msg)) return 'ids';

  if (/(?:openvpn|wireguard|ipsec|l2tp|strongswan|charon|pluto)/i.test(tag)) return 'vpn';
  if (/(?:openvpn|wireguard|ipsec|l2tp)/i.test(msg)) return 'vpn';

  if (/^(?:sshd|sudo|su|login)$/i.test(tag)) return 'admin';
  if (/\bAccepted (?:password|publickey) for\b/i.test(msg)) return 'admin';
  if (/\bFailed password for\b/i.test(msg)) return 'admin';

  if (
    /(?:firmware|upgrade|update)\b/i.test(msg) &&
    /\b(ready|available|installed|started)\b/i.test(msg)
  ) {
    return 'update';
  }

  return 'system';
}

export function classifySyslog(parsed: ParsedSyslog, sourceIp: string) {
  const device_kind = inferDeviceKind(parsed);
  const category = inferCategory(parsed);
  return { device_kind, category, source_ip: sourceIp };
}
