export type TimeFormat = '12h' | '24h';
export type DateFormat = 'short' | 'medium' | 'long' | 'iso';
export type TimeZoneChoice =
  | 'local'
  | 'UTC'
  | 'America/New_York'
  | 'America/Chicago'
  | 'America/Denver'
  | 'America/Phoenix'
  | 'America/Los_Angeles'
  | 'Europe/London'
  | 'Europe/Paris'
  | 'Asia/Tokyo';

export interface DateTimePreferences {
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  timeZone: TimeZoneChoice;
}

export const DEFAULT_DATETIME_PREFERENCES: DateTimePreferences = {
  timeFormat: '24h',
  dateFormat: 'medium',
  timeZone: 'local',
};

export const TIME_FORMAT_OPTIONS: Array<{ value: TimeFormat; label: string }> = [
  { value: '12h', label: '12-hour' },
  { value: '24h', label: '24-hour' },
];

export const DATE_FORMAT_OPTIONS: Array<{ value: DateFormat; label: string }> = [
  { value: 'short', label: '06/02/2026' },
  { value: 'medium', label: 'Jun 2, 2026' },
  { value: 'long', label: 'June 2, 2026' },
  { value: 'iso', label: '2026-06-02' },
];

export const TIME_ZONE_OPTIONS: Array<{ value: TimeZoneChoice; label: string }> = [
  { value: 'local', label: 'Browser local' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris' },
  { value: 'Asia/Tokyo', label: 'Tokyo' },
];

function timeZoneOption(choice: TimeZoneChoice): Pick<Intl.DateTimeFormatOptions, 'timeZone'> {
  return choice === 'local' ? {} : { timeZone: choice };
}

function dateOptions(format: DateFormat): Intl.DateTimeFormatOptions {
  if (format === 'iso') return {};
  if (format === 'short') return { month: '2-digit', day: '2-digit', year: 'numeric' };
  if (format === 'long') return { month: 'long', day: 'numeric', year: 'numeric' };
  return { month: 'short', day: 'numeric', year: 'numeric' };
}

export function formatClockTime(
  date: Date,
  prefs: DateTimePreferences,
  includeSeconds = true,
): string {
  return new Intl.DateTimeFormat(undefined, {
    ...timeZoneOption(prefs.timeZone),
    hour: '2-digit',
    minute: '2-digit',
    second: includeSeconds ? '2-digit' : undefined,
    hour12: prefs.timeFormat === '12h',
  }).format(date);
}

export function formatClockDate(date: Date, prefs: DateTimePreferences): string {
  if (prefs.dateFormat === 'iso') {
    const parts = new Intl.DateTimeFormat('en-US', {
      ...timeZoneOption(prefs.timeZone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  return new Intl.DateTimeFormat(undefined, {
    ...timeZoneOption(prefs.timeZone),
    ...dateOptions(prefs.dateFormat),
  }).format(date);
}

export function timeZoneLabel(choice: TimeZoneChoice): string {
  return TIME_ZONE_OPTIONS.find((option) => option.value === choice)?.label ?? choice;
}
