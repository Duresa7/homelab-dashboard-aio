import { describe, expect, it } from 'vitest';

import {
  OTHER_CATEGORY_ID,
  advanceRenewalDate,
  createDefaultSubscriptionLedger,
  deleteSubscriptionCategory,
  monthlyEquivalent,
  renewalTone,
  sanitizeSubscriptionLedger,
  type BillingInterval,
} from './subscriptions';

describe('subscription state helpers', () => {
  it.each([
    [{ count: 1, unit: 'months' }, 12],
    [{ count: 1, unit: 'years' }, 1],
    [{ count: 3, unit: 'years' }, 0.333],
    [{ count: 10, unit: 'days' }, 36.525],
  ] satisfies [BillingInterval, number][])(
    'normalizes %o to a monthly equivalent',
    (interval, expected) => {
      expect(monthlyEquivalent(12, interval)).toBeCloseTo(expected, 3);
    },
  );

  it('classifies renewal dates with a 14-day soon window', () => {
    const now = new Date(2026, 6, 2, 10, 0, 0);

    expect(renewalTone('2026-07-01', now)).toBe('overdue');
    expect(renewalTone('2026-07-02', now)).toBe('soon');
    expect(renewalTone('2026-07-16', now)).toBe('soon');
    expect(renewalTone('2026-07-17', now)).toBe('later');
    expect(renewalTone(undefined, now)).toBeNull();
  });

  it('advances overdue renewal dates until the next interval is current or future', () => {
    const now = new Date(2026, 6, 2, 10, 0, 0);

    expect(advanceRenewalDate('2026-05-01', { count: 1, unit: 'months' }, now)).toBe('2026-08-01');
    expect(advanceRenewalDate('2025-07-01', { count: 1, unit: 'years' }, now)).toBe('2027-07-01');
    expect(advanceRenewalDate('2026-07-15', { count: 1, unit: 'months' }, now)).toBe('2026-07-15');
  });

  it('clamps month-end renewals instead of overflowing into the next month', () => {
    expect(
      advanceRenewalDate('2026-01-31', { count: 1, unit: 'months' }, new Date(2026, 1, 5)),
    ).toBe('2026-02-28');
    expect(
      advanceRenewalDate('2026-08-31', { count: 1, unit: 'months' }, new Date(2026, 8, 3)),
    ).toBe('2026-09-30');
    expect(
      advanceRenewalDate('2024-02-29', { count: 1, unit: 'years' }, new Date(2025, 1, 15)),
    ).toBe('2025-02-28');
  });

  it('sanitizes the shared ledger and keeps Other as the fallback category', () => {
    const ledger = sanitizeSubscriptionLedger({
      categories: [{ id: 'it', name: 'IT' }],
      subscriptions: [
        {
          id: 'sub1',
          name: '  Backup  ',
          costUsd: 9.999,
          interval: { count: 1.5, unit: 'months' },
          categoryId: 'missing',
          tags: [' Work ', 'work', 'Annual Review'],
          nextRenewalDate: '2026-07-02',
          manageUrl: 'javascript:alert(1)',
          active: true,
        },
      ],
    });

    expect(ledger.categories).toEqual([
      { id: 'it', name: 'IT' },
      { id: OTHER_CATEGORY_ID, name: 'Other' },
    ]);
    expect(ledger.subscriptions[0]).toEqual({
      id: 'sub1',
      name: 'Backup',
      costUsd: 10,
      interval: { count: 1, unit: 'months' },
      categoryId: OTHER_CATEGORY_ID,
      tags: ['work', 'annual-review'],
      nextRenewalDate: '2026-07-02',
      active: true,
    });
  });

  it('reassigns subscriptions to Other when deleting a category', () => {
    const ledger = {
      ...createDefaultSubscriptionLedger(),
      subscriptions: [
        {
          id: 'sub1',
          name: 'VPN',
          costUsd: 5,
          interval: { count: 1, unit: 'months' as const },
          categoryId: 'cybersecurity',
          tags: [],
          active: true,
        },
      ],
    };

    expect(deleteSubscriptionCategory(ledger, 'cybersecurity').subscriptions[0].categoryId).toBe(
      OTHER_CATEGORY_ID,
    );
  });
});
