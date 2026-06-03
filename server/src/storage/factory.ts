// Store factory: opens both stores for the resolved backend. Today only SQLite
// is implemented; the Postgres/MySQL adapters (issues 03/04) plug in here behind
// the same StateStore / SiemStore contracts.
import { openSiemDb } from '../siem/db.js';
import { openStateDb } from '../state/db.js';
import type { ResolvedDbConfig } from './config.js';
import type { Stores } from './types.js';

export async function openStores(config: ResolvedDbConfig): Promise<Stores> {
  if (config.driver !== 'sqlite') {
    throw new Error(
      `database driver "${config.driver}" is not implemented yet (see pluggable-database issues 03/04)`,
    );
  }
  const [state, siem] = await Promise.all([
    openStateDb(config.sqlite.statePath),
    openSiemDb(config.sqlite.siemPath),
  ]);
  return { state, siem };
}
