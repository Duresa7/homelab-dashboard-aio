export const FALSY_ENV = ['false', '0', 'no', 'off', 'disabled'];

export function isEnabled(value: string | undefined | null, defaultEnabled = true): boolean {
  const disableAll = String(process.env.DISABLE_ALL || '')
    .trim()
    .toLowerCase();
  if (disableAll && !FALSY_ENV.includes(disableAll)) return false;
  if (value === undefined || value === null || value === '') return defaultEnabled;
  return !FALSY_ENV.includes(String(value).trim().toLowerCase());
}

export function isDebugEndpointEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || isEnabled(env.DEBUG_ENDPOINTS_ENABLED, false);
}

export function trimBaseUrl(url: string | undefined | null): string {
  return String(url || '').replace(/\/+$/, '');
}

export function formatUptime(seconds: number): string {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}
