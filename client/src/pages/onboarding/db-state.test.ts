import { describe, expect, it } from 'vitest';

import { dbBodyFromDraft, dbDirty, dbDraftFromView, EMPTY_DB_DRAFT } from './db-state';

describe('database setup state', () => {
  it('converts redacted server config into an editable draft without passwords', () => {
    const draft = dbDraftFromView({
      driver: 'postgres',
      sqlite: { statePath: './data/state.sqlite', siemPath: './data/siem.sqlite' },
      postgres: {
        host: 'db.local',
        port: 5432,
        database: 'dash',
        user: 'dash',
        hasPassword: true,
      },
    });

    expect(draft.driver).toBe('postgres');
    expect(draft.postgres.password).toBe('');
    expect(draft.postgres.hasPassword).toBe(true);
  });

  it('serializes only the active driver body and detects changes', () => {
    const draft = {
      ...EMPTY_DB_DRAFT,
      driver: 'mysql' as const,
      mysql: {
        ...EMPTY_DB_DRAFT.mysql,
        host: 'db.local',
        database: 'dash',
        user: 'dash',
      },
    };

    expect(dbBodyFromDraft(draft)).toEqual({
      driver: 'mysql',
      mysql: { host: 'db.local', port: 3306, database: 'dash', user: 'dash' },
    });
    expect(dbDirty(draft, EMPTY_DB_DRAFT)).toBe(true);
  });
});
