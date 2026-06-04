// Duration / age formatters shared across UNAS-related widgets and pages.
// Kept tiny and dependency-free.

export function formatPowerOnTime(hours: number | null | undefined): string {
  if (!hours) return '—';
  const days = hours / 24;
  if (days < 60) return `${Math.round(days)}d`;
  const months = days / 30.4375;
  if (months < 12) return `${Math.round(months)}mo`;
  const years = Math.floor(months / 12);
  const remMonths = Math.round(months - years * 12);
  return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`;
}

export interface AgeInfo {
  label: string;
  days: number;
}

export function ageSince(iso: string | null): AgeInfo | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86400000);
  let label: string;
  if (days === 0) label = 'today';
  else if (days === 1) label = 'yesterday';
  else if (days < 30) label = `${days}d ago`;
  else label = `${Math.floor(days / 30)}mo ago`;
  return { label, days };
}

export interface FormatSinceOptions {
  granularity?: 'minute' | 'second';
  absoluteAfterMs?: number;
}

function epochMs(value: Date | number | string | null | undefined): number | null {
  if (!value) return null;
  const ms =
    value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Relative "time since" formatter for recent, live-ish timestamps.
 *
 * Default output preserves dashboard minute-hour-day strings. `granularity:
 * 'second'` preserves second-level freshness with a configurable absolute-date
 * cutoff.
 */
export function formatSince(
  value: Date | number | string | null | undefined,
  options: FormatSinceOptions = {},
): string {
  const ts = epochMs(value);
  if (ts == null) return '—';
  const diff = Math.max(0, Date.now() - ts);
  if (options.absoluteAfterMs != null && diff >= options.absoluteAfterMs) {
    return new Date(ts).toLocaleString();
  }
  if (options.granularity === 'second' && diff < 60000) {
    return `${Math.floor(diff / 1000)}s ago`;
  }
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (options.granularity === 'second' && h < 24) return `${h}h ago`;
  if (h < 24) return `${h}h ${m % 60}m ago`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ago`;
}
