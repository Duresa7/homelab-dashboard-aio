import { SubTabs } from '@/components/common';
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

export function AmtPage({ sub, onSelectSub }: Props) {
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SubTabs tabs={AMT_TABS} active={sub} onChange={onSelectSub} />
      <div className="col-span-12 grid place-items-center py-24 text-sm text-muted-foreground">
        AMT — Coming soon
      </div>
    </div>
  );
}
