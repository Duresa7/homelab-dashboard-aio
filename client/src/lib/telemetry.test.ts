import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectivityState } from './connectivity';
import type { DockerApiResponse } from '../types';

const INITIAL_CONNECTIVITY: ConnectivityState = {
  status: 'online',
  reason: null,
  code: null,
  lastChecked: null,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function loadTelemetry(connectivity: ConnectivityState = INITIAL_CONNECTIVITY) {
  vi.resetModules();
  vi.doMock('./connectivity', () => ({
    getConnectivity: () => connectivity,
  }));
  return import('./telemetry');
}

describe('telemetry pollers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock('./connectivity');
    vi.resetModules();
  });

  it('backs off without fetching while connectivity is offline', async () => {
    const connectivity: ConnectivityState = {
      status: 'offline',
      reason: 'Failed to fetch',
      code: 'BACKEND_UNREACHABLE',
      lastChecked: 10,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const telemetry = await loadTelemetry(connectivity);

    telemetry.setIntegrationEnabled('docker', true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(telemetry.getTelemetryState().docker).toMatchObject({
      status: 'stale',
      lastError: 'Failed to fetch',
      staleReason: 'Failed to fetch',
    });
  });

  it('surfaces HTTP errors into telemetry state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: 'Portainer not configured' }, 503)),
    );
    const telemetry = await loadTelemetry();

    telemetry.setIntegrationEnabled('docker', true);

    await vi.waitFor(() => {
      expect(telemetry.getTelemetryState().docker).toMatchObject({
        status: 'error',
        lastError: 'Portainer not configured',
        staleReason: 'Fetch failed',
      });
    });
  });

  it('applies typed endpoint payloads and marks the poller healthy', async () => {
    const payload = {
      docker: {
        running: 1,
        stopped: 0,
        total: 1,
        updates: 0,
        hosts: [
          {
            id: '1',
            name: 'container-host',
            addr: '198.51.100.10',
            os: 'Debian',
            engine: '27.0',
            cpu: 10,
            ram: 20,
            status: 'online',
          },
        ],
        containers: [
          {
            name: 'dashboard',
            host: '1',
            image: 'ghcr.io/example/dashboard:latest',
            state: 'running',
            cpu: 1,
            memMB: 128,
            uptime: '1h',
            stack: 'homelab',
          },
        ],
      },
    } satisfies DockerApiResponse;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(payload)),
    );
    const telemetry = await loadTelemetry();

    telemetry.setIntegrationEnabled('docker', true);

    await vi.waitFor(() => {
      expect(telemetry.getDashState().docker.total).toBe(1);
      expect(telemetry.getTelemetryState().docker.status).toBe('ok');
    });
  });
});
