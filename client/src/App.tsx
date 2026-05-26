import { useEffect, useMemo, useState } from 'react';

import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { AlertBanner } from './components/layout/AlertBanner';
import { ExpandOverlay } from './components/tile/ExpandOverlay';
import { ALL_TILES, type TileId } from './components/widgets';

import { OverviewPage } from './pages/OverviewPage';
import { ProxmoxPage } from './pages/ProxmoxPage';
import { NetworkPage } from './pages/NetworkPage';
import { DockerPage } from './pages/DockerPage';
import { NasPage } from './pages/NasPage';
import { CamerasPage } from './pages/CamerasPage';
import { EventsPage } from './pages/EventsPage';
import { AlertsPage } from './pages/AlertsPage';
import { SettingsPage } from './pages/SettingsPage';
import { HealthPage } from './pages/HealthPage';
import { SiemPage } from './pages/SiemPage';
import { InventoryPage } from './pages/InventoryPage';
import { PlaygroundPage } from './pages/PlaygroundPage';

import { INTEGRATION_KEYS, setIntegrationEnabled, useDashData, type IntegrationKey } from './lib/telemetry';
import {
  TweakRadio,
  TweakSection,
  TweakToggle,
  TweaksPanel,
  useSystemTheme,
  useTweaks,
} from './lib/tweaks';
import {
  DEFAULT_SUB,
  SECTION_LABEL,
  resolveSub,
  saveRoute,
  loadRoute,
  subLabel,
  type Route,
  type Section,
} from './lib/route';
import type { ChartKind } from './types';
import { useThresholds } from './lib/thresholds';

type ThemeChoice = 'light' | 'dark' | 'system';
type Density = 'compact' | 'regular' | 'comfy';

interface TweakState {
  theme: ThemeChoice;
  density: Density;
  showAlerts: boolean;
  overviewLayout: TileId[];
  integrations: Record<IntegrationKey, boolean>;
}

const DEFAULTS: TweakState = {
  theme: 'light',
  density: 'regular',
  showAlerts: true,
  overviewLayout: [
    'bookmarks',
    'cpu', 'ram', 'gpu', 'unifi', 'proxmox', 'docker', 'storage', 'unas',
    'protect', 'network', 'fans', 'smart', 'ups', 'backups', 'internet',
    'topTalkers', 'tempHeat', 'events',
  ],
  integrations: {
    unifi:   true,
    proxmox: true,
    docker:  true,
    gpu:     true,
    sensors: true,
    unas:    true,
    protect: true,
  },
};

export function App() {
  useThresholds(); // subscribe so threshold changes re-render all severity-aware tiles
  const [t, setTweak] = useTweaks<TweakState>(DEFAULTS);
  const data = useDashData();
  const [route, setRouteState] = useState<Route>(() => loadRoute());
  const [chartKinds, setChartKinds] = useState<Partial<Record<TileId, ChartKind>>>({});
  const [expanded, setExpanded] = useState<TileId | null>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<number>>(new Set());
  const integrations = useMemo(
    () => ({ ...DEFAULTS.integrations, ...t.integrations }),
    [t.integrations],
  );

  const sysTheme = useSystemTheme();
  const theme: 'light' | 'dark' = t.theme === 'system' ? sysTheme : t.theme;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-density', t.density);
  }, [theme, t.density]);

  useEffect(() => {
    const present = new Set(t.overviewLayout);
    const missing = ALL_TILES.filter((tile) => !present.has(tile.id)).map((tile) => tile.id);
    if (missing.length > 0) {
      setTweak('overviewLayout', [...missing, ...t.overviewLayout]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(null);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  // Reflect the user-controlled integration toggles into telemetry. Disabling
  // an integration stops its poller immediately and blanks its slice of state.
  useEffect(() => {
    for (const key of INTEGRATION_KEYS) {
      setIntegrationEnabled(key, !!integrations[key]);
    }
  }, [integrations]);

  const setRoute = (section: Section, sub?: string, itemId?: string) => {
    const resolved: Route = {
      section,
      sub: resolveSub(section, sub ?? DEFAULT_SUB[section]),
      itemId: section === 'inventory' ? itemId : undefined,
    };
    setRouteState(resolved);
    saveRoute(resolved);
  };

  const setInventoryItemId = (itemId: string | undefined) => {
    setRouteState((prev) => {
      const next: Route = { ...prev, itemId };
      saveRoute(next);
      return next;
    });
  };

  const setChartKind = (id: TileId, k: ChartKind) =>
    setChartKinds((prev) => ({ ...prev, [id]: k }));

  const visibleAlerts = data.alerts.filter((_, i) => !dismissedAlerts.has(i));
  const dismiss = (i: number) => setDismissedAlerts((prev) => new Set(prev).add(i));

  const activeSub = resolveSub(route.section, route.sub);
  const pageTitle = activeSub ? subLabel(route.section, activeSub) : SECTION_LABEL[route.section];

  return (
    <div className="app">
      <Sidebar
        route={route}
        setRoute={setRoute}
        alerts={visibleAlerts}
      />
      <main className="main">
        <Topbar
          section={route.section}
          activeSub={activeSub}
          title={pageTitle}
          theme={theme}
          onToggleTheme={() => setTweak('theme', theme === 'dark' ? 'light' : 'dark')}
        />
        {t.showAlerts ? <AlertBanner alerts={visibleAlerts} onDismiss={dismiss} /> : null}

        {route.section === 'overview' && (
          <OverviewPage
            data={data}
            layout={t.overviewLayout}
            chartKinds={chartKinds}
            setChartKind={setChartKind}
            onExpand={setExpanded}
          />
        )}
        {route.section === 'proxmox' && <ProxmoxPage data={data} sub={activeSub ?? 'compute'} />}
        {route.section === 'network' && <NetworkPage data={data} sub={activeSub ?? 'overview'} />}
        {route.section === 'docker'  && <DockerPage  data={data} sub={activeSub ?? 'hosts'} />}
        {route.section === 'nas'     && <NasPage     data={data} sub={activeSub ?? 'pools'} />}
        {route.section === 'cameras' && <CamerasPage data={data} sub={activeSub ?? 'overview'} />}
        {route.section === 'events'  && <EventsPage  data={data} />}
        {route.section === 'alerts'  && <AlertsPage  alerts={visibleAlerts} onDismiss={dismiss} />}
        {route.section === 'health'    && <HealthPage  integrations={integrations} />}
        {route.section === 'siem'      && <SiemPage />}
        {route.section === 'inventory' && (
          <InventoryPage
            selectedItemId={route.itemId}
            onSelectItem={setInventoryItemId}
          />
        )}
        {route.section === 'playground' && <PlaygroundPage />}
        {route.section === 'settings' && (
          <SettingsPage
            integrations={integrations}
            onChange={(next) => setTweak('integrations', next)}
          />
        )}
      </main>

      <ExpandOverlay
        id={expanded}
        data={data}
        chartKind={expanded ? chartKinds[expanded] ?? 'area' : 'area'}
        setChartKind={(k) => expanded && setChartKind(expanded, k)}
        onClose={() => setExpanded(null)}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance" />
        <TweakRadio
          label="Theme"
          value={t.theme}
          options={[
            { value: 'light', label: 'light' },
            { value: 'dark', label: 'dark' },
            { value: 'system', label: 'auto' },
          ]}
          onChange={(v) => setTweak('theme', v)}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
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
