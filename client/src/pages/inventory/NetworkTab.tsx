import type { Inventory, SpareCategory } from '../../lib/inventory';

import { CategoryBlock } from './CategoryBlock';
import { EmptyState, matchItem } from './shared';

interface DeviceTabProps {
  inv: Inventory;
  isEditing: boolean;
  query: string;
  updateCategory: (id: string, mut: (c: SpareCategory) => SpareCategory) => void;
  deleteCategory: (id: string) => void;
  addCategory: () => void;
  onOpenItem: (id: string) => void;
  openItemId?: string;
}

export function NetworkTab({
  inv,
  isEditing,
  query,
  updateCategory,
  deleteCategory,
  onOpenItem,
  openItemId,
}: DeviceTabProps) {
  const cats = inv.spares
    .map((cat) => ({
      cat,
      items: cat.items.filter(
        (it) => (it.deployment ?? 'spare') === 'in-service' && matchItem(it, query),
      ),
    }))
    .filter(
      (g) =>
        g.items.length > 0 ||
        (isEditing && (g.cat.deviceType === 'network' || g.cat.deviceType === 'camera')),
    );

  if (cats.length === 0) {
    return (
      <EmptyState>
        {query
          ? 'No deployed network devices match the search.'
          : 'No deployed network devices yet.'}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {cats.map((g) => (
        <CategoryBlock
          key={g.cat.id}
          category={g.cat}
          items={g.items}
          deployment="in-service"
          isEditing={isEditing}
          onChange={(mut) => updateCategory(g.cat.id, mut)}
          onDelete={() => deleteCategory(g.cat.id)}
          onOpenItem={onOpenItem}
          openItemId={openItemId}
        />
      ))}
    </div>
  );
}
