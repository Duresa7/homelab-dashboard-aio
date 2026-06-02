import { Plus, Settings2, X } from 'lucide-react';

import {
  COMPONENT_TYPE_LABELS,
  genId,
  type Component,
  type ComponentType,
  type SpareCategory,
  type SpareItem,
  type SpecField,
} from '../../../lib/inventory';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Field, Section, TextInput } from './primitives';

const TYPE_OPTIONS = Object.entries(COMPONENT_TYPE_LABELS) as [ComponentType, string][];

export function ComponentSpecsSection({
  component,
  isEditing,
  onChange,
}: {
  component: Component;
  isEditing: boolean;
  onChange: (mut: (c: Component) => Component) => void;
}) {
  const setField = (fid: string, key: 'label' | 'value', v: string) =>
    onChange((cur) => ({
      ...cur,
      fields: cur.fields.map((f) => (f.id === fid ? { ...f, [key]: v } : f)),
    }));
  const addField = () =>
    onChange((cur) => ({
      ...cur,
      fields: [...cur.fields, { id: genId('f'), label: 'Label', value: '' }],
    }));
  const removeField = (fid: string) =>
    onChange((cur) => ({ ...cur, fields: cur.fields.filter((f) => f.id !== fid) }));
  const setType = (t: ComponentType) => onChange((cur) => ({ ...cur, type: t }));

  const visible: SpecField[] = isEditing
    ? component.fields
    : component.fields.filter((f) => f.value && f.value.trim());

  return (
    <Section icon={Settings2} title="Specifications">
      {isEditing ? (
        <Field label="Type">
          <Select value={component.type} onValueChange={(v) => setType(v as ComponentType)}>
            <SelectTrigger size="sm" className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {visible.map((f) =>
        isEditing ? (
          <div key={f.id} className="grid grid-cols-[104px_1fr_auto] items-center gap-2">
            <Input
              className="h-8 text-xs"
              value={f.label}
              onChange={(e) => setField(f.id, 'label', e.target.value)}
              placeholder="Label"
            />
            <Input
              className="h-8"
              value={f.value}
              onChange={(e) => setField(f.id, 'value', e.target.value)}
              placeholder="Value"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-bad"
              onClick={() => removeField(f.id)}
              title="Remove field"
            >
              <X size={13} strokeWidth={2} />
            </Button>
          </div>
        ) : (
          <Field key={f.id} label={f.label}>
            <span className="text-sm text-foreground">{f.value}</span>
          </Field>
        ),
      )}

      {isEditing ? (
        <button
          type="button"
          className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-brand"
          onClick={addField}
        >
          <Plus size={12} strokeWidth={2} /> field
        </button>
      ) : null}
      {!isEditing && visible.length === 0 ? (
        <span className="text-sm text-muted-foreground">No specs recorded.</span>
      ) : null}
    </Section>
  );
}

export function SpareSpecsSection({
  item,
  category,
  isEditing,
  onChange,
}: {
  item: SpareItem;
  category: SpareCategory;
  isEditing: boolean;
  onChange: (mut: (it: SpareItem) => SpareItem) => void;
}) {
  const onValue = (colId: string, v: string) =>
    onChange((cur) => ({ ...cur, values: { ...cur.values, [colId]: v } }));
  const cols = category.columns.filter(
    (c) => isEditing || (item.values[c.id] && item.values[c.id].trim()),
  );
  if (cols.length === 0) return null;
  return (
    <Section icon={Settings2} title="Specifications">
      {cols.map((col) => {
        const isFeatures = /^notes$/i.test(col.id) || /^notes$/i.test(col.label);
        const label = isFeatures ? 'Features' : col.label;
        return (
          <Field key={col.id} label={label}>
            {isEditing ? (
              <TextInput
                value={item.values[col.id]}
                onChange={(v) => onValue(col.id, v)}
                placeholder={label}
              />
            ) : (
              <span className="text-sm text-foreground">{item.values[col.id]}</span>
            )}
          </Field>
        );
      })}
    </Section>
  );
}
