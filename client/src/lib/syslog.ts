import type {
  Severity,
  SyslogCategory,
  SyslogDeviceKind,
  SyslogEvent,
  SyslogSeverity,
} from '../types';

const SEVERITY_NAMES: Record<SyslogSeverity, string> = {
  0: 'emerg',
  1: 'alert',
  2: 'crit',
  3: 'err',
  4: 'warn',
  5: 'notice',
  6: 'info',
  7: 'debug',
};

export function severityName(sev: SyslogSeverity): string {
  return SEVERITY_NAMES[sev] ?? `lvl${sev}`;
}

export function severityToUi(sev: SyslogSeverity): Severity {
  if (sev <= 3) return 'bad';
  if (sev === 4) return 'warn';
  return 'info';
}

const DEVICE_LABELS: Record<SyslogDeviceKind, string> = {
  gateway: 'Gateway',
  ap: 'Access Point',
  switch: 'Switch',
  controller: 'Controller',
  unknown: 'Unknown',
};

export function deviceKindLabel(kind: SyslogDeviceKind): string {
  return DEVICE_LABELS[kind] ?? kind;
}

const CATEGORY_LABELS: Record<SyslogCategory, string> = {
  firewall: 'Firewall',
  client: 'Clients',
  ids: 'IDS / IPS',
  vpn: 'VPN',
  admin: 'Admin',
  update: 'Updates',
  system: 'System',
  monitoring: 'Monitoring',
  security: 'Security',
  threat: 'Threats',
};

export function categoryLabel(cat: SyslogCategory): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

export function componentLabel(evt: SyslogEvent): string {
  const cefName = evt.extra?.name;
  if (cefName) return String(cefName);
  if (evt.tag) return evt.tag;
  if (evt.hostname) return evt.hostname;
  return evt.deviceKind;
}

export function summary(evt: SyslogEvent): string {
  const e = evt.extra || {};
  const ctx: string[] = [];
  if (e.UNIFIclientName) ctx.push(`client=${e.UNIFIclientName}`);
  else if (e.UNIFIclientMac) ctx.push(`mac=${e.UNIFIclientMac}`);
  if (e.UNIFIwifiName) ctx.push(`ssid=${e.UNIFIwifiName}`);
  if (e.UNIFIlastConnectedToDeviceName) ctx.push(`ap=${e.UNIFIlastConnectedToDeviceName}`);
  if (e.src) ctx.push(`src=${e.src}`);
  if (e.dst) ctx.push(`dst=${e.dst}`);
  if (ctx.length === 0) return evt.message;
  return `${evt.message} · ${ctx.join(' ')}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
