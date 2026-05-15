import { EventsTile } from '../components/widgets';
import type { DashboardState } from '../types';

interface Props {
  data: DashboardState;
}

export function EventsPage({ data }: Props) {
  return (
    <div className="grid">
      <EventsTile data={data.events} span={12} expandable={false} />
    </div>
  );
}
