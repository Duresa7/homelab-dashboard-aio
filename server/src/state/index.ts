import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import path from 'node:path';

import { openStateDb } from './db.js';

const RESERVED_KEYS = new Set([
  'inventory',
  'route',
  'thresholds',
  'tempUnit',
  'tweaks',
  'sidebarCollapsed',
  'sidebarExpanded',
  'bookmarksOrder',
]);

function isAllowedKey(key: unknown): boolean {
  if (typeof key !== 'string') return false;
  if (RESERVED_KEYS.has(key)) return true;
  return /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/.test(key);
}

// Same-origin check for mutating requests. The dashboard is LAN-exposed and
// has no per-user auth, so we rely on the browser's same-origin guarantees:
// only pages served from this server (or the Vite dev origin during local
// development) may issue mutating calls. CSRF-style requests from a
// malicious LAN-local page get rejected.
function makeSameOriginGuard() {
  const allow = new Set<string>();
  const extra = String(process.env.STATE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of extra) allow.add(o);
  return function sameOriginGuard(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    // Allow CLI / server-internal calls (no Origin AND no Referer — never
    // a browser-cross-origin request, which would always carry Origin).
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

// Reject body shapes that callers in this app never send. `null` in
// particular passes JSON.parse but downstream consumers (loadInventory,
// loadOrder, thresholds.load) all treat null as "no value" → which would
// silently wipe the user's saved data when persisted back via PUT.
function isValidStateBody(body: unknown): boolean {
  if (body === null || body === undefined) return false;
  const t = typeof body;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(body)) return true;
  if (t === 'object') return true;
  return false;
}

export async function initState(app: Express, opts: { dbPath?: string } = {}) {
  const { dbPath = path.resolve('data/dashboard.sqlite') } = opts;

  const db = await openStateDb(dbPath);
  const jsonBody = express.json({ limit: '4mb', strict: false });
  const parseJsonBody = (req: Request, res: Response, next: NextFunction) => {
    jsonBody(req, res, (err) => {
      if (err) return res.status(400).json({ error: 'invalid JSON body' });
      return next();
    });
  };
  const sameOrigin = makeSameOriginGuard();

  app.get('/api/state', (_req: Request, res: Response) => {
    const { values, updatedAt } = db.getAll();
    res.json({ values, updatedAt });
  });

  app.get('/api/state/debug', async (_req: Request, res: Response) => {
    res.json(await db.stats());
  });

  app.get('/api/state/:key', (req: Request, res: Response) => {
    const { key } = req.params;
    if (!isAllowedKey(key)) return res.status(400).json({ error: 'invalid key' });
    const row = db.get(key);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(row);
  });

  app.put('/api/state/:key', sameOrigin, parseJsonBody, (req: Request, res: Response) => {
    const { key } = req.params;
    if (!isAllowedKey(key)) return res.status(400).json({ error: 'invalid key' });
    if (!isValidStateBody(req.body)) {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    const updatedAt = db.put(key, req.body);
    res.json({ key, updatedAt });
  });

  app.delete('/api/state/:key', sameOrigin, (req: Request, res: Response) => {
    const { key } = req.params;
    if (!isAllowedKey(key)) return res.status(400).json({ error: 'invalid key' });
    const removed = db.delete(key);
    res.json({ key, removed });
  });

  app.post('/api/state/_import', sameOrigin, parseJsonBody, (req: Request, res: Response) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'body must be a JSON object of key→value pairs' });
    }
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (isAllowedKey(k) && isValidStateBody(v)) filtered[k] = v;
    }
    const imported = db.importBulk(filtered);
    res.json({ imported, keys: Object.keys(filtered) });
  });

  function shutdown() {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }

  return { shutdown };
}
