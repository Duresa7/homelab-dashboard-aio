import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ComputeHost } from './ComputeWakeCard';
import { ComputeWakeCard } from './ComputeWakeCard';

const storeMock = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    values,
    setCalls: [] as Array<{ key: string; value: unknown }>,
    getState: vi.fn((key: string, fallback: unknown) => {
      return values.has(key) ? values.get(key) : fallback;
    }),
    setState: vi.fn((key: string, value: unknown) => {
      values.set(key, value);
      storeMock.setCalls.push({ key, value });
      listeners.get(key)?.forEach((fn) => fn());
    }),
    subscribe: vi.fn((key: string, fn: () => void) => {
      const set = listeners.get(key) ?? new Set<() => void>();
      set.add(fn);
      listeners.set(key, set);
      return () => set.delete(fn);
    }),
    reset() {
      values.clear();
      listeners.clear();
      this.setCalls.length = 0;
      this.getState.mockClear();
      this.setState.mockClear();
      this.subscribe.mockClear();
    },
  };
});

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/store', () => ({
  getState: storeMock.getState,
  setState: storeMock.setState,
  subscribe: storeMock.subscribe,
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function renderCard() {
  return render(
    <TooltipProvider>
      <ComputeWakeCard />
    </TooltipProvider>,
  );
}

describe('ComputeWakeCard', () => {
  beforeEach(() => {
    storeMock.reset();
    toastMock.success.mockClear();
    toastMock.error.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ wol: { enabled: true, configured: true } }))),
    );
  });

  it('rejects invalid MACs before saving', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByLabelText('Name'), 'Example PC');
    await user.type(screen.getByLabelText('MAC address'), 'not-a-mac');
    await user.click(screen.getByRole('button', { name: 'Add host' }));

    expect(screen.getByText('Enter a valid MAC address.')).toBeInTheDocument();
    expect(storeMock.setState).not.toHaveBeenCalled();
  });

  it('persists hosts and sends a wake request with optional fields', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === '/api/health') {
        return Promise.resolve(jsonResponse({ wol: { enabled: true, configured: true } }));
      }
      if (String(url) === '/api/wol/wake') {
        return Promise.resolve(jsonResponse({ ok: true, sent: true, request: init }));
      }
      return Promise.resolve(jsonResponse({}, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCard();
    await screen.findByText('ready');

    await user.type(screen.getByLabelText('Name'), 'Example PC');
    await user.type(screen.getByLabelText('MAC address'), 'AA:BB:CC:DD:EE:FF');
    await user.click(screen.getByRole('checkbox', { name: 'Advanced' }));
    await user.type(screen.getByLabelText('Broadcast'), '198.51.100.10');
    await user.type(screen.getByLabelText('Port'), '7');
    await user.click(screen.getByRole('button', { name: 'Add host' }));

    expect(storeMock.setState).toHaveBeenCalledWith(
      'computeHosts',
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Example PC',
          mac: 'AA:BB:CC:DD:EE:FF',
          broadcast: '198.51.100.10',
          port: 7,
        }),
      ]),
    );
    expect(screen.getByText('Example PC')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Wake' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/wol/wake', expect.any(Object)),
    );

    const wakeCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/wol/wake');
    expect(wakeCall?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mac: 'AA:BB:CC:DD:EE:FF',
        broadcast: '198.51.100.10',
        port: 7,
      }),
    });
    expect(toastMock.success).toHaveBeenCalledWith('Magic packet sent to Example PC');
  });

  it('disables wake when server health reports WoL disabled', async () => {
    const hosts: ComputeHost[] = [{ id: 'host-1', name: 'Grey Server', mac: 'AA:BB:CC:DD:EE:FF' }];
    storeMock.values.set('computeHosts', hosts);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ wol: { enabled: false, configured: false } }))),
    );

    renderCard();

    expect(await screen.findByText('wol disabled')).toBeInTheDocument();
    expect(screen.getByText('Wake-on-LAN is disabled on the server.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wake' })).toBeDisabled();
  });
});
