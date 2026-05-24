import { useEffect, useState } from 'react';
import { INTEGRATIONS, type HealthInfo, type HealthResponse } from '../lib/integrations';
import type { IntegrationKey } from '../lib/telemetry';
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_LABELS,
  resetThresholds,
  setThreshold,
  useThresholds,
  type Thresholds,
} from '../lib/thresholds';

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
      className={`toggle ${value ? 'is-on' : ''}`}
    >
      <span className="thumb" />
    </button>
  );
}

function ThresholdRow({ k, thresholds }: { k: keyof Thresholds; thresholds: Thresholds }) {
  const { label, unit } = THRESHOLD_LABELS[k];
  const pair = thresholds[k];
  const def = DEFAULT_THRESHOLDS[k];
  const isCustom = pair.warn !== def.warn || pair.bad !== def.bad;
  return (
    <div className={`thr-row ${isCustom ? 'is-custom' : ''}`}>
      <div className="thr-label">
        {label}
        {isCustom ? <span className="thr-dot" title={`default ${def.warn}/${def.bad}`} /> : null}
      </div>
      <label className="thr-input">
        <span style={{ color: 'var(--warn)' }}>warn</span>
        <input
          type="number"
          value={pair.warn}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            setThreshold(k, { ...pair, warn: v });
          }}
        />
        <span className="thr-unit">{unit}</span>
      </label>
      <label className="thr-input">
        <span style={{ color: 'var(--bad)' }}>bad</span>
        <input
          type="number"
          value={pair.bad}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isFinite(v)) return;
            setThreshold(k, { ...pair, bad: v });
          }}
        />
        <span className="thr-unit">{unit}</span>
      </label>
    </div>
  );
}

export function SettingsPage({ integrations, onChange }: Props) {
  const thresholds = useThresholds();
  const { data, error, loading } = useServerHealth();
  const total = INTEGRATIONS.length;
  const enabledCount = INTEGRATIONS.reduce(
    (n, def) => n + (integrations[def.key] ? 1 : 0),
    0,
  );
  const allOn = enabledCount === total;
  const allOff = enabledCount === 0;

  const setOne = (key: IntegrationKey, value: boolean) => {
    onChange({ ...integrations, [key]: value });
  };

  const setAll = (value: boolean) => {
    const next = { ...integrations };
    for (const def of INTEGRATIONS) next[def.key] = value;
    onChange(next);
  };

  return (
    <div className="page">
      <div className="settings-summary">
        <div className="ss-meta">
          <div className="ss-title">
            Integrations
            <span className="ss-count">{enabledCount} / {total} active</span>
          </div>
          <div className="ss-sub">
            Toggle integrations off to stop the dashboard from polling them. Disabled
            integrations make zero API calls until re-enabled. The server status shows
            whether <code>.env</code> is also set up to allow each integration.
          </div>
        </div>
        <div className="ss-actions">
          <button
            type="button"
            className="btn"
            disabled={allOn}
            onClick={() => setAll(true)}
          >
            Enable all
          </button>
          <button
            type="button"
            className="btn"
            disabled={allOff}
            onClick={() => setAll(false)}
          >
            Disable all
          </button>
        </div>
      </div>

      {error ? (
        <div className="alerts">
          <div className="alert bad">
            <span className="dot" style={{ background: 'var(--bad)' }} />
            <div className="body">
              <b>Server health check failed</b>
              <span>{error}</span>
            </div>
          </div>
        </div>
      ) : null}

      <div className="settings-grid">
        {INTEGRATIONS.map((def) => {
          const enabled = !!integrations[def.key];
          const info = data ? asHealthInfo(data[def.healthField]) : null;
          const status = serverStatus(info);
          const pollLabel = loading
            ? 'checking server…'
            : !enabled
              ? 'paused — no API calls'
              : info && !info.enabled
                ? 'not polling (server off)'
                : `polling /api/${def.key}`;
          return (
            <div
              key={def.key}
              className={`settings-card ${enabled ? 'is-on' : 'is-off'}`}
            >
              <div className="sc-head">
                <div className="sc-meta">
                  <div className="sc-title">{def.label}</div>
                  <div className="sc-desc">{def.description}</div>
                </div>
                <Toggle
                  value={enabled}
                  label={`Toggle ${def.label}`}
                  onChange={(v) => setOne(def.key, v)}
                />
              </div>
              <div className="sc-foot">
                <span className={`pill ${status.kind}`} title={status.hint}>
                  <span className="dot" />
                  server: {status.label}
                </span>
                <span className="sc-poll" title={pollLabel}>{pollLabel}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="settings-summary" style={{ marginTop: 16 }}>
        <div className="ss-meta">
          <div className="ss-title">Severity Thresholds</div>
          <div className="ss-sub">
            Tune when metric values switch from <span style={{ color: 'var(--ok)' }}>ok</span> to{' '}
            <span style={{ color: 'var(--warn)' }}>warn</span> to{' '}
            <span style={{ color: 'var(--bad)' }}>bad</span>. Saved to your browser only.
          </div>
        </div>
        <div className="ss-actions">
          <button type="button" className="btn" onClick={() => resetThresholds()}>
            Reset to defaults
          </button>
        </div>
      </div>

      <div className="thresholds-grid">
        {(Object.keys(THRESHOLD_LABELS) as Array<keyof Thresholds>).map((k) => (
          <ThresholdRow key={k} k={k} thresholds={thresholds} />
        ))}
      </div>
    </div>
  );
}
