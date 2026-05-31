import { Fragment } from 'react';
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
import { SECTION_LABEL, SUBS, type Section } from '@/lib/route';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setRoute: (section: Section, sub?: string) => void;
}

/** ⌘K / Ctrl+K command palette for fast navigation across every page + sub-page. */
export function CommandMenu({ open, onOpenChange, setRoute }: Props) {
  const go = (section: Section, sub?: string) => {
    setRoute(section, sub);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Navigate" description="Jump to any page">
      <CommandInput placeholder="Search pages and views…" />
      <CommandList>
        <CommandEmpty>No matching pages.</CommandEmpty>
        {NAV_GROUPS.map((group, gi) => (
          <Fragment key={group.label ?? `g${gi}`}>
            {gi > 0 && <CommandSeparator />}
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
