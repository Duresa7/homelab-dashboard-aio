import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

async function loadSetup() {
  vi.resetModules();
  return import('./setup');
}

describe('setup API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses setup status', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ onboardingComplete: false, configuredCapabilities: ['network'] }),
    );
    const setup = await loadSetup();

    await expect(setup.getSetupStatus()).resolves.toEqual({
      onboardingComplete: false,
      configuredCapabilities: ['network'],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/setup/status', undefined);
  });

  it('sends a PUT selection body', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const setup = await loadSetup();

    await setup.putSelection({
      capability: 'network',
      vendor: 'unifi',
      enabled: true,
      config: { baseUrl: 'https://gateway.local', apiKey: 'secret' },
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/setup/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capability: 'network',
        vendor: 'unifi',
        enabled: true,
        config: { baseUrl: 'https://gateway.local', apiKey: 'secret' },
      }),
    });
  });

  it('returns failed test results without throwing on 200 responses', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: 'HTTP 401' }));
    const setup = await loadSetup();

    await expect(setup.testIntegration({ capability: 'network', config: {} })).resolves.toEqual({
      ok: false,
      error: 'HTTP 401',
    });
  });

  it('throws the server error string on non-2xx responses', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: false, error: 'missing required field' }, false, 400),
    );
    const setup = await loadSetup();

    await expect(
      setup.putSelection({ capability: 'network', vendor: 'unifi', config: {} }),
    ).rejects.toThrow('missing required field');
  });
});
