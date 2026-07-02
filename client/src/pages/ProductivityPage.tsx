import { SubTabs } from '@/components/common';
import { KanbanBoardSection } from '@/components/productivity/KanbanBoard';

interface Props {
  sub: string;
  onSelectSub: (sub: string) => void;
}

const PRODUCTIVITY_TABS = [{ id: 'kanban', label: 'Kanban' }];

export function ProductivityPage({ sub, onSelectSub }: Props) {
  return (
    <div className="grid grid-cols-12 gap-[var(--gap)]">
      <SubTabs tabs={PRODUCTIVITY_TABS} active={sub} onChange={onSelectSub} />
      <KanbanBoardSection />
    </div>
  );
}
