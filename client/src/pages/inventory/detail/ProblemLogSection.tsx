import { useState } from 'react';
import { Plus, Wrench, X } from 'lucide-react';

import type { ItemStatus, ProblemLogEntry } from '../../../lib/inventory';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { Section, today } from './primitives';

interface ProblemLogProps {
  log: ProblemLogEntry[];
  status: ItemStatus;
  onAdd: (note: string, date: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<ProblemLogEntry, 'date' | 'note'>>) => void;
  onRemove: (id: string) => void;
}

export function ProblemLogSection({ log, status, onAdd, onUpdate, onRemove }: ProblemLogProps) {
  const allowAdd = status === 'broken' || status === 'in-repair';
  if (!allowAdd && log.length === 0) return null;

  const accent = status === 'broken' ? 'bad' : status === 'in-repair' ? 'warn' : undefined;

  return (
    <Section
      icon={Wrench}
      title="Problem log"
      count={log.length}
      accent={accent}
      className="md:col-span-2"
    >
      <ul className="flex flex-col gap-2">
        {log.length === 0 ? (
          <li className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            No entries yet — describe the issue below.
          </li>
        ) : null}
        {log.map((entry) => (
          <li
            key={entry.id}
            className="flex items-start gap-2 rounded-md border border-border/60 bg-card p-2"
          >
            <Input
              type="date"
              className="h-8 w-auto shrink-0 font-mono text-[13px]"
              value={entry.date}
              onChange={(e) => onUpdate(entry.id, { date: e.target.value })}
            />
            <textarea
              className="min-h-8 flex-1 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              value={entry.note}
              rows={2}
              onChange={(e) => onUpdate(entry.id, { note: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-bad"
              onClick={() => onRemove(entry.id)}
              title="Remove entry"
            >
              <X size={13} strokeWidth={2} />
            </Button>
          </li>
        ))}
      </ul>
      {allowAdd ? <AddLogEntry onAdd={onAdd} /> : null}
    </Section>
  );
}

function AddLogEntry({ onAdd }: { onAdd: (note: string, date: string) => void }) {
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const submit = () => {
    if (!note.trim()) return;
    onAdd(note, date);
    setNote('');
    setDate(today());
  };
  return (
    <div className="mt-1 flex items-start gap-2 rounded-md border border-dashed border-border p-2">
      <Input
        type="date"
        className="h-8 w-auto shrink-0 font-mono text-[13px]"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <textarea
        className="min-h-8 flex-1 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        placeholder="Symptoms, repair notes, next steps…"
        value={note}
        rows={2}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button
        type="button"
        size="sm"
        className="shrink-0 gap-1"
        onClick={submit}
        disabled={!note.trim()}
        title="Add entry (Ctrl/Cmd+Enter)"
      >
        <Plus size={13} strokeWidth={2} /> log
      </Button>
    </div>
  );
}
