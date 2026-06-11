import type React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface SetupMock {
  status: { onboardingComplete: boolean; configuredCapabilities: string[] } | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

async function loadApp({
  setup,
  connectivity = 'online',
}: {
  setup: SetupMock;
  connectivity?: 'online' | 'offline' | 'unknown';
}) {
  vi.resetModules();
  vi.doMock('./lib/setup', () => ({
    SETUP_CONFIG_CHANGED_EVENT: 'homelab:setup-config-changed',
    getCapabilities: vi.fn(async () => []),
    getConfig: vi.fn(async () => ({ capabilities: {}, onboarding: { complete: true } })),
    useSetupStatus: () => setup,
  }));
  vi.doMock('./pages/onboarding/OnboardingWizard', () => ({
    OnboardingWizard: () => <div>Onboarding wizard</div>,
  }));
  vi.doMock('./lib/connectivity', () => ({
    useConnectivity: () => ({ status: connectivity, reason: null }),
  }));
  vi.doMock('./lib/telemetry', () => ({
    INTEGRATION_KEYS: [],
    setIntegrationEnabled: vi.fn(),
    useDashData: () => ({ alerts: [] }),
  }));
  vi.doMock('./lib/tweaks', () => ({
    useSystemTheme: () => 'light',
    useTweaks: <T,>(defaults: T): [T, (key: keyof T, value: T[keyof T]) => void] => [
      defaults,
      vi.fn(),
    ],
  }));
  vi.doMock('./lib/thresholds', () => ({ useThresholds: vi.fn() }));
  vi.doMock('./lib/store', () => ({
    getState: <T,>(_key: string, fallback: T) => fallback,
    setState: vi.fn(),
    subscribe: vi.fn(() => () => {
      void 0;
    }),
  }));
  vi.doMock('./lib/route', () => ({
    DEFAULT_SUB: { overview: undefined },
    loadRoute: () => ({ section: 'overview' }),
    resolveSub: () => undefined,
    saveRoute: vi.fn(),
  }));
  vi.doMock('./components/layout/Sidebar', () => ({ AppSidebar: () => null }));
  vi.doMock('./components/layout/Topbar', () => ({ Topbar: () => null }));
  vi.doMock('./components/layout/AlertBanner', () => ({ AlertBanner: () => null }));
  vi.doMock('./components/layout/CommandMenu', () => ({ CommandMenu: () => null }));
  vi.doMock('./components/common', () => ({
    BackendOffline: () => <div>Backend offline</div>,
  }));
  vi.doMock('@/components/ui/tooltip', () => ({
    TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }));
  vi.doMock('@/components/ui/sonner', () => ({ Toaster: () => null }));
  vi.doMock('@/components/ui/sidebar', () => ({
    SidebarInset: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SidebarProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }));

  const pageMock = (label: string) => () => <div>{label}</div>;
  vi.doMock('./pages/OverviewPage', () => ({ OverviewPage: pageMock('Dashboard overview') }));
  vi.doMock('./pages/ProxmoxPage', () => ({ ProxmoxPage: pageMock('Proxmox') }));
  vi.doMock('./pages/NetworkPage', () => ({ NetworkPage: pageMock('Network') }));
  vi.doMock('./pages/DockerPage', () => ({ DockerPage: pageMock('Docker') }));
  vi.doMock('./pages/NasPage', () => ({ NasPage: pageMock('NAS') }));
  vi.doMock('./pages/EventsPage', () => ({ EventsPage: pageMock('Events') }));
  vi.doMock('./pages/AlertsPage', () => ({ AlertsPage: pageMock('Alerts') }));
  vi.doMock('./pages/SettingsPage', () => ({ SettingsPage: pageMock('Settings') }));
  vi.doMock('./pages/HealthPage', () => ({ HealthPage: pageMock('Health') }));
  vi.doMock('./pages/SiemPage', () => ({ SiemPage: pageMock('SIEM') }));
  vi.doMock('./pages/InventoryPage', () => ({ InventoryPage: pageMock('Inventory') }));
  vi.doMock('./pages/PlaygroundPage', () => ({ PlaygroundPage: pageMock('Playground') }));

  return import('./App');
}

describe('App first-run setup gate', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('renders onboarding while setup is incomplete and backend is online', async () => {
    const { App } = await loadApp({
      setup: {
        status: { onboardingComplete: false, configuredCapabilities: [] },
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });

    render(<App />);

    expect(screen.getByText('Onboarding wizard')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard overview')).not.toBeInTheDocument();
  });

  it('renders the dashboard when setup is complete', async () => {
    const { App } = await loadApp({
      setup: {
        status: { onboardingComplete: true, configuredCapabilities: [] },
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });

    render(<App />);

    expect(screen.getByText('Dashboard overview')).toBeInTheDocument();
    expect(screen.queryByText('Onboarding wizard')).not.toBeInTheDocument();
  });
});
