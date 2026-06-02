import { Fragment, useMemo } from 'react';
import { RefreshCw, Server } from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { NAV_GROUPS } from './nav';
import { loadInventory } from '@/lib/inventory';
import { SECTION_LABEL, SUBS, type Section } from '@/lib/route';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setRoute: (section: Section, sub?: string, itemId?: string) => void;
}

/** ⌘K / Ctrl+K command palette — navigate every page + sub-page, run quick actions, jump to a machine. */
export function CommandMenu({ open, onOpenChange, setRoute }: Props) {
  // Re-read the inventory each time the palette opens so the machine list is fresh.
  const machines = useMemo(() => (open ? loadInventory().machines : []), [open]);

  const close = () => onOpenChange(false);
  const go = (section: Section, sub?: string, itemId?: string) => {
    setRoute(section, sub, itemId);
    close();
  };
  const run = (fn: () => void) => {
    fn();
    close();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Navigate, run actions, or jump to a machine"
    >
      <CommandInput placeholder="Search pages, actions, machines…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem
            value="refresh reload data"
            onSelect={() => run(() => window.location.reload())}
          >
            <RefreshCw className="size-4 text-muted-foreground" />
            <span>Refresh data</span>
          </CommandItem>
        </CommandGroup>

        {machines.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Machines">
              {machines.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`machine ${m.name} ${m.role ?? ''} ${m.id}`}
                  onSelect={() => go('inventory', undefined, m.id)}
                >
                  <Server className="size-4 text-muted-foreground" />
                  <span>{m.name}</span>
                  {m.role ? (
                    <span className="ml-auto truncate text-xs text-muted-foreground">{m.role}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {NAV_GROUPS.map((group, gi) => (
          <Fragment key={group.label ?? `g${gi}`}>
            <CommandSeparator />
            <CommandGroup heading={group.label ?? 'Home'}>
              {group.items.flatMap((it) => {
                const Icon = it.icon;
                const label = SECTION_LABEL[it.section];
                const subs = SUBS[it.section];
                return [
                  <CommandItem
                    key={it.section}
                    value={`${label} ${it.section}`}
                    onSelect={() => go(it.section)}
                  >
                    <Icon className="size-4 text-muted-foreground" />
                    <span>{label}</span>
                  </CommandItem>,
                  ...(subs ?? []).map((s) => (
                    <CommandItem
                      key={`${it.section}:${s.id}`}
                      value={`${label} ${s.label} ${it.section} ${s.id}`}
                      onSelect={() => go(it.section, s.id)}
                    >
                      <Icon className="size-4 opacity-40" />
                      <span className="text-muted-foreground">{label}</span>
                      <span className="opacity-40">/</span>
                      <span>{s.label}</span>
                    </CommandItem>
                  )),
                ];
              })}
            </CommandGroup>
          </Fragment>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
