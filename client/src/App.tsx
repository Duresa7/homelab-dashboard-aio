import { useEffect, useState } from 'react';

import { Sidebar, type Route } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { AlertBanner } from './components/layout/AlertBanner';
import { ExpandOverlay } from './components/tile/ExpandOverlay';
import { ALL_TILES, type TileId } from './components/widgets';

import { OverviewPage } from './pages/OverviewPage';
import { ProxmoxPage } from './pages/ProxmoxPage';
import { NetworkPage } from './pages/NetworkPage';
import { DockerPage } from './pages/DockerPage';
import { StoragePage } from './pages/StoragePage';
import { EventsPage } from './pages/EventsPage';
import { AlertsPage } from './pages/AlertsPage';

import { useDashData } from './lib/telemetry';
import {
  TweakColor,
  TweakRadio,
  TweakSection,
  TweakSelect,
  TweakToggle,
  TweaksPanel,
  useSystemTheme,
  useTweaks,
} from './lib/tweaks';
import type { ChartKind } from './types';

type Aesthetic = 'minimal' | 'terminal' | 'editorial' | 'neon';
type ThemeChoice = 'light' | 'dark' | 'system';
type Density = 'compact' | 'regular' | 'comfy';
type FontChoice = 'Inter' | 'IBM Plex Sans' | 'JetBrains Mono';

interface TweakState {
  aesthetic: Aesthetic;
  theme: ThemeChoice;
  accent: string;
  density: Density;
  font: FontChoice;
  showAlerts: boolean;
  overviewLayout: TileId[];
}

const DEFAULTS: TweakState = {
  aesthetic: 'minimal',
  theme: 'system',
  accent: '#00ff88',
  density: 'regular',
  font: 'Inter',
  showAlerts: true,
  overviewLayout: [
    'cpu', 'ram', 'gpu', 'unifi', 'proxmox', 'docker', 'storage', 'unas',
    'network', 'fans', 'smart', 'ups', 'backups', 'internet', 'topTalkers',
    'tempHeat', 'nodes', 'events',
  ],
};

const ACCENT_OPTIONS = ['#00ff88', '#3b82f6', '#f97316', '#a78bfa', '#fafafa'];
const AESTHETIC_OPTIONS = [
  { value: 'minimal' as const, label: 'Refined Minimal' },
  { value: 'terminal' as const, label: 'Terminal / Mono' },
  { value: 'editorial' as const, label: 'Editorial Cards' },
  { value: 'neon' as const, label: 'Neon / Cyberpunk' },
];
const FONT_OPTIONS = [
  { value: 'Inter' as const, label: 'Inter' },
  { value: 'IBM Plex Sans' as const, label: 'IBM Plex Sans' },
  { value: 'JetBrains Mono' as const, label: 'JetBrains Mono' },
];

const TITLE_MAP: Record<Route, { title: string; subtitle: string }> = {
  overview: { title: 'Overview', subtitle: 'all systems · live telemetry' },
  proxmox: { title: 'Proxmox', subtitle: 'virtual machines & containers' },
  unifi: { title: 'Network', subtitle: 'gateway, throughput, APs, switches' },
  docker: { title: 'Docker', subtitle: 'compose stacks & containers' },
  storage: { title: 'Storage', subtitle: 'pools, disks, SMART' },
  events: { title: 'Events', subtitle: 'recent activity log' },
  alerts: { title: 'Alerts', subtitle: 'active warnings & errors' },
};

export function App() {
  const [t, setTweak] = useTweaks<TweakState>(DEFAULTS);
  const data = useDashData();
  const [route, setRoute] = useState<Route>('overview');
  const [chartKinds, setChartKinds] = useState<Partial<Record<TileId, ChartKind>>>({});
  const [expanded, setExpanded] = useState<TileId | null>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<number>>(new Set());

  const sysTheme = useSystemTheme();
  const theme: 'light' | 'dark' = t.theme === 'system' ? sysTheme : t.theme;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-aesthetic', t.aesthetic);
    root.setAttribute('data-density', t.density);
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty(
      '--accent-soft',
      `color-mix(in oklab, ${t.accent} 16%, transparent)`,
    );
    root.style.setProperty(
      '--font-sans',
      `'${t.font}', ui-sans-serif, system-ui, sans-serif`,
    );
  }, [theme, t.aesthetic, t.density, t.accent, t.font]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const setChartKind = (id: TileId, k: ChartKind) =>
    setChartKinds((prev) => ({ ...prev, [id]: k }));

  const visibleAlerts = data.alerts.filter((_, i) => !dismissedAlerts.has(i));
  const dismiss = (i: number) =>
    setDismissedAlerts((prev) => {
      const next = new Set(prev);
      next.add(i);
      return next;
    });

  const tt = TITLE_MAP[route];

  return (
    <div className="app">
      <Sidebar route={route} setRoute={setRoute} alerts={visibleAlerts} />
      <main className="main">
        <Topbar
          title={tt.title}
          subtitle={tt.subtitle}
          theme={theme}
          onToggleTheme={() => setTweak('theme', theme === 'dark' ? 'light' : 'dark')}
        />
        {t.showAlerts ? <AlertBanner alerts={visibleAlerts} onDismiss={dismiss} /> : null}

        {route === 'overview' && (
          <OverviewPage
            data={data}
            layout={t.overviewLayout}
            chartKinds={chartKinds}
            setChartKind={setChartKind}
            onExpand={setExpanded}
          />
        )}
        {route === 'proxmox' && <ProxmoxPage data={data} />}
        {route === 'unifi' && <NetworkPage data={data} />}
        {route === 'docker' && <DockerPage data={data} />}
        {route === 'storage' && <StoragePage data={data} />}
        {route === 'events' && <EventsPage data={data} />}
        {route === 'alerts' && <AlertsPage alerts={visibleAlerts} onDismiss={dismiss} />}
      </main>

      <ExpandOverlay
        id={expanded}
        data={data}
        chartKind={expanded ? chartKinds[expanded] ?? 'area' : 'area'}
        setChartKind={(k) => expanded && setChartKind(expanded, k)}
        onClose={() => setExpanded(null)}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Aesthetic" />
        <TweakSelect
          label="Theme"
          value={t.aesthetic}
          options={AESTHETIC_OPTIONS}
          onChange={(v) => setTweak('aesthetic', v)}
        />
        <TweakRadio
          label="Mode"
          value={t.theme}
          options={[
            { value: 'light', label: 'light' },
            { value: 'dark', label: 'dark' },
            { value: 'system', label: 'auto' },
          ]}
          onChange={(v) => setTweak('theme', v)}
        />
        <TweakColor
          label="Accent"
          value={t.accent}
          options={ACCENT_OPTIONS}
          onChange={(v) => setTweak('accent', v)}
        />
        <TweakSelect
          label="Font"
          value={t.font}
          options={FONT_OPTIONS}
          onChange={(v) => setTweak('font', v)}
        />
        <TweakRadio
          label="Density"
          value={t.density}
          options={[
            { value: 'compact', label: 'compact' },
            { value: 'regular', label: 'regular' },
            { value: 'comfy', label: 'comfy' },
          ]}
          onChange={(v) => setTweak('density', v)}
        />

        <TweakSection label="Overview" />
        <TweakToggle
          label="Alert banner"
          value={t.showAlerts}
          onChange={(v) => setTweak('showAlerts', v)}
        />

        <div className="twk-row">
          <div className="twk-lbl">
            <span>Tiles on overview</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
            {ALL_TILES.map((tile) => {
              const on = t.overviewLayout.includes(tile.id);
              return (
                <label key={tile.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      const cur = t.overviewLayout.filter((x) => x !== tile.id);
                      setTweak(
                        'overviewLayout',
                        e.target.checked ? [...cur, tile.id] : cur,
                      );
                    }}
                  />
                  {tile.label}
                </label>
              );
            })}
          </div>
        </div>
      </TweaksPanel>
    </div>
  );
}
