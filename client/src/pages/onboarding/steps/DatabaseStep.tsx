import type { DbDriver } from '@/lib/setup';
import { Button } from '@/components/ui/button';
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
import { StatusBadge } from '@/components/common';
import type { DbDraft, DbStepStatus } from '../db-state';

interface Props {
  draft: DbDraft;
  status: DbStepStatus;
  dirty: boolean;
  onChange: (draft: DbDraft) => void;
  onTest: () => void;
  onSave: () => void;
}

function numValue(value: number | undefined): string {
  return value == null ? '' : String(value);
}

export function DatabaseStep({ draft, status, dirty, onChange, onTest, onSave }: Props) {
  const updateDriver = (driver: DbDriver) => onChange({ ...draft, driver });
  const updateSqlite = (key: keyof DbDraft['sqlite'], value: string) =>
    onChange({ ...draft, sqlite: { ...draft.sqlite, [key]: value } });
  const updateServer = (
    driver: 'postgres' | 'mysql',
    key: keyof DbDraft['postgres'],
    value: string | number | boolean,
  ) => onChange({ ...draft, [driver]: { ...draft[driver], [key]: value } });
  const serverDriver: 'postgres' | 'mysql' = draft.driver === 'mysql' ? 'mysql' : 'postgres';
  const active = serverDriver === 'mysql' ? draft.mysql : draft.postgres;

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg tracking-tight">Database</h2>
            <p className="text-sm text-muted-foreground">
              SQLite is the default. Advanced backends are saved for the next server restart.
            </p>
          </div>
          {dirty ? <StatusBadge kind="warn">unsaved change</StatusBadge> : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-db-driver">Backend</Label>
            <Select value={draft.driver} onValueChange={(value) => updateDriver(value as DbDriver)}>
              <SelectTrigger id="setup-db-driver">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sqlite">SQLite</SelectItem>
                <SelectItem value="postgres">PostgreSQL</SelectItem>
                <SelectItem value="mysql">MySQL / MariaDB</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {draft.driver === 'sqlite' ? (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-background p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-db-state-path">State DB path</Label>
            <Input
              id="setup-db-state-path"
              value={draft.sqlite.statePath}
              placeholder="./data/dashboard.sqlite"
              onChange={(event) => updateSqlite('statePath', event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-db-siem-path">SIEM DB path</Label>
            <Input
              id="setup-db-siem-path"
              value={draft.sqlite.siemPath}
              placeholder="./data/siem.sqlite"
              onChange={(event) => updateSqlite('siemPath', event.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-background p-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-db-host">Host</Label>
            <Input
              id="setup-db-host"
              value={active.host}
              onChange={(event) => updateServer(serverDriver, 'host', event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-db-port">Port</Label>
            <Input
              id="setup-db-port"
              type="number"
              value={numValue(active.port)}
              onChange={(event) =>
                updateServer(
                  serverDriver,
                  'port',
                  event.target.value ? Number(event.target.value) : '',
                )
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-db-name">Database</Label>
            <Input
              id="setup-db-name"
              value={active.database}
              onChange={(event) => updateServer(serverDriver, 'database', event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-db-user">User</Label>
            <Input
              id="setup-db-user"
              value={active.user}
              onChange={(event) => updateServer(serverDriver, 'user', event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="setup-db-password">Password</Label>
            <Input
              id="setup-db-password"
              type="password"
              value={active.password}
              placeholder={active.hasPassword ? 'Saved' : undefined}
              onChange={(event) => updateServer(serverDriver, 'password', event.target.value)}
            />
            {active.hasPassword ? (
              <p className="text-xs text-muted-foreground">
                Leave blank to keep the saved password.
              </p>
            ) : null}
          </div>
          {draft.driver === 'postgres' ? (
            <label className="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
              <span className="text-sm font-medium text-foreground">SSL</span>
              <Switch
                checked={draft.postgres.ssl === true}
                onCheckedChange={(checked) => updateServer('postgres', 'ssl', checked)}
              />
            </label>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Connection check</span>
          <span className="text-sm text-muted-foreground">{status.message}</span>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={status.busy} onClick={onTest}>
            Test
          </Button>
          <Button type="button" disabled={status.busy || !dirty} onClick={onSave}>
            Save database
          </Button>
        </div>
      </div>

      {status.restartRequired ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-foreground">
          Database settings were saved. Restart the server to apply this backend.
        </div>
      ) : null}
    </div>
  );
}
