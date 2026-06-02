export const FALSY_ENV = ['false', '0', 'no', 'off', 'disabled'];

/**
 * Resolve an integration's enabled flag. `DISABLE_ALL` is a master kill-switch:
 * when truthy, every integration is forced off regardless of its individual
 * `*_ENABLED` flag (useful for smoke-testing the UI with no backends).
 *
 * @param value          the integration's *_ENABLED env value
 * @param defaultEnabled value when the flag is unset/empty
 */
export function isEnabled(value: string | undefined | null, defaultEnabled = true): boolean {
  const disableAll = String(process.env.DISABLE_ALL || '')
    .trim()
    .toLowerCase();
  if (disableAll && !FALSY_ENV.includes(disableAll)) return false;
  if (value === undefined || value === null || value === '') return defaultEnabled;
  return !FALSY_ENV.includes(String(value).trim().toLowerCase());
}

/** Strip trailing slashes from a base URL (so `${base}${path}` joins cleanly). */
export function trimBaseUrl(url: string | undefined | null): string {
  return String(url || '').replace(/\/+$/, '');
}

/** Compact "Nd Nh" / "Nh" uptime label from a second count. */
export function formatUptime(seconds: number): string {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}
