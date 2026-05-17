import { useEffect, useState } from 'react';
import { INTEGRATIONS, type HealthInfo, type HealthResponse } from '../lib/integrations';
import type { IntegrationKey } from '../lib/telemetry';

interface Props {
  integrations: Record<IntegrationKey, boolean>;
  onChange: (integrations: Record<IntegrationKey, boolean>) => void;
}

interface ServerHealthState {
  data: HealthResponse | null;
  error: string | null;
  loading: boolean;
}

function useServerHealth(): ServerHealthState {
  const [state, setState] = useState<ServerHealthState>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as HealthResponse;
        if (cancelled) return;
        setState({ data, error: null, loading: false });
      } catch (err) {
        if (cancelled) return;
        setState({
          data: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
        });
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

function asHealthInfo(value: unknown): HealthInfo | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.enabled !== 'boolean') return null;
  return {
    enabled: v.enabled,
    configured: !!v.configured,
  };
}

interface StatusPill {
  kind: 'ok' | 'warn' | 'bad' | 'info';
  label: string;
  hint: string;
}

function serverStatus(info: HealthInfo | null): StatusPill {
  if (!info) {
    return {
      kind: 'info',
      label: 'unknown',
      hint: 'No status reported by the server.',
    };
  }
  if (!info.enabled) {
    return {
      kind: 'info',
      label: 'server disabled',
      hint: 'Set *_ENABLED=true in .env to allow this integration server-side.',
    };
  }
  if (!info.configured) {
    return {
      kind: 'warn',
      label: 'not configured',
      hint: 'The server allows this integration but credentials/host are missing in .env.',
    };
  }
  return {
    kind: 'ok',
    label: 'configured',
    hint: 'Server configuration is present for this integration.',
  };
}

function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={() => onChange(!value)}
      style={{
        position: 'relative',
        width: 44,
        height: 24,
        borderRadius: 999,
        border: 0,
        cursor: 'pointer',
        padding: 0,
        background: value ? '#34c759' : 'var(--line, rgba(0,0,0,.18))',
        transition: 'background .15s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,.25)',
          transition: 'transform .15s',
          transform: value ? 'translateX(20px)' : 'translateX(0)',
        }}
      />
    </button>
  );
}

export function SettingsPage({ integrations, onChange }: Props) {
  const { data, error, loading } = useServerHealth();
  const allOn = Object.values(integrations).every(Boolean);
  const allOff = Object.values(integrations).every((v) => !v);

  const setOne = (key: IntegrationKey, value: boolean) => {
    onChange({ ...integrations, [key]: value });
  };

  const setAll = (value: boolean) => {
    const next = { ...integrations };
    for (const def of INTEGRATIONS) next[def.key] = value;
    onChange(next);
  };

  return (
    <div className="grid">
      <div className="tile span-12">
        <div className="t-head">
          <div className="t-title">Integrations</div>
          <div className="row" style={{ gap: 8 }}>
            <button
              className="icon-btn"
              disabled={allOn}
              onClick={() => setAll(true)}
              style={{ padding: '4px 10px', height: 28 }}
            >
              Enable all
            </button>
            <button
              className="icon-btn"
              disabled={allOff}
              onClick={() => setAll(false)}
              style={{ padding: '4px 10px', height: 28 }}
            >
              Disable all
            </button>
          </div>
        </div>
        <div className="t-sub" style={{ paddingBottom: 10 }}>
          Toggle integrations off to stop the dashboard from polling them. Disabled
          integrations make zero integration API calls until you re-enable them here. The
          server-side status shows whether <code>.env</code> is also set up to
          allow the integration.
          {error ? (
            <div style={{ color: 'var(--bad)', paddingTop: 4 }}>
              Server health check failed: {error}
            </div>
          ) : null}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 10,
          }}
        >
          {INTEGRATIONS.map((def) => {
            const enabled = !!integrations[def.key];
            const info = data ? asHealthInfo(data[def.healthField]) : null;
            const status = serverStatus(info);
            const inactive = !enabled;
            return (
              <div
                key={def.key}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  opacity: inactive ? 0.7 : 1,
                  transition: 'opacity .15s',
                }}
              >
                <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                  <div className="flex1">
                    <div className="t-title" style={{ fontSize: 14 }}>{def.label}</div>
                    <div className="t-sub" style={{ marginTop: 2 }}>{def.description}</div>
                  </div>
                  <Toggle
                    value={enabled}
                    label={`Toggle ${def.label}`}
                    onChange={(v) => setOne(def.key, v)}
                  />
                </div>
                <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                  <span className={`pill ${status.kind}`} title={status.hint}>
                    <span className="dot" />
                    server: {status.label}
                  </span>
                  <span className="t-sub" style={{ fontSize: 11 }}>
                    {loading
                      ? 'checking server...'
                      : !enabled
                        ? 'paused (no API calls)'
                        : info && !info.enabled
                          ? 'not polling (server disabled)'
                          : 'polling /api/' + def.key}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
