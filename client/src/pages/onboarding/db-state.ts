import type { DbConfigBody, DbConfigView, DbDriver, SqlServerConfig } from '@/lib/setup';

export interface DbServerDraft extends Required<Omit<SqlServerConfig, 'ssl'>> {
  ssl?: boolean;
  hasPassword?: boolean;
}

export interface DbDraft {
  driver: DbDriver;
  sqlite: { statePath: string; siemPath: string };
  postgres: DbServerDraft;
  mysql: DbServerDraft;
}

export interface DbStepStatus {
  busy: boolean;
  message: string;
  restartRequired: boolean;
}

export const EMPTY_DB_DRAFT: DbDraft = {
  driver: 'sqlite',
  sqlite: { statePath: '', siemPath: '' },
  postgres: {
    host: '',
    port: 5432,
    database: '',
    user: '',
    password: '',
    ssl: false,
  },
  mysql: {
    host: '',
    port: 3306,
    database: '',
    user: '',
    password: '',
  },
};

export function dbDraftFromView(view: DbConfigView): DbDraft {
  const draft = structuredClone(EMPTY_DB_DRAFT);
  draft.driver = view.driver;
  draft.sqlite = {
    statePath: view.sqlite?.statePath ?? '',
    siemPath: view.sqlite?.siemPath ?? '',
  };
  if (view.driver === 'postgres') {
    draft.postgres = {
      ...draft.postgres,
      ...view.postgres,
      password: '',
      hasPassword: view.postgres.hasPassword,
    };
  }
  if (view.driver === 'mysql') {
    draft.mysql = {
      ...draft.mysql,
      ...view.mysql,
      password: '',
      hasPassword: view.mysql.hasPassword,
    };
  }
  return draft;
}

function cleanServer(server: DbServerDraft): SqlServerConfig {
  const out: SqlServerConfig = {
    host: server.host,
    database: server.database,
    user: server.user,
  };
  if (server.port) out.port = Number(server.port);
  if (server.password) out.password = server.password;
  if (server.ssl !== undefined) out.ssl = server.ssl;
  return out;
}

export function dbBodyFromDraft(draft: DbDraft): DbConfigBody {
  if (draft.driver === 'sqlite') {
    return {
      driver: 'sqlite',
      sqlite: {
        ...(draft.sqlite.statePath ? { statePath: draft.sqlite.statePath } : {}),
        ...(draft.sqlite.siemPath ? { siemPath: draft.sqlite.siemPath } : {}),
      },
    };
  }
  if (draft.driver === 'postgres')
    return { driver: 'postgres', postgres: cleanServer(draft.postgres) };
  return { driver: 'mysql', mysql: cleanServer(draft.mysql) };
}

export function dbDirty(a: DbDraft, b: DbDraft): boolean {
  return JSON.stringify(dbBodyFromDraft(a)) !== JSON.stringify(dbBodyFromDraft(b));
}
