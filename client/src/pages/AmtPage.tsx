import { Cpu } from 'lucide-react';
import { SubTabs, SummaryBar } from '@/components/common';
import { AmtDeviceCard } from '@/components/amt/AmtDeviceCard';
import { AmtDeviceForm } from '@/components/amt/AmtDeviceForm';
import { useTelemetryState } from '@/lib/telemetry';
import type { DashboardState } from '../types';

interface Props {
  data: DashboardState;
  sub: string;
  onSelectSub: (sub: string) => void;
}

const AMT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'devices', label: 'Devices' },
];

function DisabledState() {
  return (
    <div className="col-span-12 flex min-h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <Cpu className="size-6 text-muted-foreground" />
      <div className="text-sm font-semibold text-foreground">Intel AMT is disabled</div>
      <div className="max-w-sm text-sm text-muted-foreground">
        Enable the Intel AMT integration under Settings → Integrations to manage devices and view
        power state.
      </div>
    </div>
  );
}

function EmptyState({ onSelectSub }: { onSelectSub: (sub: string) => void }) {
  return (
    <div className="col-span-12 flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <Cpu className="size-6 text-muted-foreground" />
      <div className="text-sm font-semibold text-foreground">No AMT devices yet</div>
      <div className="max-w-sm text-sm text-muted-foreground">
        Add your first AMT device to monitor power state and control it remotely.
      </div>
      <button
        type="button"
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        onClick={() => onSelectSub('devices')}
      >
        Add your first AMT device
      </button>
    </div>
  );
}

function Overview({
  data,
  onSelectSub,
}: {
  data: DashboardState;
  onSelectSub: (sub: string) => void;
}) {
  const amt = data.amt;

  if (amt.total === 0) {
    return <EmptyState onSelectSub={onSelectSub} />;
  }

  return (
    <>
      <SummaryBar
        stats={[
          { key: 'total', label: 'Devices', value: amt.total },
          { key: 'online', label: 'Online', value: amt.online, tone: 'ok' },
          { key: 'offline', label: 'Offline', value: amt.offline, tone: 'bad' },
          { key: 'unreachable', label: 'Unreachable', value: amt.unreachable, tone: 'default' },
        ]}
      />
      <div className="col-span-12 grid grid-cols-1 gap-[var(--gap)] md:grid-cols-2 lg:grid-cols-3">
        {amt.devices.map((device) => (
          <AmtDeviceCard key={device.id} device={device} />
        ))}
      </div>
    </>
  );
}

export function AmtPage({ data, sub, onSelectSub }: Props) {
  const disabled = useTelemetryState().amt.status === 'disabled';

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SubTabs tabs={AMT_TABS} active={sub} onChange={onSelectSub} />
      {disabled ? (
        <DisabledState />
      ) : sub === 'devices' ? (
        <AmtDeviceForm />
      ) : (
        <Overview data={data} onSelectSub={onSelectSub} />
      )}
    </div>
  );
}
