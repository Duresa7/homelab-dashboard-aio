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
  secretSource?: 'db' | 'env';
  onSecretSourceChange?: (next: 'db' | 'env') => void;
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
  secretSource = 'db',
  onSecretSourceChange,
  idPrefix = 'setup',
  onChange,
}: Props) {
  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">No credentials are required.</p>;
  }

  const showSourceToggle = fields.some((field) => field.secret) && !!onSecretSourceChange;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {showSourceToggle ? (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`${idPrefix}-secret-source`}>Where to keep the secret</Label>
          <Select
            value={secretSource}
            onValueChange={(value) => onSecretSourceChange?.(value === 'env' ? 'env' : 'db')}
          >
            <SelectTrigger id={`${idPrefix}-secret-source`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="db">Encrypted in the app</SelectItem>
              <SelectItem value="env">Environment variable</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {secretSource === 'env'
              ? 'Set the variable(s) below in your .env or compose file and restart; nothing sensitive is stored in the app.'
              : 'The key is encrypted before it is written to the app database.'}
          </p>
        </div>
      ) : null}

      {fields.map((field) => {
        const id = `${idPrefix}-${field.name}`;

        if (field.secret && secretSource === 'env') {
          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              <Label>{field.label}</Label>
              <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Set <code className="font-mono text-foreground">{field.env ?? field.name}</code> in
                your <code className="font-mono">.env</code> or compose file, then restart.
              </div>
            </div>
          );
        }

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

        if (field.type === 'textarea') {
          return (
            <div key={field.name} className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={id}>
                {field.label}
                {field.required ? <span className="text-bad"> *</span> : null}
              </Label>
              <textarea
                id={id}
                value={fieldValue(values[field.name])}
                rows={5}
                className="min-h-28 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
                onChange={(event) => onChange(field.name, event.target.value)}
              />
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
