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

    vi.doMock('./lib/connectivity', () => ({ onReconnect, startHeartbeat }));
    vi.doMock('./lib/store', () => ({ hydrateStore, rehydrate }));
    vi.doMock('react-dom/client', () => ({ createRoot }));
    vi.doMock('./App', () => ({ App: () => null }));
    vi.doMock('./lib/units', () => ({
      TempUnitProvider: ({ children }: { children: React.ReactNode }) => children,
    }));

    document.body.innerHTML = '<div id="root"></div>';

    await import('./main');
    await waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(startHeartbeat).toHaveBeenCalledTimes(1);
    expect(hydrateStore).toHaveBeenCalledTimes(1);
    expect(rehydrate).not.toHaveBeenCalled();

    reconnectListeners[0]();

    expect(rehydrate).toHaveBeenCalledTimes(1);
  });
});
