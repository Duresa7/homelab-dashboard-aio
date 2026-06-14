import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';

import { CAPABILITIES, getCapability } from '../capabilities/registry.js';
import { errorMessage } from '../lib/errors.js';
import {
  configFilePath,
  normalizeSqliteDataPath,
  resolveDbConfig,
  writeDbConfig,
  type DbConfigFile,
  type DbDriver,
  type ResolvedDbConfig,
  type SqliteSettings,
  type SqlServerSettings,
} from '../storage/config.js';
import { testDbConnection } from '../storage/factory.js';
import { assertAllowedHost } from '../lib/net-guard.js';
import { encryptSecretToString, getSecretKey, isEncryptedString } from '../lib/secrets.js';
import { makeSameOriginGuard } from '../state/index.js';
import type { StateStore } from '../storage/types.js';
import {
  ConfigError,
  getRedactedConfig,
  getStatus,
  markOnboardingComplete,
  readSelectionConfig,
  upsertSelection,
} from './integration-config.js';
import { normalizeTestBaseUrl, testIntegration } from './test-integration.js';

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
    try {
      if (statePath) sqlite.statePath = normalizeSqliteDataPath(statePath);
      if (siemPath) sqlite.siemPath = normalizeSqliteDataPath(siemPath);
    } catch (err) {
      throw new BadRequest(errorMessage(err));
    }
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

export function keepDbSecrets(file: DbConfigFile, current: ResolvedDbConfig): DbConfigFile {
  if (file.driver !== 'postgres' && file.driver !== 'mysql') return file;
  if (current.driver !== file.driver) return file;
  const incoming = file[file.driver];
  if (incoming?.password) return file;
  const prior = file.driver === 'postgres' ? current.postgres : current.mysql;
  if (!prior?.password) return file;
  // Only inherit the saved password when re-saving the SAME host — never carry
  // a stored credential over to a newly-specified destination.
  if (incoming?.host !== prior.host) return file;
  return { ...file, [file.driver]: { ...(incoming ?? {}), password: prior.password } };
}

/** Encrypt a freshly supplied DB password before it is written to disk. The
 * value here is always plaintext (resolveDbConfig decrypts on read and
 * keepDbSecrets inherits the decrypted value), so this never double-encrypts. */
async function encryptDbFilePassword(file: DbConfigFile): Promise<DbConfigFile> {
  if (
    file.driver === 'postgres' &&
    file.postgres?.password &&
    !isEncryptedString(file.postgres.password)
  ) {
    const key = await getSecretKey();
    return {
      ...file,
      postgres: { ...file.postgres, password: encryptSecretToString(file.postgres.password, key) },
    };
  }
  if (file.driver === 'mysql' && file.mysql?.password && !isEncryptedString(file.mysql.password)) {
    const key = await getSecretKey();
    return {
      ...file,
      mysql: { ...file.mysql, password: encryptSecretToString(file.mysql.password, key) },
    };
  }
  return file;
}

/** Reject a DB host in the link-local/metadata range (never a valid backend).
 * Loopback and private/public hosts are allowed — a database is commonly
 * co-located on localhost or reached as a managed cloud instance. */
async function assertDbHostAllowed(file: DbConfigFile): Promise<void> {
  const server =
    file.driver === 'postgres' ? file.postgres : file.driver === 'mysql' ? file.mysql : undefined;
  if (server?.host) await assertAllowedHost(server.host);
}

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

export function initSetup(
  app: Express,
  opts: {
    store?: StateStore;
    onSelectionChanged?: (capabilityId: string) => Promise<void> | void;
  } = {},
) {
  const { store } = opts;
  const sameOrigin = makeSameOriginGuard();
  const jsonBody = express.json({ limit: '64kb' });
  const parseJsonBody = (req: Request, res: Response, next: NextFunction) => {
    jsonBody(req, res, (err) => {
      if (err) return res.status(400).json({ error: 'invalid JSON body' });
      return next();
    });
  };

  function secretFieldsFor(capabilityId: string): string[] {
    const capability = getCapability(capabilityId);
    if (!capability) return [];
    return [
      ...new Set(
        capability.providers.flatMap((provider) =>
          provider.configSchema.filter((field) => field.secret).map((field) => field.name),
        ),
      ),
    ];
  }

  function baseUrlOf(config: Record<string, unknown>): string | null {
    if (typeof config.baseUrl !== 'string' || !config.baseUrl.trim()) return null;
    try {
      return normalizeTestBaseUrl(config.baseUrl);
    } catch {
      return null;
    }
  }

  function mergeTestConfig(
    capability: string,
    stored: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    const storedBaseUrl = baseUrlOf(stored);
    const incomingBaseUrl = baseUrlOf(incoming);
    // Require secrets whenever the incoming base URL differs from the stored
    // one — including when there is no usable stored base URL to anchor to.
    // Inheriting a stored secret is only safe when re-testing the same target.
    if (incomingBaseUrl && incomingBaseUrl !== storedBaseUrl) {
      const missing = secretFieldsFor(capability).filter(
        (field) => typeof incoming[field] !== 'string' || !String(incoming[field]).trim(),
      );
      if (missing.length) {
        throw new BadRequest(
          `secret fields are required when testing a different base URL: ${missing.join(', ')}`,
        );
      }
    }
    return { ...stored, ...incoming };
  }

  app.get('/api/setup/capabilities', (_req: Request, res: Response) => {
    res.json({ capabilities: CAPABILITIES });
  });

  app.get('/api/setup/db', (_req: Request, res: Response) => {
    res.json(redactDbConfig(resolveDbConfig()));
  });

  app.post('/api/setup/db/test', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    let file: DbConfigFile;
    try {
      file = parseDbConfigFile(req.body);
    } catch (err) {
      return res.status(400).json({ ok: false, error: errorMessage(err) });
    }
    file = keepDbSecrets(file, resolveDbConfig({ env: {}, configPath: configFilePath() }));
    try {
      await assertDbHostAllowed(file);
    } catch (err) {
      return res.status(400).json({ ok: false, error: errorMessage(err) });
    }
    try {
      await testDbConnection(resolveDbConfig({ env: {}, file }));
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: errorMessage(err) });
    }
  });

  app.post('/api/setup/db', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    let file: DbConfigFile;
    try {
      file = parseDbConfigFile(req.body);
    } catch (err) {
      return res.status(400).json({ ok: false, error: errorMessage(err) });
    }
    file = keepDbSecrets(file, resolveDbConfig({ env: {}, configPath: configFilePath() }));
    try {
      await assertDbHostAllowed(file);
    } catch (err) {
      return res.status(400).json({ ok: false, error: errorMessage(err) });
    }
    try {
      await testDbConnection(resolveDbConfig({ env: {}, file }));
    } catch (err) {
      return res.status(502).json({ ok: false, error: `connection failed: ${errorMessage(err)}` });
    }
    try {
      const toStore = await encryptDbFilePassword(file);
      await writeDbConfig(toStore, configFilePath());
      res.json({ ok: true, restartRequired: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  app.get('/api/setup/status', async (_req: Request, res: Response) => {
    if (!store) return res.status(503).json({ error: 'database unavailable' });
    res.json(await getStatus(store));
  });

  app.get('/api/setup/config', async (_req: Request, res: Response) => {
    if (!store) return res.status(503).json({ error: 'database unavailable' });
    res.json(await getRedactedConfig(store));
  });

  app.post(
    '/api/setup/complete',
    sameOrigin,
    parseJsonBody,
    async (req: Request, res: Response) => {
      if (!store) return res.status(503).json({ ok: false, error: 'database unavailable' });
      try {
        const complete = (req.body as { complete?: unknown } | undefined)?.complete !== false;
        await markOnboardingComplete(store, complete);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ ok: false, error: errorMessage(err) });
      }
    },
  );

  app.put('/api/setup/config', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    if (!store) return res.status(503).json({ ok: false, error: 'database unavailable' });
    try {
      await upsertSelection(store, req.body);
      const capabilityId =
        req.body && typeof req.body === 'object' && typeof req.body.capability === 'string'
          ? req.body.capability
          : '';
      if (capabilityId && opts.onSelectionChanged) await opts.onSelectionChanged(capabilityId);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof ConfigError) {
        return res.status(400).json({ ok: false, error: errorMessage(err) });
      }
      res.status(500).json({ ok: false, error: errorMessage(err) });
    }
  });

  app.post('/api/setup/test', sameOrigin, parseJsonBody, async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { capability?: unknown; config?: unknown };
    const capability = typeof body.capability === 'string' ? body.capability : '';
    if (!getCapability(capability)) {
      return res.status(400).json({ ok: false, error: 'unknown capability' });
    }
    const incoming =
      body.config && typeof body.config === 'object'
        ? (body.config as Record<string, unknown>)
        : {};
    const stored = store ? await readSelectionConfig(store, capability) : {};
    let config: Record<string, unknown>;
    try {
      config = mergeTestConfig(capability, stored, incoming);
    } catch (err) {
      return res.status(400).json({ ok: false, error: errorMessage(err) });
    }
    const result = await testIntegration(capability, config);
    res.json(result);
  });
}
