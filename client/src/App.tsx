import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CloudOff } from 'lucide-react';

import { AppSidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { AlertBanner } from './components/layout/AlertBanner';
import { CommandMenu } from './components/layout/CommandMenu';
import { BackendOffline } from './components/common';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { getState, setState } from './lib/store';
import { useSetupStatus } from './lib/setup';

import { OverviewPage } from './pages/OverviewPage';
import { OnboardingWizard } from './pages/onboarding/OnboardingWizard';
import { ProxmoxPage } from './pages/ProxmoxPage';
import { NetworkPage } from './pages/NetworkPage';
import { DockerPage } from './pages/DockerPage';
import { NasPage } from './pages/NasPage';
import { ObservabilityPage } from './pages/ObservabilityPage';
import { SettingsPage, type SettingsTabId } from './pages/SettingsPage';
import { InventoryPage } from './pages/InventoryPage';
import { PlaygroundPage } from './pages/PlaygroundPage';

import {
  INTEGRATION_KEYS,
  setIntegrationEnabled,
  useDashData,
  type IntegrationKey,
} from './lib/telemetry';
import { useSystemTheme, useTweaks } from './lib/tweaks';
import {
  DEFAULT_SUB,
  normalizeProxmoxItemId,
  resolveProxmoxSub,
  resolveSub,
  saveRoute,
  loadRoute,
  type Route,
  type Section,
} from './lib/route';
import { useThresholds } from './lib/thresholds';
import { DEFAULT_DATETIME_PREFERENCES, type DateTimePreferences } from './lib/datetime';
import { useConnectivity } from './lib/connectivity';
import { isSectionVisible, PresentationProvider, usePresentation } from './lib/presentation';

type ThemeChoice = 'light' | 'dark' | 'system';
type Density = 'compact' | 'regular' | 'comfy';

interface TweakState {
  theme: ThemeChoice;
  density: Density;
  showAlerts: boolean;
  dateTime: DateTimePreferences;
  integrations: Record<IntegrationKey, boolean>;
}

const DEFAULTS: TweakState = {
  theme: 'light',
  density: 'regular',
  showAlerts: true,
  dateTime: { ...DEFAULT_DATETIME_PREFERENCES },
  integrations: {
    unifi: true,
    proxmox: true,
    docker: true,
    gpu: true,
    sensors: true,
    unas: true,
  },
};

const BACKEND_BACKED_SECTIONS = new Set<Section>([
  'overview',
  'proxmox',
  'network',
  'docker',
  'nas',
  'observability',
  'inventory',
  'playground',
]);

function DashboardApp() {
  useThresholds(); // subscribe so threshold changes re-render all severity-aware tiles
  const [t, setTweak] = useTweaks<TweakState>(DEFAULTS);
  const data = useDashData();
  const connectivity = useConnectivity();
  const setupStatus = useSetupStatus();
  const presentation = usePresentation();
  const [route, setRouteState] = useState<Route>(() => loadRoute());
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<number>>(new Set());
  const [cmdOpen, setCmdOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('preferences');
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(
    () => !getState<boolean>('sidebarCollapsed', false),
  );
  const handleSidebarOpenChange = (open: boolean) => {
    setSidebarOpen(open);
    setState<boolean>('sidebarCollapsed', !open);
  };
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
    const fn = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
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
    const normalizedItemId =
      section === 'proxmox'
        ? normalizeProxmoxItemId(itemId)
        : section === 'inventory'
          ? itemId
          : undefined;
    const resolved: Route = {
      section,
      sub:
        section === 'proxmox'
          ? resolveProxmoxSub(normalizedItemId, sub ?? DEFAULT_SUB[section])
          : resolveSub(section, sub ?? DEFAULT_SUB[section]),
      itemId: normalizedItemId,
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

  const visibleAlerts = data.alerts.filter((_, i) => !dismissedAlerts.has(i));
  const dismiss = (i: number) => setDismissedAlerts((prev) => new Set(prev).add(i));

  const activeSub =
    route.section === 'proxmox'
      ? resolveProxmoxSub(route.itemId, route.sub)
      : resolveSub(route.section, route.sub);

  const backendOffline = connectivity.status === 'offline';
  const setupLoading = setupStatus.loading && connectivity.status !== 'offline';
  const setupRequired =
    connectivity.status !== 'offline' && setupStatus.status?.onboardingComplete === false;
  const sectionGated = backendOffline && BACKEND_BACKED_SECTIONS.has(route.section);

  useEffect(() => {
    if (!isSectionVisible(route.section, presentation)) setRoute('overview');
  }, [presentation, route.section]);

  if (setupLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        Loading setup...
      </div>
    );
  }

  if (setupRequired) {
    return (
      <TooltipProvider delayDuration={250}>
        <OnboardingWizard onDone={setupStatus.refresh} />
        <Toaster />
      </TooltipProvider>
    );
  }

  const sectionContent = sectionGated ? (
    <BackendOffline reason={connectivity.reason} />
  ) : (
    <>
      {route.section === 'overview' && <OverviewPage data={data} setRoute={setRoute} />}
      {route.section === 'proxmox' && (
        <ProxmoxPage
          data={data}
          itemId={route.itemId ?? 'datacenter'}
          sub={activeSub ?? 'summary'}
          onSelect={(itemId, sub) => setRoute('proxmox', sub, itemId)}
        />
      )}
      {route.section === 'network' && (
        <NetworkPage
          data={data}
          sub={activeSub ?? 'overview'}
          onSelectSub={(s) => setRoute('network', s)}
        />
      )}
      {route.section === 'docker' && (
        <DockerPage
          data={data}
          sub={activeSub ?? 'hosts'}
          onSelectSub={(s) => setRoute('docker', s)}
        />
      )}
      {route.section === 'nas' && (
        <NasPage data={data} sub={activeSub ?? 'pools'} onSelectSub={(s) => setRoute('nas', s)} />
      )}
      {route.section === 'observability' && (
        <ObservabilityPage
          data={data}
          integrations={integrations}
          alerts={visibleAlerts}
          onDismissAlert={dismiss}
          sub={activeSub ?? 'alerts'}
          onSelectSub={(s) => setRoute('observability', s)}
        />
      )}
      {route.section === 'inventory' && (
        <InventoryPage selectedItemId={route.itemId} onSelectItem={setInventoryItemId} />
      )}
      {route.section === 'playground' && <PlaygroundPage />}
      {route.section === 'settings' && (
        <SettingsPage
          integrations={integrations}
          preferences={{
            theme: t.theme,
            density: t.density,
            showAlerts: t.showAlerts,
            dateTime: t.dateTime,
          }}
          tab={settingsTab}
          onTabChange={setSettingsTab}
          onIntegrationChange={(next) => setTweak('integrations', next)}
          onPreferenceChange={(key, value) => {
            if (key === 'theme') setTweak('theme', value as ThemeChoice);
            if (key === 'density') setTweak('density', value as Density);
            if (key === 'showAlerts') setTweak('showAlerts', value as boolean);
            if (key === 'dateTime') setTweak('dateTime', value as DateTimePreferences);
          }}
        />
      )}
    </>
  );

  return (
    <TooltipProvider delayDuration={250}>
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={handleSidebarOpenChange}
        style={
          {
            '--sidebar-width': 'var(--sidebar-w)',
            '--sidebar-width-icon': 'var(--sidebar-rail)',
          } as CSSProperties
        }
      >
        <AppSidebar route={route} setRoute={setRoute} alerts={visibleAlerts} />

        <SidebarInset>
          <Topbar
            section={route.section}
            activeSub={activeSub}
            dateTime={t.dateTime}
            onNavigateSection={(s) => setRoute(s)}
            onOpenSearch={() => setCmdOpen(true)}
          />

          <div className="w-full max-w-[var(--content-max)] flex-1 px-[var(--page-pad)] pt-[var(--page-pad)] pb-24">
            {backendOffline ? (
              <div
                role="status"
                className="mb-[var(--page-gap)] flex items-start gap-3 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-foreground"
              >
                <CloudOff strokeWidth={1.75} className="mt-0.5 size-4 shrink-0 text-warn" />
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    Backend offline — showing defaults, not your saved data.
                  </span>
                  <span className="text-muted-foreground">
                    {connectivity.reason ? (
                      <>
                        Reason:{' '}
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                          {connectivity.reason}
                        </code>
                        .{' '}
                      </>
                    ) : null}
                    Live telemetry and your saved inventory are stored by the server. Start it with{' '}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                      npm run server
                    </code>{' '}
                    to restore live data.
                  </span>
                </div>
              </div>
            ) : null}
            {t.showAlerts ? <AlertBanner alerts={visibleAlerts} onDismiss={dismiss} /> : null}

            {sectionContent}
          </div>
        </SidebarInset>

        <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} setRoute={setRoute} />

        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}

export function App() {
  return (
    <PresentationProvider>
      <DashboardApp />
    </PresentationProvider>
  );
}
