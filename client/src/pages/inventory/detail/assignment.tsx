import { MapPin, Tag } from 'lucide-react';

import {
  SPARE,
  type Component,
  type Deployment,
  type Machine,
  type Device,
} from '../../../lib/inventory';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { Field, Section, TextInput } from './primitives';

export function AssignmentSection({
  component,
  machines,
  onChange,
}: {
  component: Component;
  machines: Machine[];
  onChange: (mut: (c: Component) => Component) => void;
}) {
  return (
    <Section icon={MapPin} title="Assignment">
      <Field label="Installed in">
        <Select
          value={component.assignment}
          onValueChange={(v) => onChange((cur) => ({ ...cur, assignment: v }))}
        >
          <SelectTrigger size="sm" className="h-8 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SPARE}>Spare — not installed</SelectItem>
            {machines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
                {m.ids?.uid ? ` (${m.ids.uid})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </Section>
  );
}

const DEPLOYMENT_OPTIONS: { value: Deployment; label: string }[] = [
  { value: 'in-service', label: 'In service' },
  { value: 'spare', label: 'Spare' },
];

function DeploymentSelect({
  value,
  onChange,
}: {
  value: Deployment;
  onChange: (v: Deployment) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Deployment)}>
      <SelectTrigger size="sm" className="h-8 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DEPLOYMENT_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DeviceSection({
  item,
  isEditing,
  onChange,
}: {
  item: Device;
  isEditing: boolean;
  onChange: (mut: (it: Device) => Device) => void;
}) {
  return (
    <Section icon={Tag} title="Placement">
      {isEditing ? (
        <Field label="Name">
          <TextInput
            value={item.name}
            onChange={(v) => onChange((cur) => ({ ...cur, name: v || undefined }))}
            placeholder="Friendly name (optional)"
          />
        </Field>
      ) : item.name ? (
        <Field label="Name">
          <span className="text-sm text-foreground">{item.name}</span>
        </Field>
      ) : null}
      <Field label="Deployment">
        <DeploymentSelect
          value={item.deployment ?? 'spare'}
          onChange={(v) => onChange((cur) => ({ ...cur, deployment: v }))}
        />
      </Field>
    </Section>
  );
}
