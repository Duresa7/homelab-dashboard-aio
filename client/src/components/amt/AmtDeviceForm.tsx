import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Server, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canEdit, useAuth } from '@/lib/auth';
import { apiJson, jsonRequest } from '@/lib/http';

const DEFAULT_PORT = 16993;
const DEFAULT_USERNAME = 'admin';

/** Device shape returned by `GET /api/amt/devices` (password redacted). */
interface AmtDevicePublic {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  useTls: boolean;
}

interface DeviceListResponse {
  devices: AmtDevicePublic[];
}

interface FormState {
  id: string | null;
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
  useTls: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  host: '',
  port: '',
  username: '',
  password: '',
  useTls: true,
};

interface RequestPayload {
  name: string;
  host: string;
  password: string;
  port?: number;
  username?: string;
  useTls: boolean;
}

function buildPayload(form: FormState): { payload: RequestPayload | null; error: string | null } {
  const name = form.name.trim();
  const host = form.host.trim();
  if (!name) return { payload: null, error: 'Name is required.' };
  if (!host) return { payload: null, error: 'Host is required.' };
  // The server requires a password on every write, including edits.
  if (!form.password) return { payload: null, error: 'Password is required.' };

  let port: number | undefined;
  const trimmedPort = form.port.trim();
  if (trimmedPort) {
    const parsed = Number(trimmedPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return { payload: null, error: 'Port must be an integer from 1 to 65535.' };
    }
    port = parsed;
  }

  const username = form.username.trim();
  return {
    payload: {
      name,
      host,
      password: form.password,
      ...(port != null ? { port } : {}),
      ...(username ? { username } : {}),
      useTls: form.useTls,
    },
    error: null,
  };
}

export function AmtDeviceForm() {
  const [devices, setDevices] = useState<AmtDevicePublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AmtDevicePublic | null>(null);
  const [deleting, setDeleting] = useState(false);

  const editor = canEdit(useAuth().user);
  const editing = form.id != null;

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiJson<DeviceListResponse>('/api/amt/devices');
      setDevices(res.devices);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setError(null);
  };

  const onEdit = (device: AmtDevicePublic) => {
    setForm({
      id: device.id,
      name: device.name,
      host: device.host,
      port: device.port ? String(device.port) : '',
      username: device.username ?? '',
      password: '',
      useTls: device.useTls,
    });
    setError(null);
  };

  const onSave = async () => {
    const { payload, error: validationError } = buildPayload(form);
    if (!payload) {
      setError(validationError);
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await apiJson(`/api/amt/devices/${form.id}`, jsonRequest('PUT', payload));
        toast.success(`Updated ${payload.name}`);
      } else {
        await apiJson('/api/amt/devices', jsonRequest('POST', payload));
        toast.success(`Added ${payload.name}`);
      }
      resetForm();
      await loadDevices();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error(editing ? 'Could not update device' : 'Could not add device', {
        description: message,
      });
    } finally {
      setSaving(false);
    }
  };

  const onConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await apiJson(`/api/amt/devices/${pendingDelete.id}`, { method: 'DELETE' });
      toast.success(`Deleted ${pendingDelete.name}`);
      if (form.id === pendingDelete.id) resetForm();
      setPendingDelete(null);
      await loadDevices();
    } catch (err) {
      toast.error(`Could not delete ${pendingDelete.name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SectionCard
      span={12}
      title="AMT devices"
      sub={`${devices.length} ${devices.length === 1 ? 'device' : 'devices'}`}
      icon={<Server size={14} strokeWidth={1.75} />}
      bodyClassName={editor ? 'grid gap-4 lg:grid-cols-[minmax(20rem,24rem)_1fr]' : undefined}
    >
      {editor ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">
                {editing ? 'Edit device' : 'Add device'}
              </div>
              <div className="text-xs text-muted-foreground">
                Credentials are stored encrypted on the server.
              </div>
            </div>
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Cancel edit"
                onClick={resetForm}
              >
                <X className="size-4" />
              </Button>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amt-name">Name</Label>
            <Input
              id="amt-name"
              value={form.name}
              onChange={(e) => updateForm({ name: e.target.value })}
              placeholder="Lab workstation"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amt-host">Host</Label>
            <Input
              id="amt-host"
              value={form.host}
              onChange={(e) => updateForm({ host: e.target.value })}
              placeholder="192.0.2.10 or host.lan"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="amt-port">Port</Label>
              <Input
                id="amt-port"
                value={form.port}
                onChange={(e) => updateForm({ port: e.target.value })}
                inputMode="numeric"
                placeholder={String(DEFAULT_PORT)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="amt-username">Username</Label>
              <Input
                id="amt-username"
                value={form.username}
                onChange={(e) => updateForm({ username: e.target.value })}
                placeholder={DEFAULT_USERNAME}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amt-password">Password</Label>
            <Input
              id="amt-password"
              type="password"
              value={form.password}
              onChange={(e) => updateForm({ password: e.target.value })}
              placeholder={editing ? 'Re-enter to save changes' : ''}
              autoComplete="new-password"
            />
          </div>

          <label className="flex min-h-8 items-center gap-2 text-sm text-foreground">
            <Checkbox
              checked={form.useTls}
              onCheckedChange={(checked) => updateForm({ useTls: checked === true })}
            />
            Use TLS
          </label>

          {error ? <div className="text-sm font-medium text-destructive">{error}</div> : null}

          <Button type="button" onClick={() => void onSave()} disabled={saving}>
            {editing ? <Pencil className="size-4" /> : <Plus className="size-4" />}
            {saving ? 'Saving…' : editing ? 'Save device' : 'Add device'}
          </Button>
        </div>
      ) : null}

      <div className="min-w-0">
        {loading ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground">
            Loading devices…
          </div>
        ) : loadError ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-[color-mix(in_oklab,var(--bad)_30%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] px-4 text-center text-sm text-[var(--bad)]">
            {loadError}
          </div>
        ) : devices.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground">
            No AMT devices configured.
          </div>
        ) : (
          <div className="grid gap-2">
            {devices.map((device) => (
              <div
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">
                    {device.name}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{device.host}</span>
                    <span>port {device.port}</span>
                    <span>{device.username}</span>
                    <span>{device.useTls ? 'TLS' : 'no TLS'}</span>
                  </div>
                </div>
                {editor ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${device.name}`}
                      onClick={() => onEdit(device)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${device.name}`}
                      onClick={() => setPendingDelete(device)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={pendingDelete != null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete AMT device</DialogTitle>
            <DialogDescription>
              Remove <span className="font-medium text-foreground">{pendingDelete?.name}</span> and
              its stored credentials? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void onConfirmDelete()}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
