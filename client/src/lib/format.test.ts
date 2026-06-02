import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatSince } from './format';

describe('formatSince', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps the default minute/hour detail used by Protect status cards', () => {
    vi.setSystemTime(new Date('2026-06-02T12:00:00Z'));

    expect(formatSince(Date.parse('2026-06-02T10:25:00Z'))).toBe('1h 35m ago');
  });

  it('supports event-row second granularity and absolute-date cutoff', () => {
    vi.setSystemTime(new Date('2026-06-02T12:00:00Z'));

    expect(formatSince(Date.parse('2026-06-02T11:59:30Z'), { granularity: 'second' })).toBe(
      '30s ago',
    );
    expect(
      formatSince(Date.parse('2026-06-01T11:59:59Z'), {
        granularity: 'second',
        absoluteAfterMs: 86400000,
      }),
    ).toBe(new Date('2026-06-01T11:59:59Z').toLocaleString());
  });
});
