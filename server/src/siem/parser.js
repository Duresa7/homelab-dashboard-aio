// UniFi gear emits RFC 3164 from gateway/AP/switch and CEF (9.3+) for admin,
// IDS, VPN, and client events. parseSyslog() tries 3164 first, then layers
// CEF if the body starts with "CEF:".
const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

// Optional <PRI>, BSD timestamp, hostname, tag[pid]: message — PRI may be missing.
const RFC3164_RE =
  /^(?:<(\d+)>)?(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\S+)\s+([^:\[\s]+)(?:\[(\d+)\])?:\s*(.*)$/s;

// Fallback shape: <PRI>tag: msg with no timestamp/hostname.
const RFC3164_SHORT_RE = /^<(\d+)>\s*([^:\[\s]+?)(?:\[(\d+)\])?:\s*(.*)$/s;

function decodePriority(pri) {
  const n = Number(pri);
  if (!Number.isFinite(n)) return { facility: null, severity: 6 };
  return { facility: n >>> 3, severity: n & 7 };
}

function parseBsdTimestamp(month, day, hh, mm, ss) {
  const monthIdx = MONTHS[month];
  if (monthIdx == null) return null;
  // BSD timestamps lack a year. Assume current year; if that pushes >30d into
  // the future the message is from last year (year rollover / clock skew).
  const now = new Date();
  let year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, monthIdx, +day, +hh, +mm, +ss));
  if (candidate.getTime() - now.getTime() > 30 * 86400_000) {
    year -= 1;
  }
  return Date.UTC(year, monthIdx, +day, +hh, +mm, +ss);
}

export function parseRfc3164(raw) {
  const m = raw.match(RFC3164_RE);
  if (m) {
    const [, pri, mon, day, hh, mm, ss, hostname, tag, pid, message] = m;
    const { facility, severity } = decodePriority(pri ?? '13');
    return {
      format: 'rfc3164',
      facility,
      severity,
      logTime: parseBsdTimestamp(mon, day, hh, mm, ss),
      hostname,
      tag,
      pid: pid ? Number(pid) : null,
      message,
    };
  }
  const s = raw.match(RFC3164_SHORT_RE);
  if (s) {
    const [, pri, tag, pid, message] = s;
    const { facility, severity } = decodePriority(pri);
    return {
      format: 'rfc3164',
      facility,
      severity,
      logTime: null,
      hostname: null,
      tag,
      pid: pid ? Number(pid) : null,
      message,
    };
  }
  return null;
}

// CEF:Ver|Vendor|Product|ProductVer|SigID|Name|Severity|Extension. Pipes
// escaped as \|; extension is space-separated key=value where values may
// contain spaces — split on `key=` lookahead, not whitespace.
const CEF_HEADER_RE = /^CEF:(\d+)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|(.*)$/s;

function unescapeCefHeader(s) {
  return s.replace(/\\([|\\])/g, '$1');
}

function unescapeCefValue(s) {
  return s.replace(/\\([=\\rn])/g, (_, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    return c;
  });
}

function parseCefExtension(ext) {
  const fields = {};
  if (!ext) return fields;
  const re = /([A-Za-z][A-Za-z0-9_]*)=((?:[^\\=]|\\.)*?)(?=\s+[A-Za-z][A-Za-z0-9_]*=|$)/g;
  for (const m of ext.matchAll(re)) {
    fields[m[1]] = unescapeCefValue(m[2]).trim();
  }
  return fields;
}

export function parseCef(text) {
  const m = text.match(CEF_HEADER_RE);
  if (!m) return null;
  return {
    cefVersion: Number(m[1]),
    vendor: unescapeCefHeader(m[2]),
    product: unescapeCefHeader(m[3]),
    productVersion: unescapeCefHeader(m[4]),
    signatureId: unescapeCefHeader(m[5]),
    name: unescapeCefHeader(m[6]),
    cefSeverity: Number(m[7]),
    fields: parseCefExtension(m[8]),
  };
}

// CEF severity (0–10, high=bad) → syslog severity (0–7, low=bad).
function cefToSyslogSeverity(cefSev) {
  if (!Number.isFinite(cefSev)) return 6;
  if (cefSev >= 9) return 1;
  if (cefSev >= 7) return 3;
  if (cefSev >= 5) return 4;
  if (cefSev >= 3) return 5;
  return 6;
}

export function parseSyslog(raw) {
  const trimmed = String(raw || '').replace(/\0+$/, '').trim();
  if (!trimmed) return null;

  const base = parseRfc3164(trimmed);
  // Some UniFi senders put bare CEF in the packet without the 3164 envelope.
  const cefSource = base ? base.message : trimmed;
  const cef = cefSource.startsWith('CEF:') ? parseCef(cefSource) : null;

  if (base && cef) {
    return {
      ...base,
      format: 'cef',
      severity: cefToSyslogSeverity(cef.cefSeverity),
      cef,
    };
  }
  if (cef) {
    return {
      format: 'cef',
      facility: null,
      severity: cefToSyslogSeverity(cef.cefSeverity),
      logTime: null,
      hostname: cef.fields.UNIFIhost || cef.fields.dvchost || null,
      tag: cef.product || null,
      pid: null,
      message: cef.name || cefSource,
      cef,
    };
  }
  if (base) return base;

  // Keep the raw line so we never silently drop traffic.
  return {
    format: 'rfc3164',
    facility: null,
    severity: 6,
    logTime: null,
    hostname: null,
    tag: null,
    pid: null,
    message: trimmed,
  };
}

export const SEVERITY_NAMES = [
  'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug',
];
export const FACILITY_NAMES = [
  'kern', 'user', 'mail', 'daemon', 'auth', 'syslog', 'lpr', 'news',
  'uucp', 'cron', 'authpriv', 'ftp', 'ntp', 'audit', 'alert', 'clock',
  'local0', 'local1', 'local2', 'local3', 'local4', 'local5', 'local6', 'local7',
];
