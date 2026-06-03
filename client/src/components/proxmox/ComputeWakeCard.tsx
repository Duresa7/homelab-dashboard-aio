import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getState, setState, subscribe as subscribeState } from '@/lib/store';
import { cn } from '@/lib/utils';

const STORE_KEY = 'computeHosts';
const DEFAULT_BROADCAST = '255.255.255.255';
const DEFAULT_PORT = 9;
const EMPTY_HOSTS: ComputeHost[] = [];
let lastRawHosts: unknown = null;
let lastSanitizedHosts: ComputeHost[] = EMPTY_HOSTS;

export interface ComputeHost {
  id: string;
  name: string;
  mac: string;
  broadcast?: string;
  port?: number;
}

interface WolHealth {
  enabled: boolean;
  configured: boolean;
}

interface FormState {
  id: string | null;
  name: string;
  mac: string;
  broadcast: string;
  port: string;
  advanced: boolean;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  mac: '',
  broadcast: '',
  port: '',
  advanced: false,
};

function readHosts(): ComputeHost[] {
  const value = getState<unknown>(STORE_KEY, EMPTY_HOSTS);
  if (!Array.isArray(value)) return EMPTY_HOSTS;
  if (value === lastRawHosts) return lastSanitizedHosts;
  lastRawHosts = value;
  lastSanitizedHosts = value.every(isComputeHost) ? value : value.filter(isComputeHost);
  return lastSanitizedHosts;
}

function isComputeHost(value: unknown): value is ComputeHost {
  if (!value || typeof value !== 'object') return false;
  const host = value as Record<string, unknown>;
  return (
    typeof host.id === 'string' && typeof host.name === 'string' && typeof host.mac === 'string'
  );
}

function useComputeHosts(): [ComputeHost[], (hosts: ComputeHost[]) => void] {
  const hosts = useSyncExternalStore((fn) => subscribeState(STORE_KEY, fn), readHosts, readHosts);
  return [hosts, (next) => setState<ComputeHost[]>(STORE_KEY, next)];
}

function isValidMac(value: string): boolean {
  const mac = value.trim();
  return (
    /^[0-9a-fA-F]{12}$/.test(mac) ||
    /^[0-9a-fA-F]{2}([:-])[0-9a-fA-F]{2}(\1[0-9a-fA-F]{2}){4}$/.test(mac)
  );
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseHealth(value: unknown): WolHealth | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.enabled !== 'boolean') return null;
  return { enabled: obj.enabled, configured: !!obj.configured };
}

function trimOptional(value: string): string | undefined {
  const next = value.trim();
  return next ? next : undefined;
}

function normalizePort(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return Number.NaN;
  return parsed;
}

function buildHost(form: FormState): { host: ComputeHost | null; error: string | null } {
  const name = form.name.trim();
  const mac = form.mac.trim();
  if (!name) return { host: null, error: 'Name is required.' };
  if (!mac) return { host: null, error: 'MAC address is required.' };
  if (!isValidMac(mac)) return { host: null, error: 'Enter a valid MAC address.' };

  const port = normalizePort(form.port);
  if (Number.isNaN(port)) return { host: null, error: 'Port must be a number from 1 to 65535.' };

  return {
    host: {
      id: form.id ?? newId(),
      name,
      mac,
      ...(trimOptional(form.broadcast) ? { broadcast: trimOptional(form.broadcast) } : {}),
      ...(port != null ? { port } : {}),
    },
    error: null,
  };
}

function wakePayload(host: ComputeHost): { mac: string; broadcast?: string; port?: number } {
  return {
    mac: host.mac,
    ...(host.broadcast ? { broadcast: host.broadcast } : {}),
    ...(host.port != null ? { port: host.port } : {}),
  };
}

function HostMeta({ host }: { host: ComputeHost }) {
  const hasCustomBroadcast = host.broadcast && host.broadcast !== DEFAULT_BROADCAST;
  const hasCustomPort = host.port != null && host.port !== DEFAULT_PORT;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="font-mono">{host.mac}</span>
      {hasCustomBroadcast ? <span>broadcast {host.broadcast}</span> : null}
      {hasCustomPort ? <span>port {host.port}</span> : null}
    </div>
  );
}

export function ComputeWakeCard() {
  const [hosts, setHosts] = useComputeHosts();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<WolHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [wakingId, setWakingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadHealth() {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Record<string, unknown>;
        if (!cancelled) setHealth(parseHealth(body.wol));
      } catch (err) {
        if (!cancelled) setHealthError(err instanceof Error ? err.message : String(err));
      }
    }
    void loadHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  const status = useMemo(() => {
    if (healthError) return { kind: 'warn' as const, label: 'health unknown' };
    if (!health) return { kind: 'info' as const, label: 'checking' };
    if (!health.enabled) return { kind: 'idle' as const, label: 'wol disabled' };
    if (!health.configured) return { kind: 'warn' as const, label: 'not configured' };
    return { kind: 'ok' as const, label: 'ready' };
  }, [health, healthError]);

  const wakeDisabled = health?.enabled === false;
  const editing = form.id != null;

  const updateForm = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setError(null);
  };

  const onSave = () => {
    const result = buildHost(form);
    if (result.error || !result.host) {
      setError(result.error);
      return;
    }
    const next = editing
      ? hosts.map((host) => (host.id === result.host?.id ? result.host : host))
      : [...hosts, result.host];
    setHosts(next);
    toast.success(editing ? `Updated ${result.host.name}` : `Added ${result.host.name}`);
    resetForm();
  };

  const onEdit = (host: ComputeHost) => {
    setForm({
      id: host.id,
      name: host.name,
      mac: host.mac,
      broadcast: host.broadcast ?? '',
      port: host.port != null ? String(host.port) : '',
      advanced: !!host.broadcast || host.port != null,
    });
    setError(null);
  };

  const onDelete = (id: string) => {
    const host = hosts.find((item) => item.id === id);
    setHosts(hosts.filter((item) => item.id !== id));
    if (form.id === id) resetForm();
    if (host) toast.success(`Deleted ${host.name}`);
  };

  const onWake = async (host: ComputeHost) => {
    if (!isValidMac(host.mac)) {
      toast.error(`Fix the MAC address for ${host.name} before waking it`);
      return;
    }
    setWakingId(host.id);
    try {
      const res = await fetch('/api/wol/wake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(wakePayload(host)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Magic packet sent to ${host.name}`);
    } catch (err) {
      toast.error(`Wake failed for ${host.name}`, {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWakingId(null);
    }
  };

  return (
    <SectionCard
      span={12}
      title="Compute"
      sub={`${hosts.length} ${hosts.length === 1 ? 'host' : 'hosts'}`}
      icon={<Power size={14} strokeWidth={1.75} />}
      actions={<StatusBadge kind={status.kind}>{status.label}</StatusBadge>}
      bodyClassName="grid gap-4 lg:grid-cols-[minmax(18rem,22rem)_1fr]"
    >
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              {editing ? 'Edit host' : 'Add host'}
            </div>
            <div className="text-xs text-muted-foreground">
              Wake sends a packet; it does not confirm boot.
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
          <Label htmlFor="compute-host-name">Name</Label>
          <Input
            id="compute-host-name"
            value={form.name}
            onChange={(event) => updateForm({ name: event.target.value })}
            placeholder="Example PC"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="compute-host-mac">MAC address</Label>
          <Input
            id="compute-host-mac"
            value={form.mac}
            onChange={(event) => updateForm({ mac: event.target.value })}
            placeholder="AA:BB:CC:DD:EE:FF"
            aria-invalid={error?.includes('MAC') ? true : undefined}
          />
        </div>

        <label className="flex min-h-8 items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={form.advanced}
            onCheckedChange={(checked) => updateForm({ advanced: checked === true })}
          />
          Advanced
        </label>

        {form.advanced ? (
          <div className="grid gap-3 rounded-md border border-border bg-background/60 p-3">
            <div className="grid gap-2">
              <Label htmlFor="compute-host-broadcast">Broadcast</Label>
              <Input
                id="compute-host-broadcast"
                value={form.broadcast}
                onChange={(event) => updateForm({ broadcast: event.target.value })}
                placeholder={DEFAULT_BROADCAST}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="compute-host-port">Port</Label>
              <Input
                id="compute-host-port"
                value={form.port}
                onChange={(event) => updateForm({ port: event.target.value })}
                inputMode="numeric"
                placeholder={String(DEFAULT_PORT)}
              />
            </div>
          </div>
        ) : null}

        {error ? <div className="text-sm font-medium text-destructive">{error}</div> : null}
        {health?.enabled === false ? (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Wake-on-LAN is disabled on the server.
          </div>
        ) : null}

        <Button type="button" onClick={onSave}>
          {editing ? <Pencil className="size-4" /> : <Plus className="size-4" />}
          {editing ? 'Save host' : 'Add host'}
        </Button>
      </div>

      <div className="min-w-0">
        {hosts.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 text-center text-sm text-muted-foreground">
            No compute hosts saved.
          </div>
        ) : (
          <div className="grid gap-2">
            {hosts.map((host) => (
              <div
                key={host.id}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/60 p-3',
                  wakeDisabled && 'opacity-75',
                )}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{host.name}</div>
                  <HostMeta host={host} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={wakeDisabled || wakingId === host.id}
                    onClick={() => void onWake(host)}
                  >
                    <Power className="size-4" />
                    {wakingId === host.id ? 'Sending' : 'Wake'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${host.name}`}
                    onClick={() => onEdit(host)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${host.name}`}
                    onClick={() => onDelete(host.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
