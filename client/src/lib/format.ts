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
