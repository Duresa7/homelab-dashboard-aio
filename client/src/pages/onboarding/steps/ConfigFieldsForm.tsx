import type { ConfigField } from '@/lib/setup';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface Props {
  fields: ConfigField[];
  values: Record<string, unknown>;
  secrets?: Record<string, boolean>;
  idPrefix?: string;
  onChange: (field: string, value: unknown) => void;
}

function fieldValue(value: unknown): string {
  return value == null ? '' : String(value);
}

export function ConfigFieldsForm({
  fields,
  values,
  secrets = {},
  idPrefix = 'setup',
  onChange,
}: Props) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">No credentials are required.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;
        const help =
          field.secret && secrets[field.name]
            ? `${field.help ? `${field.help} ` : ''}Leave blank to keep the saved value.`
            : field.help;

        if (field.type === 'boolean') {
          return (
            <label
              key={field.name}
              className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-foreground">{field.label}</span>
                {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
              </span>
              <Switch
                checked={values[field.name] === true}
                onCheckedChange={(checked) => onChange(field.name, checked)}
              />
            </label>
          );
        }

        if (field.type === 'select') {
          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              <Label htmlFor={id}>
                {field.label}
                {field.required ? <span className="text-bad"> *</span> : null}
              </Label>
              <Select
                value={fieldValue(values[field.name])}
                onValueChange={(value) => onChange(field.name, value)}
              >
                <SelectTrigger id={id}>
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
            </div>
          );
        }

        return (
          <div key={field.name} className="flex flex-col gap-1.5">
            <Label htmlFor={id}>
              {field.label}
              {field.required ? <span className="text-bad"> *</span> : null}
            </Label>
            <Input
              id={id}
              type={
                field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'
              }
              inputMode={field.type === 'number' ? 'numeric' : undefined}
              value={fieldValue(values[field.name])}
              placeholder={field.secret && secrets[field.name] ? 'Saved' : undefined}
              onChange={(event) => {
                const next =
                  field.type === 'number' && event.target.value !== ''
                    ? Number(event.target.value)
                    : event.target.value;
                onChange(field.name, next);
              }}
            />
            {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
