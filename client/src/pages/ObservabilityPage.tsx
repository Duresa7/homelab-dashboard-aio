import { SubTabs } from '@/components/common';
import { useCapabilityPresentation } from '@/lib/presentation';
import type { AlertEntry, DashboardState } from '../types';
import type { IntegrationKey } from '../lib/telemetry';
import { AlertsPage } from './AlertsPage';
import { EventsPage } from './EventsPage';
import { HealthPage } from './HealthPage';
import { SiemPage } from './SiemPage';

interface Props {
  data: DashboardState;
  integrations: Record<IntegrationKey, boolean>;
  alerts: AlertEntry[];
  onDismissAlert: (i: number) => void;
  sub: string;
  onSelectSub: (sub: string) => void;
}

export function ObservabilityPage({
  data,
  integrations,
  alerts,
  onDismissAlert,
  sub,
  onSelectSub,
}: Props) {
  const logs = useCapabilityPresentation('logs');

  const tabs = [
    { id: 'alerts', label: alerts.length ? `Alerts · ${alerts.length}` : 'Alerts' },
    { id: 'events', label: 'Events' },
    ...(logs?.enabled ? [{ id: 'siem', label: 'SIEM' }] : []),
    { id: 'health', label: 'API Health' },
  ];
  const active = tabs.some((t) => t.id === sub) ? sub : 'alerts';

  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SubTabs tabs={tabs} active={active} onChange={onSelectSub} />
      <div className="col-span-12">
        {active === 'alerts' && <AlertsPage alerts={alerts} onDismiss={onDismissAlert} />}
        {active === 'events' && <EventsPage data={data} />}
        {active === 'siem' && <SiemPage />}
        {active === 'health' && <HealthPage integrations={integrations} />}
      </div>
    </div>
  );
}
