import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  ArrowUpDown,
  CalendarClock,
  CreditCard,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { SectionCard, StatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { canEdit, useAuth } from '@/lib/auth';
import {
  OTHER_CATEGORY_ID,
  SUBSCRIPTIONS_KEY,
  advanceRenewalDate,
  createDefaultSubscriptionLedger,
  createSubscription,
  createSubscriptionCategory,
  deleteSubscription,
  deleteSubscriptionCategory,
  existingTags,
  monthlyEquivalent,
  normalizeTag,
  renameSubscriptionCategory,
  renewalTone,
  sanitizeSubscriptionLedger,
  updateSubscription,
  type BillingUnit,
  type Subscription,
  type SubscriptionCategory,
  type SubscriptionInput,
  type SubscriptionLedger,
} from '@/lib/subscriptions';
import { getState, setState, subscribe as subscribeState } from '@/lib/store';
import { cn } from '@/lib/utils';

const EMPTY_LEDGER = createDefaultSubscriptionLedger();
const ALL_CATEGORIES = '__all_categories__';
const ALL_TAGS = '__all_tags__';

let lastRawLedger: unknown = null;
let lastLedger = EMPTY_LEDGER;

type SubscriptionDialogState = { mode: 'create' } | { mode: 'edit'; subscriptionId: string } | null;
type SortKey = 'name' | 'cost' | 'renewal';
type SortDirection = 'asc' | 'desc';
type IntervalMode = 'monthly' | 'yearly' | 'custom';

interface SubscriptionFormState {
  name: string;
  costUsd: string;
  intervalMode: IntervalMode;
  intervalCount: string;
  intervalUnit: BillingUnit;
  categoryId: string;
  tags: string[];
  tagDraft: string;
  nextRenewalDate: string;
  manageUrl: string;
  notes: string;
  active: boolean;
}

function readLedger(): SubscriptionLedger {
  const raw = getState<unknown>(SUBSCRIPTIONS_KEY, EMPTY_LEDGER);
  if (raw === lastRawLedger) return lastLedger;
  lastRawLedger = raw;
  lastLedger = sanitizeSubscriptionLedger(raw);
  return lastLedger;
}

function useSubscriptionLedger(): [SubscriptionLedger, (next: SubscriptionLedger) => void] {
  const ledger = useSyncExternalStore(
    (fn) => subscribeState(SUBSCRIPTIONS_KEY, fn),
    readLedger,
    readLedger,
  );
  return [
    ledger,
    (next) => setState<SubscriptionLedger>(SUBSCRIPTIONS_KEY, sanitizeSubscriptionLedger(next)),
  ];
}

function categoryById(categories: SubscriptionCategory[]): Map<string, SubscriptionCategory> {
  return new Map(categories.map((category) => [category.id, category]));
}

function currency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function intervalLabel(interval: { count: number; unit: BillingUnit }): string {
  if (interval.count === 1 && interval.unit === 'months') return 'monthly';
  if (interval.count === 1 && interval.unit === 'years') return 'yearly';
  const unit = interval.count === 1 ? interval.unit.slice(0, -1) : interval.unit;
  return `every ${interval.count} ${unit}`;
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function renewalTime(value: string | undefined): number | null {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  const time = new Date(year, month - 1, day).getTime();
  return Number.isNaN(time) ? null : time;
}

function subscriptionMonthly(subscription: Subscription): number {
  return monthlyEquivalent(subscription.costUsd, subscription.interval);
}

export function SubscriptionTrackerSection() {
  const editor = canEdit(useAuth().user);
  const [ledger, setLedger] = useSubscriptionLedger();
  const [dialog, setDialog] = useState<SubscriptionDialogState>(null);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [deleteSubscriptionTarget, setDeleteSubscriptionTarget] = useState<Subscription | null>(
    null,
  );
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<SubscriptionCategory | null>(
    null,
  );
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);
  const [tagFilter, setTagFilter] = useState(ALL_TAGS);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const categories = ledger.categories;
  const categoriesById = useMemo(() => categoryById(categories), [categories]);
  const tags = useMemo(() => existingTags(ledger.subscriptions), [ledger.subscriptions]);
  const activeSubscriptions = useMemo(
    () => ledger.subscriptions.filter((subscription) => subscription.active),
    [ledger.subscriptions],
  );
  const cancelledSubscriptions = useMemo(
    () => ledger.subscriptions.filter((subscription) => !subscription.active),
    [ledger.subscriptions],
  );

  useEffect(() => {
    if (
      categoryFilter !== ALL_CATEGORIES &&
      !categories.some((category) => category.id === categoryFilter)
    ) {
      setCategoryFilter(ALL_CATEGORIES);
    }
  }, [categories, categoryFilter]);

  useEffect(() => {
    if (tagFilter !== ALL_TAGS && !tags.includes(tagFilter)) setTagFilter(ALL_TAGS);
  }, [tagFilter, tags]);

  const summary = useMemo(() => {
    const totalMonthly = activeSubscriptions.reduce(
      (sum, subscription) => sum + subscriptionMonthly(subscription),
      0,
    );
    const cancelledMonthly = cancelledSubscriptions.reduce(
      (sum, subscription) => sum + subscriptionMonthly(subscription),
      0,
    );
    const renewingSoon = activeSubscriptions.filter((subscription) => {
      const tone = renewalTone(subscription.nextRenewalDate);
      return tone === 'soon' || tone === 'overdue';
    }).length;
    return {
      totalMonthly,
      totalYearly: totalMonthly * 12,
      activeCount: activeSubscriptions.length,
      cancelledMonthly,
      renewingSoon,
    };
  }, [activeSubscriptions, cancelledSubscriptions]);

  const categoryBreakdown = useMemo(
    () =>
      categories.map((category) => ({
        category,
        monthly: activeSubscriptions
          .filter((subscription) => subscription.categoryId === category.id)
          .reduce((sum, subscription) => sum + subscriptionMonthly(subscription), 0),
      })),
    [activeSubscriptions, categories],
  );

  const filteredSubscriptions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = activeSubscriptions.filter((subscription) => {
      if (needle && !subscription.name.toLowerCase().includes(needle)) return false;
      if (categoryFilter !== ALL_CATEGORIES && subscription.categoryId !== categoryFilter) {
        return false;
      }
      if (tagFilter !== ALL_TAGS && !subscription.tags.includes(tagFilter)) return false;
      return true;
    });
    const direction = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return direction * a.name.localeCompare(b.name);
      if (sortKey === 'cost') return direction * (subscriptionMonthly(a) - subscriptionMonthly(b));
      const aTime = renewalTime(a.nextRenewalDate);
      const bTime = renewalTime(b.nextRenewalDate);
      if (aTime == null && bTime == null) return 0;
      if (aTime == null) return 1;
      if (bTime == null) return -1;
      return direction * (aTime - bTime);
    });
  }, [activeSubscriptions, categoryFilter, search, sortDirection, sortKey, tagFilter]);

  const setSortedBy = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  const changeLedger = (mutate: (current: SubscriptionLedger) => SubscriptionLedger) => {
    setLedger(mutate(ledger));
  };

  const saveSubscription = (input: SubscriptionInput) => {
    if (!dialog || !editor) return;
    if (dialog.mode === 'create') {
      changeLedger((current) => createSubscription(current, input));
      toast.success(`Added ${input.name}`);
    } else {
      changeLedger((current) => updateSubscription(current, dialog.subscriptionId, input));
      toast.success(`Updated ${input.name}`);
    }
    setDialog(null);
  };

  const confirmDeleteSubscription = () => {
    if (!deleteSubscriptionTarget) return;
    const target = deleteSubscriptionTarget;
    changeLedger((current) => deleteSubscription(current, target.id));
    setDeleteSubscriptionTarget(null);
    setDialog(null);
    toast.success(`Deleted ${target.name}`);
  };

  const confirmDeleteCategory = () => {
    if (!deleteCategoryTarget) return;
    const target = deleteCategoryTarget;
    changeLedger((current) => deleteSubscriptionCategory(current, target.id));
    setDeleteCategoryTarget(null);
    toast.success(`Deleted ${target.name}`);
  };

  const advanceRenewal = (subscription: Subscription) => {
    const nextRenewalDate = advanceRenewalDate(subscription.nextRenewalDate, subscription.interval);
    if (!nextRenewalDate) return;
    changeLedger((current) => updateSubscription(current, subscription.id, { nextRenewalDate }));
    toast.success(`Advanced ${subscription.name}`);
  };

  return (
    <>
      <MetricSummary summary={summary} />
      <CategoryBreakdown breakdown={categoryBreakdown} totalMonthly={summary.totalMonthly} />

      <SectionCard
        span={12}
        title="Subscriptions"
        sub={`${filteredSubscriptions.length} active`}
        icon={<CreditCard size={14} strokeWidth={1.75} />}
        actions={
          editor ? (
            <>
              <Button type="button" size="sm" onClick={() => setCategoryDialogOpen(true)}>
                <Settings2 className="size-4" />
                Manage categories
              </Button>
              <Button type="button" size="sm" onClick={() => setDialog({ mode: 'create' })}>
                <Plus className="size-4" />
                New subscription
              </Button>
            </>
          ) : (
            <StatusBadge kind="idle">read only</StatusBadge>
          )
        }
        bodyClassName="p-0"
      >
        <div className="grid gap-3 border-b border-border px-[var(--pad)] py-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px]">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9"
              placeholder="Search by name"
            />
          </label>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>All categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={tagFilter} onValueChange={setTagFilter}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TAGS}>All tags</SelectItem>
              {tags.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  {tag}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {activeSubscriptions.length === 0 ? (
          <EmptySubscriptions editor={editor} onCreate={() => setDialog({ mode: 'create' })} />
        ) : filteredSubscriptions.length === 0 ? (
          <div className="px-[var(--pad)] py-12 text-center text-sm text-muted-foreground">
            No active subscriptions match these filters.
          </div>
        ) : (
          <SubscriptionTable
            subscriptions={filteredSubscriptions}
            categoriesById={categoriesById}
            editor={editor}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={setSortedBy}
            onOpen={(subscription) => setDialog({ mode: 'edit', subscriptionId: subscription.id })}
            onAdvance={advanceRenewal}
          />
        )}

        <CancelledSubscriptions
          subscriptions={cancelledSubscriptions}
          categoriesById={categoriesById}
          monthlySavings={summary.cancelledMonthly}
          onOpen={(subscription) => setDialog({ mode: 'edit', subscriptionId: subscription.id })}
        />
      </SectionCard>

      <SubscriptionDialog
        state={dialog}
        ledger={ledger}
        editor={editor}
        tags={tags}
        onOpenChange={(open) => !open && setDialog(null)}
        onSave={saveSubscription}
        onDelete={(subscription) => setDeleteSubscriptionTarget(subscription)}
      />

      <CategoryDialog
        open={categoryDialogOpen}
        ledger={ledger}
        onOpenChange={setCategoryDialogOpen}
        onCreate={(name) => {
          changeLedger((current) => createSubscriptionCategory(current, name));
          toast.success(`Added ${name.trim()}`);
        }}
        onRename={(category, name) => {
          changeLedger((current) => renameSubscriptionCategory(current, category.id, name));
          toast.success(`Renamed ${category.name}`);
        }}
        onDelete={(category) => setDeleteCategoryTarget(category)}
      />

      <ConfirmDialog
        open={deleteSubscriptionTarget != null}
        title="Delete subscription"
        description={`Delete "${deleteSubscriptionTarget?.name}" permanently?`}
        confirmLabel="Delete subscription"
        onConfirm={confirmDeleteSubscription}
        onOpenChange={(open) => !open && setDeleteSubscriptionTarget(null)}
      />

      <ConfirmDialog
        open={deleteCategoryTarget != null}
        title="Delete category"
        description={
          deleteCategoryTarget
            ? `Delete "${deleteCategoryTarget.name}" and reassign its subscriptions to Other?`
            : ''
        }
        confirmLabel="Delete category"
        onConfirm={confirmDeleteCategory}
        onOpenChange={(open) => !open && setDeleteCategoryTarget(null)}
      />
    </>
  );
}

function MetricSummary({
  summary,
}: {
  summary: {
    totalMonthly: number;
    totalYearly: number;
    activeCount: number;
    renewingSoon: number;
  };
}) {
  return (
    <>
      <MetricCard
        title="Monthly equivalent"
        value={currency(summary.totalMonthly)}
        sub="Active subscriptions"
        icon={<CreditCard size={14} strokeWidth={1.75} />}
      />
      <MetricCard
        title="Yearly equivalent"
        value={currency(summary.totalYearly)}
        sub="Projected spend"
        icon={<CalendarClock size={14} strokeWidth={1.75} />}
      />
      <MetricCard
        title="Active subscriptions"
        value={String(summary.activeCount)}
        sub={`${summary.renewingSoon} renewing soon`}
        icon={<Tags size={14} strokeWidth={1.75} />}
      />
    </>
  );
}

function MetricCard({
  title,
  value,
  sub,
  icon,
}: {
  title: string;
  value: string;
  sub: string;
  icon: ReactNode;
}) {
  return (
    <SectionCard span={4} title={title} sub={sub} icon={icon}>
      <div className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </div>
    </SectionCard>
  );
}

function CategoryBreakdown({
  breakdown,
  totalMonthly,
}: {
  breakdown: { category: SubscriptionCategory; monthly: number }[];
  totalMonthly: number;
}) {
  const visible = breakdown.filter((item) => item.monthly > 0);
  return (
    <SectionCard
      span={12}
      title="Cost by subscription category"
      sub={totalMonthly > 0 ? currency(totalMonthly) : 'No active spend'}
      icon={<CreditCard size={14} strokeWidth={1.75} />}
    >
      {visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Add active subscriptions to see the breakdown.
        </div>
      ) : (
        <div className="grid gap-3">
          {visible.map((item) => {
            const percent = totalMonthly > 0 ? (item.monthly / totalMonthly) * 100 : 0;
            return (
              <div key={item.category.id} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium text-foreground">{item.category.name}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {currency(item.monthly)}/mo
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.max(3, percent)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function SubscriptionTable({
  subscriptions,
  categoriesById,
  editor,
  sortKey,
  sortDirection,
  onSort,
  onOpen,
  onAdvance,
}: {
  subscriptions: Subscription[];
  categoriesById: Map<string, SubscriptionCategory>;
  editor: boolean;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSort: (key: SortKey) => void;
  onOpen: (subscription: Subscription) => void;
  onAdvance: (subscription: Subscription) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <SortButton
              active={sortKey === 'name'}
              direction={sortDirection}
              onClick={() => onSort('name')}
            >
              Name
            </SortButton>
          </TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Tags</TableHead>
          <TableHead>
            <SortButton
              active={sortKey === 'cost'}
              direction={sortDirection}
              onClick={() => onSort('cost')}
            >
              Cost
            </SortButton>
          </TableHead>
          <TableHead>Monthly</TableHead>
          <TableHead>
            <SortButton
              active={sortKey === 'renewal'}
              direction={sortDirection}
              onClick={() => onSort('renewal')}
            >
              Next renewal
            </SortButton>
          </TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {subscriptions.map((subscription) => (
          <SubscriptionRow
            key={subscription.id}
            subscription={subscription}
            category={categoriesById.get(subscription.categoryId)}
            editor={editor}
            onOpen={() => onOpen(subscription)}
            onAdvance={() => onAdvance(subscription)}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function SortButton({
  active,
  direction,
  onClick,
  children,
}: {
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm text-left font-medium hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
      onClick={onClick}
    >
      {children}
      <ArrowUpDown className={cn('size-3', active && direction === 'desc' && 'rotate-180')} />
    </button>
  );
}

function SubscriptionRow({
  subscription,
  category,
  editor,
  onOpen,
  onAdvance,
}: {
  subscription: Subscription;
  category: SubscriptionCategory | undefined;
  editor: boolean;
  onOpen: () => void;
  onAdvance: () => void;
}) {
  const monthly = subscriptionMonthly(subscription);
  const tone = renewalTone(subscription.nextRenewalDate);
  return (
    <TableRow>
      <TableCell className="min-w-[220px]">
        <div className="flex min-w-0 flex-col gap-1">
          {subscription.manageUrl ? (
            <a
              href={subscription.manageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-max items-center gap-1 font-medium text-foreground hover:text-brand hover:underline"
            >
              {subscription.name}
              <ExternalLink className="size-3" />
            </a>
          ) : (
            <span className="font-medium text-foreground">{subscription.name}</span>
          )}
          {subscription.notes ? (
            <span className="max-w-[28rem] truncate text-xs text-muted-foreground">
              {subscription.notes}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <CategoryChip category={category} />
      </TableCell>
      <TableCell className="min-w-[160px]">
        <TagChips tags={subscription.tags} />
      </TableCell>
      <TableCell className="tabular-nums">
        <div className="flex flex-col">
          <span>{currency(subscription.costUsd)}</span>
          <span className="text-xs text-muted-foreground">
            {intervalLabel(subscription.interval)}
          </span>
        </div>
      </TableCell>
      <TableCell className="font-medium tabular-nums">{currency(monthly)}/mo</TableCell>
      <TableCell>
        <RenewalCell
          date={subscription.nextRenewalDate}
          tone={tone}
          editor={editor}
          onAdvance={onAdvance}
        />
      </TableCell>
      <TableCell>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={editor ? `Edit ${subscription.name}` : `View ${subscription.name}`}
          onClick={onOpen}
        >
          <Pencil className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CategoryChip({ category }: { category: SubscriptionCategory | undefined }) {
  return (
    <Badge variant="outline" className="font-medium">
      {category?.name ?? 'Other'}
    </Badge>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-xs text-muted-foreground">No tags</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="font-normal">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

function RenewalCell({
  date,
  tone,
  editor,
  onAdvance,
}: {
  date: string | undefined;
  tone: ReturnType<typeof renewalTone>;
  editor: boolean;
  onAdvance: () => void;
}) {
  if (!date) return <span className="text-sm text-muted-foreground">No date</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm tabular-nums">{dateLabel(date)}</span>
      {tone === 'soon' ? <StatusBadge kind="warn">renews soon</StatusBadge> : null}
      {tone === 'overdue' ? <StatusBadge kind="bad">overdue</StatusBadge> : null}
      {editor && tone === 'overdue' ? (
        <Button type="button" variant="outline" size="xs" onClick={onAdvance}>
          <RefreshCw className="size-3" />
          Advance
        </Button>
      ) : null}
    </div>
  );
}

function CancelledSubscriptions({
  subscriptions,
  categoriesById,
  monthlySavings,
  onOpen,
}: {
  subscriptions: Subscription[];
  categoriesById: Map<string, SubscriptionCategory>;
  monthlySavings: number;
  onOpen: (subscription: Subscription) => void;
}) {
  if (subscriptions.length === 0) return null;
  return (
    <details className="border-t border-border">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-[var(--pad)] py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
        <span>
          Cancelled · {subscriptions.length} · saving {currency(monthlySavings)}/mo
        </span>
      </summary>
      <div className="grid gap-2 px-[var(--pad)] pb-[var(--pad)]">
        {subscriptions.map((subscription) => (
          <button
            key={subscription.id}
            type="button"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/40"
            onClick={() => onOpen(subscription)}
          >
            <span className="min-w-0 flex-1 truncate line-through">{subscription.name}</span>
            <span className="flex items-center gap-2">
              <CategoryChip category={categoriesById.get(subscription.categoryId)} />
              <span className="tabular-nums">{currency(subscriptionMonthly(subscription))}/mo</span>
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

function EmptySubscriptions({ editor, onCreate }: { editor: boolean; onCreate: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-lg border border-border bg-muted/30">
        <CreditCard className="size-5 text-muted-foreground" />
      </div>
      <div className="text-sm font-semibold text-foreground">No subscriptions yet</div>
      <div className="max-w-sm text-sm text-muted-foreground">
        {editor
          ? 'Add a recurring service to track renewal dates and normalized monthly spend.'
          : 'No shared subscriptions have been created yet.'}
      </div>
      {editor ? (
        <Button type="button" onClick={onCreate}>
          <Plus className="size-4" />
          New subscription
        </Button>
      ) : null}
    </div>
  );
}

function SubscriptionDialog({
  state,
  ledger,
  editor,
  tags,
  onOpenChange,
  onSave,
  onDelete,
}: {
  state: SubscriptionDialogState;
  ledger: SubscriptionLedger;
  editor: boolean;
  tags: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (input: SubscriptionInput) => void;
  onDelete: (subscription: Subscription) => void;
}) {
  const subscription =
    state?.mode === 'edit'
      ? ledger.subscriptions.find((item) => item.id === state.subscriptionId)
      : null;
  const subscriptionId = state?.mode === 'edit' ? state.subscriptionId : null;
  const [form, setForm] = useState<SubscriptionFormState>(() => emptyForm(ledger));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    const seed = subscriptionId
      ? ledger.subscriptions.find((item) => item.id === subscriptionId)
      : null;
    setForm(seed ? formFromSubscription(seed) : emptyForm(ledger));
    setError(null);
    // Seed the form only when the dialog target changes, not when the ledger mutates
    // underneath, which would discard unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, subscriptionId]);

  const updateForm = (patch: Partial<SubscriptionFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const addTag = (value: string) => {
    const tag = normalizeTag(value);
    if (!tag || form.tags.includes(tag)) {
      updateForm({ tagDraft: '' });
      return;
    }
    updateForm({ tags: [...form.tags, tag], tagDraft: '' });
  };

  const removeTag = (tag: string) => {
    updateForm({ tags: form.tags.filter((current) => current !== tag) });
  };

  const save = () => {
    if (!editor) return;
    const input = inputFromForm(form);
    if (!input.name) {
      setError('Subscription name is required.');
      return;
    }
    if (input.costUsd <= 0) {
      setError('Cost must be greater than zero.');
      return;
    }
    onSave(input);
  };

  const availableTags = tags.filter((tag) => !form.tags.includes(tag));

  return (
    <Dialog open={state != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {state?.mode === 'create'
              ? 'New subscription'
              : editor
                ? 'Edit subscription'
                : 'Subscription'}
          </DialogTitle>
          <DialogDescription>
            {!editor
              ? 'View this subscription.'
              : state?.mode === 'create'
                ? 'Track a recurring paid service.'
                : 'Update this recurring paid service.'}
          </DialogDescription>
        </DialogHeader>

        {state?.mode === 'edit' && !subscription ? (
          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            Subscription not found.
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <div className="grid gap-2">
                <Label htmlFor="subscription-name">Name</Label>
                <Input
                  id="subscription-name"
                  value={form.name}
                  disabled={!editor}
                  autoFocus={editor && state?.mode === 'create'}
                  onChange={(event) => updateForm({ name: event.target.value })}
                  placeholder="Backblaze"
                  aria-invalid={error ? true : undefined}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="subscription-cost">Cost in USD</Label>
                <Input
                  id="subscription-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costUsd}
                  disabled={!editor}
                  onChange={(event) => updateForm({ costUsd: event.target.value })}
                  placeholder="9.99"
                  aria-invalid={error ? true : undefined}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <Label>Billing interval</Label>
              <div className="flex flex-wrap gap-2">
                {(['monthly', 'yearly', 'custom'] as IntervalMode[]).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={form.intervalMode === mode ? 'default' : 'outline'}
                    size="sm"
                    disabled={!editor}
                    onClick={() => updateForm({ intervalMode: mode })}
                  >
                    {mode === 'monthly' ? 'Monthly' : mode === 'yearly' ? 'Yearly' : 'Custom...'}
                  </Button>
                ))}
              </div>
              {form.intervalMode === 'custom' ? (
                <div className="grid gap-3 sm:grid-cols-[140px_180px]">
                  <div className="grid gap-2">
                    <Label htmlFor="subscription-interval-count">Every</Label>
                    <Input
                      id="subscription-interval-count"
                      type="number"
                      min="1"
                      step="1"
                      value={form.intervalCount}
                      disabled={!editor}
                      onChange={(event) => updateForm({ intervalCount: event.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Unit</Label>
                    <Select
                      value={form.intervalUnit}
                      onValueChange={(value) => updateForm({ intervalUnit: value as BillingUnit })}
                      disabled={!editor}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="days">Days</SelectItem>
                        <SelectItem value="months">Months</SelectItem>
                        <SelectItem value="years">Years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Subscription category</Label>
                <Select
                  value={form.categoryId}
                  onValueChange={(value) => updateForm({ categoryId: value })}
                  disabled={!editor}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ledger.categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="subscription-renewal">Next renewal date</Label>
                <Input
                  id="subscription-renewal"
                  type="date"
                  value={form.nextRenewalDate}
                  disabled={!editor}
                  onChange={(event) => updateForm({ nextRenewalDate: event.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Tags className="size-4 text-muted-foreground" />
                Tags
              </div>
              {form.tags.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-card/50 px-3 py-3 text-center text-sm text-muted-foreground">
                  No tags
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {form.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      {editor ? (
                        <button
                          type="button"
                          aria-label={`Remove ${tag}`}
                          className="rounded-full hover:text-foreground"
                          onClick={() => removeTag(tag)}
                        >
                          <X className="size-3" />
                        </button>
                      ) : null}
                    </Badge>
                  ))}
                </div>
              )}
              {editor ? (
                <div className="grid gap-2">
                  <div className="flex gap-2">
                    <Input
                      value={form.tagDraft}
                      onChange={(event) => updateForm({ tagDraft: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addTag(form.tagDraft);
                        }
                      }}
                      placeholder="annual-review"
                    />
                    <Button type="button" variant="outline" onClick={() => addTag(form.tagDraft)}>
                      Add tag
                    </Button>
                  </div>
                  {availableTags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {availableTags.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => addTag(tag)}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="subscription-url">Manage URL</Label>
              <Input
                id="subscription-url"
                type="url"
                value={form.manageUrl}
                disabled={!editor}
                onChange={(event) => updateForm({ manageUrl: event.target.value })}
                placeholder="https://example.com/account"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="subscription-notes">Notes</Label>
              <textarea
                id="subscription-notes"
                value={form.notes}
                disabled={!editor}
                onChange={(event) => updateForm({ notes: event.target.value })}
                rows={3}
                className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Account notes"
              />
            </div>

            <label className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <span className="grid gap-0.5">
                <span className="text-sm font-medium text-foreground">Active</span>
                <span className="text-xs text-muted-foreground">
                  Turn off to keep it in the cancelled group.
                </span>
              </span>
              <Switch
                checked={form.active}
                disabled={!editor}
                onCheckedChange={(checked) => updateForm({ active: checked })}
              />
            </label>

            {error ? <div className="text-sm font-medium text-destructive">{error}</div> : null}
          </div>
        )}

        <DialogFooter showCloseButton={!editor}>
          {editor && state?.mode === 'edit' && subscription ? (
            <Button type="button" variant="outline" onClick={() => onDelete(subscription)}>
              <Trash2 className="size-4" />
              Delete subscription
            </Button>
          ) : null}
          {editor ? (
            <Button type="button" onClick={save}>
              {state?.mode === 'create' ? 'Add subscription' : 'Save subscription'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoryDialog({
  open,
  ledger,
  onOpenChange,
  onCreate,
  onRename,
  onDelete,
}: {
  open: boolean;
  ledger: SubscriptionLedger;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
  onRename: (category: SubscriptionCategory, name: string) => void;
  onDelete: (category: SubscriptionCategory) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDrafts(
      Object.fromEntries(ledger.categories.map((category) => [category.id, category.name])),
    );
    setNewCategory('');
    setError(null);
  }, [ledger.categories, open]);

  const categoryInUse = (categoryId: string) =>
    ledger.subscriptions.some((subscription) => subscription.categoryId === categoryId);

  const nameExists = (name: string, exceptId?: string) =>
    ledger.categories.some(
      (category) =>
        category.id !== exceptId && category.name.toLowerCase() === name.trim().toLowerCase(),
    );

  const addCategory = () => {
    const name = newCategory.trim();
    if (!name) {
      setError('Category name is required.');
      return;
    }
    if (nameExists(name)) {
      setError('Category name already exists.');
      return;
    }
    onCreate(name);
    setNewCategory('');
    setError(null);
  };

  const saveCategory = (category: SubscriptionCategory) => {
    const name = drafts[category.id]?.trim() ?? '';
    if (!name) {
      setError('Category name is required.');
      return;
    }
    if (nameExists(name, category.id)) {
      setError('Category name already exists.');
      return;
    }
    onRename(category, name);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage categories</DialogTitle>
          <DialogDescription>Add, rename, or delete subscription categories.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {ledger.categories.map((category) => (
            <div
              key={category.id}
              className="grid gap-2 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-[1fr_auto_auto]"
            >
              <Input
                value={drafts[category.id] ?? category.name}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, [category.id]: event.target.value }))
                }
                aria-label={`${category.name} name`}
              />
              <Button type="button" variant="outline" onClick={() => saveCategory(category)}>
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={category.id === OTHER_CATEGORY_ID}
                onClick={() => onDelete(category)}
                title={
                  categoryInUse(category.id)
                    ? 'Subscriptions will move to Other'
                    : category.id === OTHER_CATEGORY_ID
                      ? 'Other is required'
                      : undefined
                }
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            </div>
          ))}
          <div className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_auto]">
            <Input
              value={newCategory}
              onChange={(event) => {
                setNewCategory(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addCategory();
              }}
              placeholder="New category"
            />
            <Button type="button" onClick={addCategory}>
              <Plus className="size-4" />
              Add category
            </Button>
          </div>
          {error ? <div className="text-sm font-medium text-destructive">{error}</div> : null}
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function emptyForm(ledger: SubscriptionLedger): SubscriptionFormState {
  return {
    name: '',
    costUsd: '',
    intervalMode: 'monthly',
    intervalCount: '1',
    intervalUnit: 'months',
    categoryId: ledger.categories[0]?.id ?? OTHER_CATEGORY_ID,
    tags: [],
    tagDraft: '',
    nextRenewalDate: '',
    manageUrl: '',
    notes: '',
    active: true,
  };
}

function formFromSubscription(subscription: Subscription): SubscriptionFormState {
  const intervalMode =
    subscription.interval.count === 1 && subscription.interval.unit === 'months'
      ? 'monthly'
      : subscription.interval.count === 1 && subscription.interval.unit === 'years'
        ? 'yearly'
        : 'custom';
  return {
    name: subscription.name,
    costUsd: String(subscription.costUsd),
    intervalMode,
    intervalCount: String(subscription.interval.count),
    intervalUnit: subscription.interval.unit,
    categoryId: subscription.categoryId,
    tags: subscription.tags,
    tagDraft: '',
    nextRenewalDate: subscription.nextRenewalDate ?? '',
    manageUrl: subscription.manageUrl ?? '',
    notes: subscription.notes ?? '',
    active: subscription.active,
  };
}

function inputFromForm(form: SubscriptionFormState): SubscriptionInput {
  const interval =
    form.intervalMode === 'monthly'
      ? { count: 1, unit: 'months' as const }
      : form.intervalMode === 'yearly'
        ? { count: 1, unit: 'years' as const }
        : {
            count: Math.max(1, Math.floor(Number(form.intervalCount) || 1)),
            unit: form.intervalUnit,
          };

  return {
    name: form.name.trim(),
    costUsd: Math.round(Math.max(0, Number(form.costUsd) || 0) * 100) / 100,
    interval,
    categoryId: form.categoryId,
    tags: form.tags,
    nextRenewalDate: form.nextRenewalDate,
    manageUrl: form.manageUrl,
    notes: form.notes,
    active: form.active,
  };
}
