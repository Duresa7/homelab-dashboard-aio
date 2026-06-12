import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, apiJson, setAuthExpiredHandler } from './http';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HTTP API seam', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    setAuthExpiredHandler(null);
    vi.unstubAllGlobals();
  });

  it('throws the server error envelope for non-2xx JSON responses', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'not configured' }, 503));

    await expect(apiJson('/api/proxmox')).rejects.toThrow('not configured');
  });

  it('fires auth expiry for protected API 401 responses', async () => {
    const expired = vi.fn();
    setAuthExpiredHandler(expired);
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401));

    await apiFetch('/api/proxmox');

    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('does not fire auth expiry for auth API 401 responses', async () => {
    const expired = vi.fn();
    setAuthExpiredHandler(expired);
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, 401));

    await apiFetch('/api/auth/login');

    expect(expired).not.toHaveBeenCalled();
  });
});
