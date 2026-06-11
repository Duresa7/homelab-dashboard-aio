export interface CefData {
  cefVersion: number;
  vendor: string;
  product: string;
  productVersion: string;
  signatureId: string;
  name: string;
  cefSeverity: number;
  fields: Record<string, string>;
}

export interface ParsedSyslog {
  format: string;
  facility: number | null;
  severity: number;
  logTime: number | null;
  hostname: string | null;
  tag: string | null;
  pid: number | null;
  message: string;
  cef?: CefData;
}

const MONTHS: Record<string, number> = {
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

const RFC3164_RE =
  /^(?:<(\d+)>)?(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\S+)\s+([^:\[\s]+)(?:\[(\d+)\])?:\s*(.*)$/s;

const RFC3164_SHORT_RE = /^<(\d+)>\s*([^:\[\s]+?)(?:\[(\d+)\])?:\s*(.*)$/s;

function decodePriority(pri: string): { facility: number | null; severity: number } {
  const n = Number(pri);
  if (!Number.isFinite(n)) return { facility: null, severity: 6 };
  return { facility: n >>> 3, severity: n & 7 };
}

function parseBsdTimestamp(
  month: string,
  day: string,
  hh: string,
  mm: string,
  ss: string,
): number | null {
  const monthIdx = MONTHS[month];
  if (monthIdx == null) return null;

  const now = new Date();
  let year = now.getFullYear();

  let candidate = new Date(year, monthIdx, +day, +hh, +mm, +ss);
  if (candidate.getTime() - now.getTime() > 30 * 86400_000) {
    year -= 1;
    candidate = new Date(year, monthIdx, +day, +hh, +mm, +ss);
  }

  const offsetOverride = process.env.SIEM_SYSLOG_TZ_OFFSET_MINUTES;
  if (offsetOverride != null && offsetOverride !== '') {
    const offMin = Number(offsetOverride);
    if (Number.isFinite(offMin)) {
      const utcInstant = Date.UTC(year, monthIdx, +day, +hh, +mm, +ss);
      return utcInstant - offMin * 60_000;
    }
  }
  return candidate.getTime();
}

export function parseRfc3164(raw: string): ParsedSyslog | null {
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

const CEF_HEADER_RE =
  /^CEF:(\d+)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|((?:[^|\\]|\\.)*)\|(.*)$/s;

function unescapeCefHeader(s: string): string {
  return s.replace(/\\([|\\])/g, '$1');
}

function unescapeCefValue(s: string): string {
  return s.replace(/\\([=\\rn])/g, (_, c) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    return c;
  });
}

const CEF_EXT_MAX_LEN = 16 * 1024;

const CEF_KEY_RE = /(^|\s)([A-Za-z][A-Za-z0-9_]*)=/g;

function parseCefExtension(ext: string): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!ext) return fields;
  const src = ext.length > CEF_EXT_MAX_LEN ? ext.slice(0, CEF_EXT_MAX_LEN) : ext;

  const boundaries: { key: string; valueStart: number }[] = [];
  CEF_KEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CEF_KEY_RE.exec(src)) !== null) {
    boundaries.push({ key: m[2], valueStart: m.index + m[0].length });
    if (boundaries.length > 1024) break;
  }
  for (let i = 0; i < boundaries.length; i++) {
    const cur = boundaries[i];
    const next = boundaries[i + 1];

    let end = next ? next.valueStart - next.key.length - 1 : src.length;
    while (end > cur.valueStart && /\s/.test(src[end - 1])) end -= 1;
    fields[cur.key] = unescapeCefValue(src.slice(cur.valueStart, end)).trim();
  }
  return fields;
}

export function parseCef(text: string): CefData | null {
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

function cefToSyslogSeverity(cefSev: number): number {
  if (!Number.isFinite(cefSev)) return 6;
  if (cefSev >= 9) return 1;
  if (cefSev >= 7) return 3;
  if (cefSev >= 5) return 4;
  if (cefSev >= 3) return 5;
  return 6;
}

export function parseSyslog(raw: string): ParsedSyslog | null {
  const trimmed = String(raw || '')
    .replace(/\0+$/, '')
    .trim();
  if (!trimmed) return null;

  const base = parseRfc3164(trimmed);

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
