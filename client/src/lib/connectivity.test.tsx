import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getConnectivityIntervalMs,
  reduceConnectivity,
  type ConnectivityState,
} from './connectivity';

function model(status: ConnectivityState['status'], consecutiveFailures = 0) {
  return {
    state: {
      status,
      reason: null,
      code: null,
      lastChecked: null,
    },
    consecutiveFailures,
  };
}

function response(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

async function loadConnectivity() {
  vi.resetModules();
  return import('./connectivity');
}

describe('connectivity reducer', () => {
  it('keeps online state through one missed heartbeat, then flips offline on the second', () => {
    const first = reduceConnectivity(model('online'), { ok: false, reason: 'Failed to fetch' }, 10);
    expect(first.model.state).toEqual({
      status: 'online',
      reason: 'Failed to fetch',
      code: null,
      lastChecked: 10,
    });
    expect(first.model.consecutiveFailures).toBe(1);

    const second = reduceConnectivity(first.model, { ok: false, reason: 'Failed to fetch' }, 20);
    expect(second.model.state).toEqual({
      status: 'offline',
      reason: 'Failed to fetch',
      code: 'BACKEND_UNREACHABLE',
      lastChecked: 20,
    });
    expect(second.model.consecutiveFailures).toBe(2);
  });

  it('flips offline to online on the first successful heartbeat', () => {
    const next = reduceConnectivity(model('offline', 2), { ok: true }, 30);

    expect(next.model.state).toEqual({
      status: 'online',
      reason: null,
      code: null,
      lastChecked: 30,
    });
    expect(next.model.consecutiveFailures).toBe(0);
    expect(next.reconnected).toBe(true);
  });

  it('records HTTP failure reasons and unreachable code once offline', () => {
    const first = reduceConnectivity(model('unknown'), { ok: false, reason: 'HTTP 503' }, 10);
    const second = reduceConnectivity(first.model, { ok: false, reason: 'HTTP 503' }, 20);

    expect(second.model.state.reason).toBe('HTTP 503');
    expect(second.model.state.code).toBe('BACKEND_UNREACHABLE');
  });

  it('uses 5s while online or unknown and 2s while offline', () => {
    expect(getConnectivityIntervalMs('online')).toBe(5000);
    expect(getConnectivityIntervalMs('unknown')).toBe(5000);
    expect(getConnectivityIntervalMs('offline')).toBe(2000);
  });
});

describe('connectivity heartbeat and hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('re-renders useConnectivity subscribers on heartbeat transition', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(200)),
    );
    const connectivity = await loadConnectivity();

    function Probe() {
      const state = connectivity.useConnectivity();
      return <div>{state.status}</div>;
    }

    render(<Probe />);
    expect(screen.getByText('unknown')).toBeInTheDocument();

    connectivity.startHeartbeat();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByText('online')).toBeInTheDocument();
  });

  it('captures HTTP and network failures from GET /api/health', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const connectivity = await loadConnectivity();

    connectivity.startHeartbeat();
    await vi.advanceTimersByTimeAsync(0);
    expect(connectivity.getConnectivity()).toMatchObject({
      status: 'unknown',
      reason: 'HTTP 503',
      code: null,
    });

    await vi.advanceTimersByTimeAsync(5000);
    expect(connectivity.getConnectivity()).toMatchObject({
      status: 'offline',
      reason: 'Failed to fetch',
      code: 'BACKEND_UNREACHABLE',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
