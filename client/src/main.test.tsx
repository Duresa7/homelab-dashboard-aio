import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

describe('main startup', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('rehydrates the store on the connectivity reconnect edge', async () => {
    const reconnectListeners: Array<() => void> = [];
    const startHeartbeat = vi.fn();
    const onReconnect = vi.fn((fn: () => void) => {
      reconnectListeners.push(fn);
      return vi.fn();
    });
    const hydrateStore = vi.fn(async () => undefined);
    const rehydrate = vi.fn(async () => undefined);
    const render = vi.fn();
    const createRoot = vi.fn(() => ({ render }));
    const installAuthExpiryInterceptor = vi.fn();

    vi.doMock('./lib/connectivity', () => ({ onReconnect, startHeartbeat }));
    vi.doMock('./lib/store', () => ({ hydrateStore, rehydrate }));
    vi.doMock('react-dom/client', () => ({ createRoot }));
    vi.doMock('./App', () => ({ App: () => null }));
    // AuthBoot owns post-login hydration now; main only wires the boot shell.
    vi.doMock('./pages/auth/AuthBoot', () => ({
      AuthBoot: ({ children }: { children: React.ReactNode }) => children,
    }));
    vi.doMock('./lib/auth', () => ({ installAuthExpiryInterceptor }));
    vi.doMock('./lib/units', () => ({
      TempUnitProvider: ({ children }: { children: React.ReactNode }) => children,
    }));

    document.body.innerHTML = '<div id="root"></div>';

    await import('./main');
    await waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(startHeartbeat).toHaveBeenCalledTimes(1);
    expect(installAuthExpiryInterceptor).toHaveBeenCalledTimes(1);
    // Hydration happens inside AuthBoot after login, not at module load.
    expect(hydrateStore).not.toHaveBeenCalled();
    expect(rehydrate).not.toHaveBeenCalled();

    reconnectListeners[0]();

    expect(rehydrate).toHaveBeenCalledTimes(1);
  });
});
