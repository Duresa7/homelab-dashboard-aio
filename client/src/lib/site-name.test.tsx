import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadSiteNameModules() {
  vi.resetModules();
  const store = await import('./store');
  const siteName = await import('./site-name');
  return { store, siteName };
}

describe('site name preference', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }) as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('normalizes blank and non-string values to the default', async () => {
    const { siteName } = await loadSiteNameModules();

    expect(siteName.normalizeSiteName(' ops.local ')).toBe('ops.local');
    expect(siteName.normalizeSiteName('   ')).toBe(siteName.DEFAULT_SITE_NAME);
    expect(siteName.normalizeSiteName(null)).toBe(siteName.DEFAULT_SITE_NAME);
  });

  it('splits the muted suffix on the last dot', async () => {
    const { siteName } = await loadSiteNameModules();

    expect(siteName.splitSiteName('rack.lab.local')).toEqual({
      name: 'rack.lab.local',
      prefix: 'rack.lab',
      suffix: '.local',
    });
    expect(siteName.splitSiteName('rack')).toEqual({
      name: 'rack',
      prefix: 'rack',
      suffix: null,
    });
  });

  it('syncs document.title when siteName changes', async () => {
    const { siteName } = await loadSiteNameModules();

    function TitleSyncHarness() {
      siteName.useSiteTitleSync();
      return null;
    }

    render(<TitleSyncHarness />);

    await waitFor(() => expect(document.title).toBe(siteName.DEFAULT_SITE_NAME));

    act(() => {
      siteName.setSiteName('rack.local');
    });

    await waitFor(() => expect(document.title).toBe('rack.local'));
  });
});
