import { useEffect, useSyncExternalStore } from 'react';

import { getState, setState, subscribe as subscribeState } from './store';

export const DEFAULT_SITE_NAME = 'homelab.local';
export const SITE_NAME_KEY = 'siteName';

export interface SiteNameParts {
  name: string;
  prefix: string;
  suffix: string | null;
}

export function normalizeSiteName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SITE_NAME;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_SITE_NAME;
}

export function readSiteNameRaw(): string {
  const stored = getState<unknown>(SITE_NAME_KEY, DEFAULT_SITE_NAME);
  return typeof stored === 'string' ? stored : DEFAULT_SITE_NAME;
}

export function readSiteName(): string {
  return normalizeSiteName(readSiteNameRaw());
}

export function setSiteName(value: string): void {
  setState<string>(SITE_NAME_KEY, value);
}

export function subscribeSiteName(fn: () => void): () => void {
  return subscribeState(SITE_NAME_KEY, fn);
}

export function splitSiteName(value: unknown): SiteNameParts {
  const name = normalizeSiteName(value);
  const dot = name.lastIndexOf('.');
  if (dot === -1) return { name, prefix: name, suffix: null };
  return { name, prefix: name.slice(0, dot), suffix: name.slice(dot) };
}

export function useSiteName(): string {
  return useSyncExternalStore(subscribeSiteName, readSiteName, () => DEFAULT_SITE_NAME);
}

export function useSiteNameRaw(): string {
  return useSyncExternalStore(subscribeSiteName, readSiteNameRaw, () => DEFAULT_SITE_NAME);
}

export function useSiteTitleSync(): void {
  const siteName = useSiteName();

  useEffect(() => {
    if (typeof document !== 'undefined') document.title = siteName;
  }, [siteName]);
}
