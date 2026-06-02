import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStateDb } from './db.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'homelab-statedb-test-'));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('state DB schema migrations', () => {
  it('stamps user_version on a fresh DB and re-open is idempotent', async () => {
    const dbPath = path.join(tempDir, 'state.sqlite');

    const db = await openStateDb(dbPath);
    expect((await db.stats()).schemaVersion).toBe(1);
    db.put('tempUnit', 'f');
    db.close();

    // Re-open: version is already at HEAD so the migration loop is a no-op,
    // and the previously-written row survives.
    const reopened = await openStateDb(dbPath);
    expect((await reopened.stats()).schemaVersion).toBe(1);
    expect(reopened.get('tempUnit')?.value).toBe('f');
    reopened.close();
  });
});
