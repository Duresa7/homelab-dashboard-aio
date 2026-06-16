import { useEffect, useState } from 'react';
import { AlertTriangle, Cpu, HardDrive, MemoryStick, Network, ShieldCheck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { apiJson } from '@/lib/http';
import { cn } from '@/lib/utils';
import type { AmtDeviceHardware } from '../../types';

interface Props {
  deviceId: string;
  /** Hardware already present in the telemetry poll, shown until the on-demand
   * inventory fetch resolves. */
  fallback?: AmtDeviceHardware | null;
}

interface InventoryResponse {
  inventory: AmtDeviceHardware;
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <span className="[&_svg]:size-3.5">{icon}</span>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-foreground tabular-nums">
        {value}
      </span>
    </div>
  );
}

function dash(value: string | number | null | undefined): React.ReactNode {
  if (value == null || value === '' || value === 0)
    return <span className="text-muted-foreground">—</span>;
  return value;
}

export function AmtHardwareDetail({ deviceId, fallback }: Props) {
  const [inventory, setInventory] = useState<AmtDeviceHardware | null>(fallback ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiJson<InventoryResponse>(`/api/amt/devices/${deviceId}/inventory`)
      .then((res) => {
        if (!cancelled) setInventory(res.inventory);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  if (loading && !inventory) {
    return (
      <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }

  if (error && !inventory) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[color-mix(in_oklab,var(--bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] px-3 py-2 text-sm text-[var(--bad)]">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="min-w-0">Could not load inventory: {error}</span>
      </div>
    );
  }

  if (!inventory) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">
        No hardware inventory available.
      </div>
    );
  }

  const { cpu, memory, bios, nics, amtVersion } = inventory;

  return (
    <div
      className={cn(
        'grid gap-4 rounded-lg border border-border bg-muted/20 p-3',
        loading && 'opacity-70',
      )}
    >
      <Section icon={<Cpu />} title="CPU">
        {cpu ? (
          <div className="grid gap-1">
            <Row label="Model" value={dash(cpu.model)} />
            <Row label="Cores" value={dash(cpu.cores)} />
            <Row
              label="Max speed"
              value={cpu.maxSpeedMHz ? `${cpu.maxSpeedMHz} MHz` : dash(null)}
            />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Not reported.</span>
        )}
      </Section>

      <Section icon={<MemoryStick />} title="Memory">
        {memory ? (
          <div className="grid gap-2">
            <Row label="Total" value={memory.totalMB ? `${memory.totalMB} MB` : dash(null)} />
            {memory.slots.length > 0 ? (
              <div className="overflow-hidden rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Size</th>
                      <th className="px-2 py-1 text-left font-medium">Speed</th>
                      <th className="px-2 py-1 text-left font-medium">Type</th>
                      <th className="px-2 py-1 text-left font-medium">Vendor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memory.slots.map((slot, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-2 py-1 tabular-nums">
                          {slot.sizeMB ? `${slot.sizeMB} MB` : '—'}
                        </td>
                        <td className="px-2 py-1 tabular-nums">
                          {slot.speedMHz ? `${slot.speedMHz} MHz` : '—'}
                        </td>
                        <td className="px-2 py-1">{slot.type || '—'}</td>
                        <td className="px-2 py-1">{slot.manufacturer || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Not reported.</span>
        )}
      </Section>

      <Section icon={<HardDrive />} title="BIOS">
        {bios ? (
          <div className="grid gap-1">
            <Row label="Vendor" value={dash(bios.vendor)} />
            <Row label="Version" value={dash(bios.version)} />
            <Row label="Date" value={dash(bios.date)} />
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Not reported.</span>
        )}
      </Section>

      <Section icon={<Network />} title="Network">
        {nics.length > 0 ? (
          <div className="grid gap-1">
            {nics.map((nic, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-mono text-xs text-foreground">{nic.mac || '—'}</span>
                <span
                  className={cn(
                    'text-xs font-medium',
                    nic.linkStatus === 'up'
                      ? 'text-ok'
                      : nic.linkStatus === 'down'
                        ? 'text-bad'
                        : 'text-muted-foreground',
                  )}
                >
                  {nic.linkStatus}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">No interfaces reported.</span>
        )}
      </Section>

      <Section icon={<ShieldCheck />} title="AMT">
        <Row label="Firmware" value={dash(amtVersion)} />
      </Section>
    </div>
  );
}
