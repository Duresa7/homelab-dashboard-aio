// Async storage contracts for the pluggable database backend. Both stores
// expose Promise-returning methods so a SQLite, Postgres, or MySQL adapter can
// satisfy the same interface; consumers depend only on the contracts.
import type { AuthStore } from '../auth/types.js';
import type { InsertEventInput, QueryEventsOpts, StoredEvent, SyslogEvent } from '../siem/types.js';
import type { ResolvedDbConfig } from './config.js';

/** Whole key→value app-state map plus per-key update timestamps. */
export interface StateSnapshot {
  values: Record<string, unknown>;
  updatedAt: Record<string, number>;
}

/** A single app-state entry. */
export interface StateEntry {
  value: unknown;
  updatedAt: number;
}

export interface StateStoreStats {
  path: string | null;
  fileSize: number | null;
  keys: number;
  schemaVersion: number;
}

/** Key→value store backing /api/state (inventory, prefs, WoL hosts, etc.). */
export interface StateStore {
  getAll(): Promise<StateSnapshot>;
  get(key: string): Promise<StateEntry | null>;
  put(key: string, value: unknown): Promise<number>;
  delete(key: string): Promise<number>;
  importBulk(entries: Record<string, unknown>): Promise<number>;
  stats(): Promise<StateStoreStats>;
  close(): Promise<void>;
}

export interface SiemStats {
  sinceMs: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  byDeviceKind: Record<string, number>;
  bySource: { ip: string; count: number }[];
}

export interface SiemTotals {
  total: number;
  lastHour: number;
  lastEventAt: number | null;
}

/** Syslog/SIEM store backing the /api/siem routes and the UDP ingest path. */
export interface SiemStore {
  insertEvent(evt: InsertEventInput): Promise<StoredEvent>;
  queryEvents(opts?: QueryEventsOpts): Promise<SyslogEvent[]>;
  getStats(opts?: { since?: number }): Promise<SiemStats>;
  totals(): Promise<SiemTotals>;
  purgeOlderThanChunk(cutoffMs: number, chunkSize?: number): Promise<number>;
  replayAfter(lastId: number | string, limit?: number): Promise<SyslogEvent[]>;
  getById(id: number | string): Promise<SyslogEvent | null>;
  close(): Promise<void>;
}

export interface Stores {
  state: StateStore;
  siem: SiemStore;
  auth: AuthStore;
}

/**
 * Opens both stores for the resolved backend. Implemented per dialect in issues
 * 02–04; server/src/index.ts calls it instead of opening DBs directly.
 */
export type OpenStores = (config: ResolvedDbConfig) => Promise<Stores>;
