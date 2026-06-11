import type { AuthStore } from '../auth/types.js';
import type { InsertEventInput, QueryEventsOpts, StoredEvent, SyslogEvent } from '../siem/types.js';
import type { ResolvedDbConfig } from './config.js';

export interface StateSnapshot {
  values: Record<string, unknown>;
  updatedAt: Record<string, number>;
}

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

export type OpenStores = (config: ResolvedDbConfig) => Promise<Stores>;
