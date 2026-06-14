import { useSyncExternalStore } from 'react';

import { apiJson } from './http';
import { getState, setState, subscribe } from './store';
import { useApiResource, type ApiResource } from './use-api-resource';
import type { UpdateStatus } from '@/types';

// The server caches the GitHub result for 6h, so the client only re-reads that
// cache occasionally to surface a newly-detected release without a full reload.
const POLL_MS = 30 * 60 * 1000;
const NOTIFICATIONS_KEY = 'updateNotifications';
const TOAST_SEEN_KEY = 'updateToastSeenVersion';

export function useUpdateStatus(enabled = true): ApiResource<UpdateStatus> {
  return useApiResource<UpdateStatus>(enabled ? '/api/update' : null, { pollMs: POLL_MS });
}

/** Whether the in-app update indicator (badge + toast) is shown. Persisted per-user. */
export function useUpdateNotifications(): boolean {
  return useSyncExternalStore(
    (cb) => subscribe(NOTIFICATIONS_KEY, cb),
    () => getState<boolean>(NOTIFICATIONS_KEY, true),
  );
}

export function setUpdateNotifications(value: boolean): void {
  setState<boolean>(NOTIFICATIONS_KEY, value);
}

export function getToastSeenVersion(): string | null {
  return getState<string | null>(TOAST_SEEN_KEY, null);
}

export function setToastSeenVersion(version: string): void {
  setState<string>(TOAST_SEEN_KEY, version);
}

/** Force the server to re-check GitHub now (admin only). Returns the fresh status. */
export function forceUpdateCheck(): Promise<UpdateStatus> {
  return apiJson<UpdateStatus>('/api/update/check', { method: 'POST' });
}
