// UniFi gear emits RFC 3164 from gateway/AP/switch and CEF (9.3+) for admin,
// IDS, VPN, and client events. parseSyslog() tries 3164 first, then layers
// CEF if the body starts with "CEF:".
const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
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
  // BSD timestamps (RFC 3164) lack both year AND timezone. The protocol
  // specifies the SENDER'S local wall clock, so we interpret the fields in
  // the server's local timezone (assumed to match the sender; configurable
  // via SIEM_SYSLOG_TZ_OFFSET_MINUTES for cross-zone deployments). Using
  // `new Date(year, monthIdx, day, hh, mm, ss)` (no UTC) does exactly that.
  const now = new Date();
  let year = now.getFullYear();
  // If the resulting date is >30d in the future, it's from last year
  // (year rollover / clock skew tolerance).
  let candidate = new Date(year, monthIdx, +day, +hh, +mm, +ss);
  if (candidate.getTime() - now.getTime() > 30 * 86400_000) {
    year -= 1;
    candidate = new Date(year, monthIdx, +day, +hh, +mm, +ss);
  }
  // Allow an explicit offset override for senders in a different zone.
  const offsetOverride = process.env.SIEM_SYSLOG_TZ_OFFSET_MINUTES;
  if (offsetOverride != null && offsetOverride !== '') {
    const offMin = Number(offsetOverride);
    if (Number.isFinite(offMin)) {
      // Treat the wall-clock as UTC+offMin: subtract the override and add
      // back the server-local offset to land on the correct instant.
      const utcInstant = Date.UTC(year, monthIdx, +day, +hh, +mm, +ss);
      return utcInstant - offMin * 60_000;
    }
  }
  return candidate.getTime();
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
const CEF_HEADER_RE =
  /^CEF:(\d+)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|(.*)$/s;

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

// Linear-time CEF extension parser. The previous implementation used a
// lazy regex with a forward lookahead, which is O(n·k) in (input length ×
// pair count) and stalled the event loop on adversarial inputs. This
// version finds every `key=` boundary in one scan, then carves out the
// value text between adjacent boundaries — O(n) total. We also bound the
// input length so a single oversize packet can't dominate parsing.
const CEF_EXT_MAX_LEN = 16 * 1024;
// Anchor only at start-of-string or after literal whitespace; an `=` inside
// an escaped value (\=) does not begin a new key.
const CEF_KEY_RE = /(^|\s)([A-Za-z][A-Za-z0-9_]*)=/g;

function parseCefExtension(ext) {
  const fields = {};
  if (!ext) return fields;
  const src = ext.length > CEF_EXT_MAX_LEN ? ext.slice(0, CEF_EXT_MAX_LEN) : ext;
  // Single pass to locate every key boundary.
  const boundaries = [];
  CEF_KEY_RE.lastIndex = 0;
  let m;
  while ((m = CEF_KEY_RE.exec(src)) !== null) {
    boundaries.push({ key: m[2], valueStart: m.index + m[0].length });
    if (boundaries.length > 1024) break; // sanity cap
  }
  for (let i = 0; i < boundaries.length; i++) {
    const cur = boundaries[i];
    const next = boundaries[i + 1];
    // The value runs until just before the whitespace preceding the next key,
    // or end-of-string. Walk back to strip the trailing whitespace consumed
    // by the next match's `(^|\s)` group.
    let end = next ? next.valueStart - next.key.length - 1 : src.length;
    while (end > cur.valueStart && /\s/.test(src[end - 1])) end -= 1;
    fields[cur.key] = unescapeCefValue(src.slice(cur.valueStart, end)).trim();
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
  const trimmed = String(raw || '')
    .replace(/\0+$/, '')
    .trim();
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
  'emerg',
  'alert',
  'crit',
  'err',
  'warning',
  'notice',
  'info',
  'debug',
];
export const FACILITY_NAMES = [
  'kern',
  'user',
  'mail',
  'daemon',
  'auth',
  'syslog',
  'lpr',
  'news',
  'uucp',
  'cron',
  'authpriv',
  'ftp',
  'ntp',
  'audit',
  'alert',
  'clock',
  'local0',
  'local1',
  'local2',
  'local3',
  'local4',
  'local5',
  'local6',
  'local7',
];
