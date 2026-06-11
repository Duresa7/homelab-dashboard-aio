import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';

import { isDebugEndpointEnabled } from '../lib/env.js';
import type { StateStore } from '../storage/types.js';

const RESERVED_KEYS = new Set([
  'inventory',
  'route',
  'thresholds',
  'tempUnit',
  'tweaks',
  'siteName',
  'sidebarCollapsed',
  'sidebarExpanded',
  'bookmarks',
  'bookmarkGroups',
]);
const RETIRED_KEYS = new Set(['bookmarksOrder']);

const INTERNAL_KEY_PREFIX = 'setup.';

function isAllowedKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (key.startsWith(INTERNAL_KEY_PREFIX)) return false;
  if (RETIRED_KEYS.has(key)) return false;
  if (RESERVED_KEYS.has(key)) return true;
  return /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(key);
}

export function makeSameOriginGuard() {
  const allow = new Set<string>();
  const extra = String(process.env.STATE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of extra) allow.add(o);
  return function sameOriginGuard(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;

    if (!origin && !referer) return next();
    const host = req.headers.host;
    if (!host) return res.status(403).json({ error: 'missing Host' });
    const expected = new Set([`http://${host}`, `https://${host}`]);
    for (const o of allow) expected.add(o);
    const source =
      origin ||
      (() => {
        try {
          return new URL(String(referer)).origin;
        } catch {
          return null;
        }
      })();
    if (typeof source !== 'string' || !expected.has(source)) {
      return res.status(403).json({ error: 'cross-origin write rejected' });
    }
    return next();
  };
}

function isValidStateBody(body: unknown): boolean {
  if (body === null || body === undefined) return false;
  const t = typeof body;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(body)) return true;
  if (t === 'object') return true;
  return false;
}

export async function initState(app: Express, opts: { store: StateStore }) {
  const db = opts.store;
  const jsonBody = express.json({ limit: '4mb', strict: false });
  const parseJsonBody = (req: Request, res: Response, next: NextFunction) => {
    jsonBody(req, res, (err) => {
      if (err) return res.status(400).json({ error: 'invalid JSON body' });
      return next();
    });
  };
  const sameOrigin = makeSameOriginGuard();

  const dbError = (res: Response, err: unknown) =>
    res.status(500).json({ error: err instanceof Error ? err.message : 'state store error' });

  app.get('/api/state', async (_req: Request, res: Response) => {
    try {
      const { values, updatedAt } = await db.getAll();

      for (const key of Object.keys(values)) {
        if (key.startsWith(INTERNAL_KEY_PREFIX)) {
          delete values[key];
          delete updatedAt[key];
        }
      }
      res.json({ values, updatedAt });
    } catch (err) {
      dbError(res, err);
    }
  });

  app.get('/api/state/debug', async (_req: Request, res: Response) => {
    if (!isDebugEndpointEnabled()) return res.status(404).json({ error: 'Not found' });
    try {
      res.json(await db.stats());
    } catch (err) {
      dbError(res, err);
    }
  });

  app.get('/api/state/:key', async (req: Request, res: Response) => {
    const { key } = req.params;
    if (!isAllowedKey(key)) return res.status(400).json({ error: 'invalid key' });
    try {
      const row = await db.get(key);
      if (!row) return res.status(404).json({ error: 'not found' });
      res.json(row);
    } catch (err) {
      dbError(res, err);
    }
  });

  app.put('/api/state/:key', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    const { key } = req.params;
    if (!isAllowedKey(key)) return res.status(400).json({ error: 'invalid key' });
    if (!isValidStateBody(req.body)) {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    try {
      const updatedAt = await db.put(key, req.body);
      res.json({ key, updatedAt });
    } catch (err) {
      dbError(res, err);
    }
  });

  app.delete('/api/state/:key', sameOrigin, async (req: Request, res: Response) => {
    const { key } = req.params;
    if (!isAllowedKey(key)) return res.status(400).json({ error: 'invalid key' });
    try {
      const removed = await db.delete(key);
      res.json({ key, removed });
    } catch (err) {
      dbError(res, err);
    }
  });

  app.post('/api/state/_import', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'body must be a JSON object of key→value pairs' });
    }
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (isAllowedKey(k) && isValidStateBody(v)) filtered[k] = v;
    }
    try {
      const imported = await db.importBulk(filtered);
      res.json({ imported, keys: Object.keys(filtered) });
    } catch (err) {
      dbError(res, err);
    }
  });

  function shutdown() {
    void db.close().catch(() => {
      void 0;
    });
  }

  return { shutdown };
}
