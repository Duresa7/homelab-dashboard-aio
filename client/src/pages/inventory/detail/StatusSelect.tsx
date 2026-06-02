import type { ItemStatus } from '../../../lib/inventory';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { STATUS_ICON, STATUS_KIND, STATUS_OPTIONS, TONE_TEXT } from './primitives';

export function StatusSelect({
  status,
  onChange,
}: {
  status: ItemStatus;
  onChange: (s: ItemStatus) => void;
}) {
  const kind = STATUS_KIND[status];
  const Glyph = STATUS_ICON[status];
  return (
    <Select value={status} onValueChange={(v) => onChange(v as ItemStatus)}>
      <SelectTrigger
        size="sm"
        aria-label="Change status"
        className={cn(
          'h-8 w-auto gap-1.5 rounded-full border-border bg-muted/50 px-3 text-xs font-medium lowercase',
          TONE_TEXT[kind],
        )}
      >
        <Glyph size={13} strokeWidth={2} />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((o) => {
          const OptGlyph = STATUS_ICON[o.value];
          return (
            <SelectItem key={o.value} value={o.value}>
              <span className={cn('flex items-center gap-1.5', TONE_TEXT[STATUS_KIND[o.value]])}>
                <OptGlyph size={13} strokeWidth={2} />
                {o.label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
