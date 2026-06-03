// First-run / Settings database setup API. Lets the UI test a backend connection
// and persist the choice to the bootstrap config file (outside any DB). The
// onboarding-wizard step and live hot-swap are layered on by vendor-onboarding;
// a saved change here applies at next boot (restartRequired), since the store
// layer is opened once at startup.
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';

import { CAPABILITIES } from '../capabilities/registry.js';
import { errorMessage } from '../lib/errors.js';
import {
  configFilePath,
  resolveDbConfig,
  writeDbConfig,
  type DbConfigFile,
  type DbDriver,
  type ResolvedDbConfig,
  type SqliteSettings,
  type SqlServerSettings,
} from '../storage/config.js';
import { testDbConnection } from '../storage/factory.js';
import { makeSameOriginGuard } from '../state/index.js';

class BadRequest extends Error {}

function normalizeDriver(value: unknown): DbDriver | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value.trim().toLowerCase()) {
    case 'sqlite':
      return 'sqlite';
    case 'postgres':
    case 'postgresql':
      return 'postgres';
    case 'mysql':
    case 'mariadb':
      return 'mysql';
    default:
      return undefined;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Validate untrusted request bodies into a DbConfigFile. Throws BadRequest. */
function parseDbConfigFile(input: unknown): DbConfigFile {
  if (!input || typeof input !== 'object') throw new BadRequest('body must be a JSON object');
  const body = input as Record<string, unknown>;
  const driver = normalizeDriver(body.driver);
  if (!driver) throw new BadRequest('driver must be one of: sqlite, postgres, mysql');

  if (driver === 'sqlite') {
    const sIn = (body.sqlite ?? {}) as Record<string, unknown>;
    const sqlite: Partial<SqliteSettings> = {};
    const statePath = asString(sIn.statePath);
    const siemPath = asString(sIn.siemPath);
    if (statePath) sqlite.statePath = statePath;
    if (siemPath) sqlite.siemPath = siemPath;
    return { driver, sqlite };
  }

  const cIn = (body[driver] ?? body.connection) as Record<string, unknown> | undefined;
  if (!cIn || typeof cIn !== 'object') {
    throw new BadRequest(`${driver} connection settings are required`);
  }
  const host = asString(cIn.host);
  const database = asString(cIn.database);
  const user = asString(cIn.user);
  if (!host || !database || !user) {
    throw new BadRequest('host, database, and user are required');
  }
  const server: Partial<SqlServerSettings> = { host, database, user };
  if (cIn.port !== undefined && cIn.port !== null && cIn.port !== '') {
    const port = Number(cIn.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequest('port must be an integer from 1 to 65535');
    }
    server.port = port;
  }
  if (typeof cIn.password === 'string') server.password = cIn.password;
  if (typeof cIn.ssl === 'boolean') server.ssl = cIn.ssl;
  return { driver, [driver]: server };
}

/** Current backend for display — connection details minus the password. */
export function redactDbConfig(config: ResolvedDbConfig): Record<string, unknown> {
  if (config.driver === 'postgres' && config.postgres) {
    const { password, ...rest } = config.postgres;
    return { driver: config.driver, postgres: { ...rest, hasPassword: Boolean(password) } };
  }
  if (config.driver === 'mysql' && config.mysql) {
    const { password, ...rest } = config.mysql;
    return { driver: config.driver, mysql: { ...rest, hasPassword: Boolean(password) } };
  }
  return { driver: config.driver, sqlite: config.sqlite };
}

export function initSetup(app: Express) {
  const sameOrigin = makeSameOriginGuard();
  const jsonBody = express.json({ limit: '64kb' });
  const parseJsonBody = (req: Request, res: Response, next: NextFunction) => {
    jsonBody(req, res, (err) => {
      if (err) return res.status(400).json({ error: 'invalid JSON body' });
      return next();
    });
  };

  // Capability/vendor registry — read-only metadata the onboarding UI renders
  // from (no secrets; describes which fields exist, not their values).
  app.get('/api/setup/capabilities', (_req: Request, res: Response) => {
    res.json({ capabilities: CAPABILITIES });
  });

  // Current backend (password never returned).
  app.get('/api/setup/db', (_req: Request, res: Response) => {
    res.json(redactDbConfig(resolveDbConfig()));
  });

  // Test a candidate connection without persisting anything.
  app.post('/api/setup/db/test', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    let file: DbConfigFile;
    try {
      file = parseDbConfigFile(req.body);
    } catch (err) {
      return res.status(400).json({ ok: false, error: errorMessage(err) });
    }
    try {
      await testDbConnection(resolveDbConfig({ env: {}, file }));
      res.json({ ok: true });
    } catch (err) {
      // The test ran; the connection failed — report it, don't 500.
      res.json({ ok: false, error: errorMessage(err) });
    }
  });

  // Persist the backend selection to the bootstrap config (applies on restart).
  // Connection is validated first so a bad config can't replace a working one.
  app.post('/api/setup/db', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    let file: DbConfigFile;
    try {
      file = parseDbConfigFile(req.body);
    } catch (err) {
      return res.status(400).json({ ok: false, error: errorMessage(err) });
    }
    try {
      await testDbConnection(resolveDbConfig({ env: {}, file }));
    } catch (err) {
      return res.status(502).json({ ok: false, error: `connection failed: ${errorMessage(err)}` });
    }
    try {
      await writeDbConfig(file, configFilePath());
      res.json({ ok: true, restartRequired: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });
}
