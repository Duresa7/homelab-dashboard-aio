// SIEM event shapes shared by the store, the ingest path, and the SSE bus.
// Kept separate from db.ts so the storage contracts can reference them without
// importing the adapter implementation.

/** Input accepted by insertEvent() (camelCase, pre-DB shape). */
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

/** A row as stored in syslog_events (snake_case). */
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

/** What insertEvent() returns: the stored row plus its new id. */
export type StoredEvent = SyslogRow;

/** Normalized (camelCase) event shape returned to API/SSE consumers. */
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
