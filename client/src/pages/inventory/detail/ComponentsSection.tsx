import { Boxes, Cpu } from 'lucide-react';

import { imageUrl } from '../../../lib/images';
import { componentTitle, type Component, type Machine } from '../../../lib/inventory';
import { componentIcon, InventoryIcon } from '../../../lib/inventoryIcons';

import { Section, STATUS_KIND } from './primitives';

export function ComponentsSection({
  machine,
  components,
}: {
  machine: Machine;
  components: Component[];
}) {
  const installed = components.filter((c) => c.assignment === machine.id);
  return (
    <Section icon={Boxes} title="Components" count={installed.length} className="md:col-span-2">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {installed.map((c) => {
          const CompIcon = componentIcon(c.label) ?? Cpu;
          return (
            <div
              key={c.id}
              className="flex items-start gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2"
            >
              <span className="flex w-24 shrink-0 items-center gap-1.5 pt-0.5 text-xs font-medium text-muted-foreground">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: `var(--${STATUS_KIND[c.status ?? 'working']})` }}
                  title={c.status ?? 'working'}
                  aria-hidden
                />
                <CompIcon size={12} strokeWidth={1.75} />
                <span className="truncate">{c.label}</span>
              </span>
              <InventoryIcon
                icon={c.icon}
                brandText={[componentTitle(c), c.rawSpec]}
                fallback={CompIcon}
                label={componentTitle(c)}
                size={14}
                reserveSpace
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">{componentTitle(c)}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {c.ids?.uid ?? ''}
                </div>
              </div>
              {c.images?.[0] ? (
                <img
                  src={imageUrl(c.images[0].id, true)}
                  alt={`${componentTitle(c)} photo`}
                  loading="lazy"
                  className="size-8 shrink-0 rounded-md border border-border object-cover"
                />
              ) : null}
            </div>
          );
        })}
        {installed.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            No components assigned to this machine.
          </span>
        ) : null}
      </div>
    </Section>
  );
}
