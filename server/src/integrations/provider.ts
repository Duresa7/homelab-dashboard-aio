import type { Express, Request, Response } from 'express';

import { errorMessage } from '../lib/errors.js';
import { isDebugEndpointEnabled, isEnabled } from '../lib/env.js';
import type { Selection } from '../setup/integration-config.js';
import type { IntegrationStatus } from '../types.js';

export interface ProviderStatus extends IntegrationStatus {
  hasKey?: boolean;
}

export type ProviderStatusSource = ProviderStatus | (() => ProviderStatus);

export interface ProviderBase {
  id: string;
  capabilityId: string;
  healthId?: string;
  logName: string;
  status: ProviderStatusSource;
  configure(selection: Selection | undefined): void | Promise<void>;
  probe?(timeoutMs: number): Promise<unknown> | unknown;
  debug?(): Promise<unknown> | unknown;
  debugPath?: string;
  notConfiguredMessage: string;
  errorLogLevel?: 'error' | 'warn';
}

export interface Provider<T = unknown> extends ProviderBase {
  fetch(): Promise<T>;
}

export interface RuntimeProvider<T = unknown> extends ProviderBase {
  fetch?(): Promise<T>;
}

export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return isEnabled(value, fallback);
  return fallback;
}

export function selectionConfig(selection: Selection | undefined): Record<string, unknown> {
  return selection?.config ?? {};
}

export function readProviderStatus(provider: ProviderBase): ProviderStatus {
  return typeof provider.status === 'function' ? provider.status() : provider.status;
}

export function registerProvider(app: Express, provider: RuntimeProvider<unknown>): void {
  const fetch = provider.fetch;
  if (!fetch) return;

  app.get(`/api/${provider.id}`, async (_req: Request, res: Response) => {
    const status = readProviderStatus(provider);
    if (!status.enabled) return res.json({ disabled: true });
    if (!status.configured) {
      return res.status(503).json({ error: provider.notConfiguredMessage });
    }
    try {
      res.json(await fetch());
    } catch (err) {
      const message = errorMessage(err);
      const logger = provider.errorLogLevel === 'warn' ? console.warn : console.error;
      logger(`${provider.logName} API error:`, message);
      res.status(502).json({ error: message });
    }
  });

  if (!provider.debug) return;
  app.get(
    provider.debugPath ?? `/api/${provider.id}/debug`,
    async (_req: Request, res: Response) => {
      if (!isDebugEndpointEnabled()) return res.status(404).json({ error: 'Not found' });
      if (!readProviderStatus(provider).enabled) return res.json({ disabled: true });
      try {
        res.json(await provider.debug?.());
      } catch (err) {
        res.status(502).json({ error: errorMessage(err) });
      }
    },
  );
}
