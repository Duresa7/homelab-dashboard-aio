export const SUBSCRIPTIONS_KEY = 'subscriptions';

export const OTHER_CATEGORY_ID = 'other';

export const DEFAULT_SUBSCRIPTION_CATEGORIES: SubscriptionCategory[] = [
  { id: 'it', name: 'IT' },
  { id: 'cybersecurity', name: 'Cybersecurity' },
  { id: 'entertainment', name: 'Entertainment' },
  { id: 'utilities', name: 'Utilities' },
  { id: OTHER_CATEGORY_ID, name: 'Other' },
];

export type BillingUnit = 'days' | 'months' | 'years';
export type RenewalTone = 'overdue' | 'soon' | 'later';

export interface BillingInterval {
  count: number;
  unit: BillingUnit;
}

export interface SubscriptionCategory {
  id: string;
  name: string;
}

export interface Subscription {
  id: string;
  name: string;
  costUsd: number;
  interval: BillingInterval;
  categoryId: string;
  tags: string[];
  nextRenewalDate?: string;
  manageUrl?: string;
  notes?: string;
  active: boolean;
}

export interface SubscriptionLedger {
  subscriptions: Subscription[];
  categories: SubscriptionCategory[];
}

export type SubscriptionInput = Omit<Subscription, 'id'>;

const BILLING_UNITS = new Set<BillingUnit>(['days', 'months', 'years']);
const DAY_MONTH_EQUIVALENT = 30.4375;

export function createDefaultSubscriptionLedger(): SubscriptionLedger {
  return {
    subscriptions: [],
    categories: DEFAULT_SUBSCRIPTION_CATEGORIES.map((category) => ({ ...category })),
  };
}

export function newSubscriptionId(prefix: 'sub' | 'cat'): string {
  const rand =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) =>
          n.toString(36).padStart(2, '0'),
        ).join('')
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rand.slice(0, 8)}`;
}

export function isSubscriptionId(id: string): boolean {
  return /^[a-z][a-z0-9_-]{1,39}$/i.test(id);
}

export function sanitizeSubscriptionLedger(value: unknown): SubscriptionLedger {
  if (!isRecord(value)) return createDefaultSubscriptionLedger();

  const categories = sanitizeCategories(value.categories);
  const categoryIds = new Set(categories.map((category) => category.id));
  const subscriptions = Array.isArray(value.subscriptions)
    ? value.subscriptions.flatMap((item): Subscription[] => {
        const subscription = sanitizeSubscription(item, categoryIds);
        return subscription ? [subscription] : [];
      })
    : [];

  return { categories, subscriptions };
}

export function monthlyEquivalent(costUsd: number, interval: BillingInterval): number {
  const count = Math.max(1, Math.floor(interval.count));
  if (interval.unit === 'days') return costUsd * (DAY_MONTH_EQUIVALENT / count);
  if (interval.unit === 'years') return costUsd / (12 * count);
  return costUsd / count;
}

export function yearlyEquivalent(costUsd: number, interval: BillingInterval): number {
  return monthlyEquivalent(costUsd, interval) * 12;
}

export function renewalTone(
  nextRenewalDate: string | undefined,
  now = new Date(),
): RenewalTone | null {
  const renewal = parseDateOnly(nextRenewalDate);
  if (!renewal) return null;
  const today = startOfLocalDay(now);
  const diffDays = Math.round((renewal.getTime() - today.getTime()) / dayMs());
  if (diffDays < 0) return 'overdue';
  return diffDays <= 14 ? 'soon' : 'later';
}

export function advanceRenewalDate(
  nextRenewalDate: string | undefined,
  interval: BillingInterval,
  now = new Date(),
): string | undefined {
  let renewal = parseDateOnly(nextRenewalDate);
  if (!renewal) return undefined;
  const today = startOfLocalDay(now);
  while (renewal.getTime() < today.getTime()) {
    renewal = addBillingInterval(renewal, interval);
  }
  return formatDateOnly(renewal);
}

export function existingTags(subscriptions: Subscription[]): string[] {
  return [...new Set(subscriptions.flatMap((subscription) => subscription.tags))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 40);
}

export function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value.flatMap((item) => {
    if (typeof item !== 'string') return [];
    const tag = normalizeTag(item);
    return tag ? [tag] : [];
  });
  return unique(tags);
}

export function createSubscription(
  ledger: SubscriptionLedger,
  input: SubscriptionInput,
): SubscriptionLedger {
  const categoryIds = new Set(ledger.categories.map((category) => category.id));
  const subscription = sanitizeSubscription(
    {
      ...input,
      id: newSubscriptionId('sub'),
    },
    categoryIds,
  );
  if (!subscription) return ledger;
  return sanitizeSubscriptionLedger({
    ...ledger,
    subscriptions: [...ledger.subscriptions, subscription],
  });
}

export function updateSubscription(
  ledger: SubscriptionLedger,
  subscriptionId: string,
  patch: Partial<SubscriptionInput>,
): SubscriptionLedger {
  return sanitizeSubscriptionLedger({
    ...ledger,
    subscriptions: ledger.subscriptions.map((subscription) =>
      subscription.id === subscriptionId ? { ...subscription, ...patch } : subscription,
    ),
  });
}

export function deleteSubscription(
  ledger: SubscriptionLedger,
  subscriptionId: string,
): SubscriptionLedger {
  return {
    ...ledger,
    subscriptions: ledger.subscriptions.filter(
      (subscription) => subscription.id !== subscriptionId,
    ),
  };
}

export function createSubscriptionCategory(
  ledger: SubscriptionLedger,
  name: string,
): SubscriptionLedger {
  const trimmed = name.trim();
  if (!trimmed || categoryNameExists(ledger.categories, trimmed)) return ledger;
  return sanitizeSubscriptionLedger({
    ...ledger,
    categories: [...ledger.categories, { id: newSubscriptionId('cat'), name: trimmed }],
  });
}

export function renameSubscriptionCategory(
  ledger: SubscriptionLedger,
  categoryId: string,
  name: string,
): SubscriptionLedger {
  const trimmed = name.trim();
  if (!trimmed) return ledger;
  const duplicate = ledger.categories.some(
    (category) =>
      category.id !== categoryId && category.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicate) return ledger;
  return sanitizeSubscriptionLedger({
    ...ledger,
    categories: ledger.categories.map((category) =>
      category.id === categoryId ? { ...category, name: trimmed } : category,
    ),
  });
}

export function deleteSubscriptionCategory(
  ledger: SubscriptionLedger,
  categoryId: string,
): SubscriptionLedger {
  if (categoryId === OTHER_CATEGORY_ID) return ledger;
  return sanitizeSubscriptionLedger({
    categories: ledger.categories.filter((category) => category.id !== categoryId),
    subscriptions: ledger.subscriptions.map((subscription) =>
      subscription.categoryId === categoryId
        ? { ...subscription, categoryId: OTHER_CATEGORY_ID }
        : subscription,
    ),
  });
}

function sanitizeCategories(value: unknown): SubscriptionCategory[] {
  if (!Array.isArray(value)) return createDefaultSubscriptionLedger().categories;
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const categories = value.flatMap((item): SubscriptionCategory[] => {
    if (!isRecord(item)) return [];
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const nameKey = name.toLowerCase();
    if (!isSubscriptionId(id) || !name || seenIds.has(id) || seenNames.has(nameKey)) return [];
    seenIds.add(id);
    seenNames.add(nameKey);
    return [{ id, name }];
  });
  if (!seenIds.has(OTHER_CATEGORY_ID)) categories.push({ id: OTHER_CATEGORY_ID, name: 'Other' });
  return categories;
}

function sanitizeSubscription(value: unknown, categoryIds: Set<string>): Subscription | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!isSubscriptionId(id) || !name) return undefined;

  const interval = sanitizeInterval(value.interval);
  const categoryId =
    typeof value.categoryId === 'string' && categoryIds.has(value.categoryId)
      ? value.categoryId
      : OTHER_CATEGORY_ID;
  const nextRenewalDate = sanitizeDateOnly(value.nextRenewalDate);
  const manageUrl = sanitizeManageUrl(value.manageUrl);
  const notes = typeof value.notes === 'string' ? value.notes.trim() : '';

  return {
    id,
    name,
    costUsd: sanitizeCost(value.costUsd),
    interval,
    categoryId,
    tags: sanitizeTags(value.tags),
    ...(nextRenewalDate ? { nextRenewalDate } : {}),
    ...(manageUrl ? { manageUrl } : {}),
    ...(notes ? { notes } : {}),
    active: value.active !== false,
  };
}

function sanitizeInterval(value: unknown): BillingInterval {
  if (!isRecord(value)) return { count: 1, unit: 'months' };
  const unit = BILLING_UNITS.has(value.unit as BillingUnit)
    ? (value.unit as BillingUnit)
    : 'months';
  const count =
    typeof value.count === 'number' && Number.isFinite(value.count)
      ? Math.max(1, Math.floor(value.count))
      : 1;
  return { count, unit };
}

function sanitizeCost(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value) * 100) / 100;
}

function sanitizeDateOnly(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return parseDateOnly(value.trim()) ? value.trim() : undefined;
}

function sanitizeManageUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseDateOnly(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

function addBillingInterval(date: Date, interval: BillingInterval): Date {
  const count = Math.max(1, Math.floor(interval.count));
  if (interval.unit === 'days') {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
  }
  // Clamp to the target month's last day: Date's setMonth/setFullYear overflow
  // (Jan 31 + 1 month → Mar 3, Feb 29 + 1 year → Mar 1) would shift renewals.
  const monthsAhead = interval.unit === 'months' ? count : 12 * count;
  const targetMonth = new Date(date.getFullYear(), date.getMonth() + monthsAhead, 1);
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  return new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth(),
    Math.min(date.getDate(), lastDay),
  );
}

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayMs(): number {
  return 24 * 60 * 60 * 1000;
}

function categoryNameExists(categories: SubscriptionCategory[], name: string): boolean {
  return categories.some((category) => category.name.toLowerCase() === name.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
