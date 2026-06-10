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

// The card hides editing affordances for viewers; these tests exercise the
// member+ behavior, so render as an authenticated admin.
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    usersExist: true,
    user: {
      id: 1,
      username: 'admin',
      displayName: 'Admin',
      email: null,
      role: 'admin',
      totpEnabled: false,
      createdAt: 0,
      passwordChangedAt: 0,
    },
    via: 'session',
  }),
  canEdit: (user: { role?: string } | null) => user?.role === 'admin' || user?.role === 'member',
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

    await user.type(screen.getByLabelText('Name'), 'Example Host');
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

    await user.type(screen.getByLabelText('Name'), 'Example Host');
    await user.type(screen.getByLabelText('MAC address'), 'AA:BB:CC:DD:EE:FF');
    await user.click(screen.getByRole('checkbox', { name: 'Advanced' }));
    await user.type(screen.getByLabelText('Broadcast'), '198.51.100.255');
    await user.type(screen.getByLabelText('Port'), '7');
    await user.click(screen.getByRole('button', { name: 'Add host' }));

    expect(storeMock.setState).toHaveBeenCalledWith(
      'computeHosts',
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Example Host',
          mac: 'AA:BB:CC:DD:EE:FF',
          broadcast: '198.51.100.255',
          port: 7,
        }),
      ]),
    );
    expect(screen.getByText('Example Host')).toBeInTheDocument();

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
        broadcast: '198.51.100.255',
        port: 7,
      }),
    });
    expect(toastMock.success).toHaveBeenCalledWith('Magic packet sent to Example Host');
  });

  it('disables wake when server health reports WoL disabled', async () => {
    const hosts: ComputeHost[] = [{ id: 'host-1', name: 'Compute Host', mac: 'AA:BB:CC:DD:EE:FF' }];
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

  it('edits an existing host and updates the store in place', async () => {
    const user = userEvent.setup();
    storeMock.values.set('computeHosts', [
      { id: 'host-1', name: 'Old Name', mac: 'AA:BB:CC:DD:EE:FF' },
    ]);
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Edit Old Name' }));
    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Save host' }));

    expect(storeMock.setState).toHaveBeenCalledWith('computeHosts', [
      expect.objectContaining({ id: 'host-1', name: 'New Name', mac: 'AA:BB:CC:DD:EE:FF' }),
    ]);
    expect(toastMock.success).toHaveBeenCalledWith('Updated New Name');
  });

  it('deletes a host from the store', async () => {
    const user = userEvent.setup();
    storeMock.values.set('computeHosts', [
      { id: 'host-1', name: 'Doomed Host', mac: 'AA:BB:CC:DD:EE:FF' },
    ]);
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Delete Doomed Host' }));

    expect(storeMock.setState).toHaveBeenCalledWith('computeHosts', []);
    expect(toastMock.success).toHaveBeenCalledWith('Deleted Doomed Host');
  });

  it('shows an error toast when the wake request returns a non-ok status', async () => {
    const user = userEvent.setup();
    storeMock.values.set('computeHosts', [
      { id: 'host-1', name: 'Flaky Host', mac: 'AA:BB:CC:DD:EE:FF' },
    ]);
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      if (String(url) === '/api/health') {
        return Promise.resolve(jsonResponse({ wol: { enabled: true, configured: true } }));
      }
      return Promise.resolve(jsonResponse({ error: 'boom' }, { status: 500 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderCard();
    await screen.findByText('ready');
    await user.click(screen.getByRole('button', { name: 'Wake' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Wake failed for Flaky Host',
        expect.objectContaining({ description: 'HTTP 500' }),
      ),
    );
  });

  it('filters out corrupted host entries from the store', () => {
    storeMock.values.set('computeHosts', [
      { id: 'good', name: 'Good Host', mac: 'AA:BB:CC:DD:EE:FF' },
      { id: 'bad', name: 'Missing MAC' }, // no mac → rejected by isComputeHost
      'totally-not-a-host',
    ]);
    renderCard();

    expect(screen.getByText('Good Host')).toBeInTheDocument();
    expect(screen.queryByText('Missing MAC')).not.toBeInTheDocument();
  });

  it('rejects a non-numeric port before saving', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByLabelText('Name'), 'Example Host');
    await user.type(screen.getByLabelText('MAC address'), 'AA:BB:CC:DD:EE:FF');
    await user.click(screen.getByRole('checkbox', { name: 'Advanced' }));
    await user.type(screen.getByLabelText('Port'), 'abc');
    await user.click(screen.getByRole('button', { name: 'Add host' }));

    expect(screen.getByText('Port must be a number from 1 to 65535.')).toBeInTheDocument();
    expect(storeMock.setState).not.toHaveBeenCalled();
  });

  it('reports unknown health but keeps waking enabled when /api/health fails', async () => {
    storeMock.values.set('computeHosts', [
      { id: 'host-1', name: 'Resilient Host', mac: 'AA:BB:CC:DD:EE:FF' },
    ]);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({}, { status: 500 }))),
    );

    renderCard();

    expect(await screen.findByText('health unknown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wake' })).toBeEnabled();
  });
});
