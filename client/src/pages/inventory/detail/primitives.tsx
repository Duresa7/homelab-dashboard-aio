import { useEffect, useState } from 'react';
import { CheckCircle2, CircleSlash, Tag, Wrench, type LucideIcon } from 'lucide-react';

import type { ItemStatus } from '../../../lib/inventory';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export const STATUS_OPTIONS: { value: ItemStatus; label: string }[] = [
  { value: 'working', label: 'working' },
  { value: 'broken', label: 'broken' },
  { value: 'in-repair', label: 'in-repair' },
  { value: 'retired', label: 'retired' },
];

export const STATUS_ICON: Record<ItemStatus, LucideIcon> = {
  working: CheckCircle2,
  broken: CircleSlash,
  'in-repair': Wrench,
  retired: Tag,
};

export const STATUS_KIND: Record<ItemStatus, 'ok' | 'bad' | 'warn' | 'idle'> = {
  working: 'ok',
  broken: 'bad',
  'in-repair': 'warn',
  retired: 'idle',
};

export const TONE_TEXT: Record<'ok' | 'bad' | 'warn' | 'idle', string> = {
  ok: 'text-ok',
  bad: 'text-bad',
  warn: 'text-warn',
  idle: 'text-idle',
};

export function Section({
  icon: Icon,
  title,
  count,
  accent,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  count?: number;
  accent?: 'bad' | 'warn';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-xl border border-border bg-muted/30 p-4',
        accent === 'bad' && 'border-l-2 border-l-bad',
        accent === 'warn' && 'border-l-2 border-l-warn',
        className,
      )}
    >
      <h3 className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold tracking-wide text-muted-foreground">
        <Icon size={14} strokeWidth={1.75} />
        <span>{title}</span>
        {count != null ? (
          <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </h3>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  );
}

export function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-center gap-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon ? <Icon size={12} strokeWidth={1.75} /> : null}
        <span>{label}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function DetailField({
  label,
  icon,
  value,
  editing,
  input,
  mono,
}: {
  label: string;
  icon?: LucideIcon;
  value?: string;
  editing: boolean;
  input: React.ReactNode;
  mono?: boolean;
}) {
  if (editing)
    return (
      <Field label={label} icon={icon}>
        {input}
      </Field>
    );
  if (!value || !value.trim()) return null;
  return (
    <Field label={label} icon={icon}>
      <span className={cn('text-sm text-foreground', mono && 'font-mono text-[13px]')}>
        {value}
      </span>
    </Field>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value ?? '');
  }, [value, focused]);
  return (
    <Input
      type="text"
      className={cn('h-8', mono && 'font-mono text-[13px]')}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (draft !== (value ?? '')) onChange(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function DateInput({
  value,
  onChange,
  hint,
}: {
  value?: string;
  onChange: (v: string) => void;
  hint?: { text: string; kind: 'ok' | 'warn' | 'bad' | 'idle' } | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        className="h-8 w-auto font-mono text-[13px]"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span className={cn('text-xs', TONE_TEXT[hint.kind])}>{hint.text}</span> : null}
    </div>
  );
}

export function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function warrantyHint(
  warrantyEnd?: string,
): { text: string; kind: 'ok' | 'warn' | 'bad' | 'idle' } | null {
  if (!warrantyEnd) return null;
  const end = Date.parse(warrantyEnd);
  if (Number.isNaN(end)) return null;
  const now = Date.now();
  const days = Math.round((end - now) / 86_400_000);
  if (days < 0) return { text: `expired ${Math.abs(days)}d ago`, kind: 'bad' };
  if (days <= 30) return { text: `${days}d left`, kind: 'warn' };
  if (days <= 90) return { text: `${days}d left`, kind: 'ok' };
  return { text: `${days}d left`, kind: 'idle' };
}
