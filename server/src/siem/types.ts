export interface InsertEventInput {
  receivedAt: number;
  logTime?: number | null;
  sourceIp: string;
  hostname?: string | null;
  facility?: number | null;
  severity: number;
  tag?: string | null;
  message: string;
  raw: string;
  format: string;
  deviceKind: string;
  category: string;
  extra?: unknown;
}

export interface SyslogRow {
  id: number;
  received_at: number;
  log_time: number | null;
  source_ip: string;
  hostname: string | null;
  facility: number | null;
  severity: number;
  tag: string | null;
  message: string;
  raw: string;
  format: string;
  device_kind: string;
  category: string;
  extra: string | null;
}

export type StoredEvent = SyslogRow;

export interface SyslogEvent {
  id: number;
  receivedAt: number;
  logTime: number | null;
  sourceIp: string;
  hostname: string | null;
  facility: number | null;
  severity: number;
  tag: string | null;
  message: string;
  raw: string;
  format: string;
  deviceKind: string;
  category: string;
  extra: unknown;
}

export interface QueryEventsOpts {
  since?: number | string | null;
  until?: number | string | null;
  severity?: unknown;
  deviceKind?: unknown;
  category?: unknown;
  sourceIp?: unknown;
  q?: unknown;
  afterId?: number | string | null;
  limit?: number | string;
  order?: string;
}
