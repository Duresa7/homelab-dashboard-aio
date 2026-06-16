import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Power,
  PowerOff,
  RotateCcw,
  Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { canEdit, useAuth } from '@/lib/auth';
import { formatSince } from '@/lib/format';
import { apiJson, jsonRequest } from '@/lib/http';
import { cn } from '@/lib/utils';
import type { AmtDeviceStatus, AmtPowerAction, AmtPowerState } from '../../types';
import { AmtHardwareDetail } from './AmtHardwareDetail';

interface Props {
  device: AmtDeviceStatus;
}

/** Explicit badge colours per the AMT spec — not the shared status tokens. */
const POWER_BADGE: Record<AmtPowerState, { dot: string; label: string }> = {
  on: { dot: 'bg-emerald-500', label: 'on' },
  off: { dot: 'bg-red-500', label: 'off' },
  sleep: { dot: 'bg-blue-500', label: 'sleep' },
  hibernate: { dot: 'bg-blue-500', label: 'hibernate' },
  unknown: { dot: 'bg-zinc-500', label: 'unknown' },
};

interface PowerControl {
  action: AmtPowerAction;
  label: string;
  icon: React.ReactNode;
  /** Power states for which this control is redundant and should be disabled. */
  disabledFor: AmtPowerState[];
}

const CONTROLS: PowerControl[] = [
  { action: 'on', label: 'Power On', icon: <Power className="size-4" />, disabledFor: ['on'] },
  {
    action: 'off',
    label: 'Power Off',
    icon: <PowerOff className="size-4" />,
    disabledFor: ['off'],
  },
  { action: 'reset', label: 'Reset', icon: <RotateCcw className="size-4" />, disabledFor: ['off'] },
  {
    action: 'shutdown',
    label: 'Shutdown',
    icon: <Square className="size-4" />,
    disabledFor: ['off'],
  },
];

export function AmtDeviceCard({ device }: Props) {
  const [busyAction, setBusyAction] = useState<AmtPowerAction | null>(null);
  const [expanded, setExpanded] = useState(false);
  const editor = canEdit(useAuth().user);

  const badge = POWER_BADGE[device.powerState] ?? POWER_BADGE.unknown;
  const offline = !device.reachable;

  const onPower = async (action: AmtPowerAction, label: string) => {
    setBusyAction(action);
    try {
      await apiJson('/api/amt/power', jsonRequest('POST', { deviceId: device.id, action }));
      toast.success(`${label} sent to ${device.name}`);
    } catch (err) {
      toast.error(`${label} failed for ${device.name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const hw = device.hardware;

  return (
    <section
      className={cn(
        'flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-[var(--pad)] shadow-card',
        offline && 'opacity-70',
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{device.name}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">{device.host}</div>
        </div>
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium lowercase text-foreground"
          title={offline ? 'unreachable' : `power: ${badge.label}`}
        >
          <span className={cn('size-1.5 rounded-full', offline ? 'bg-zinc-500' : badge.dot)} />
          {offline ? 'unreachable' : badge.label}
        </span>
      </header>

      {offline && device.error ? (
        <div className="flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] px-3 py-2 text-xs text-[var(--bad)]">
          <AlertTriangle className="size-3.5 shrink-0 translate-y-0.5" />
          <span className="min-w-0">{device.error}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {CONTROLS.map((ctrl) => {
          // When unreachable the live power state is unknown, so don't block any
          // action — the user may legitimately want to try powering it on.
          const stateBlocked = !offline && ctrl.disabledFor.includes(device.powerState);
          const disabled = !editor || busyAction != null || stateBlocked;
          return (
            <Button
              key={ctrl.action}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => void onPower(ctrl.action, ctrl.label)}
            >
              {ctrl.icon}
              {busyAction === ctrl.action ? 'Working…' : ctrl.label}
            </Button>
          );
        })}
      </div>

      <div className="grid gap-1 border-t border-border pt-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">CPU</span>
          <span className="min-w-0 truncate text-right font-medium text-foreground">
            {hw?.cpu ? `${hw.cpu.model}${hw.cpu.cores ? ` · ${hw.cpu.cores} cores` : ''}` : '—'}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">RAM</span>
          <span className="font-medium text-foreground tabular-nums">
            {hw?.memory?.totalMB ? `${hw.memory.totalMB} MB` : '—'}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">AMT</span>
          <span className="font-medium text-foreground tabular-nums">{hw?.amtVersion ?? '—'}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          {device.lastSeenAt ? `Last seen ${formatSince(device.lastSeenAt)}` : 'Never reached'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          {expanded ? 'Hide details' : 'Hardware'}
        </Button>
      </div>

      {expanded ? <AmtHardwareDetail deviceId={device.id} fallback={hw} /> : null}
    </section>
  );
}
