import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import type { Config } from '../config.js';

/** What queries need: parameterised SQL ($1, $2…) only. */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs a statement and returns the number of rows it changed. */
  run(sql: string, params?: unknown[]): Promise<number>;
  /** Several statements, no parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface DB extends Queryable {
  /** Runs `fn` in a transaction: committed if it resolves, rolled back if it throws. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
}

export async function one<T>(
  q: Queryable,
  sql: string,
  params?: unknown[],
): Promise<T | undefined> {
  return (await q.query<T>(sql, params))[0];
}

function fromPgClient(c: pg.Pool | pg.PoolClient): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return (await c.query(sql, params)).rows as T[];
    },
    async run(sql, params) {
      return (await c.query(sql, params)).rowCount ?? 0;
    },
    async exec(sql) {
      await c.query(sql);
    },
  };
}

/** Postgres over the network, e.g. Neon in production. */
function postgres(url: string): DB {
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  pool.on('error', (err) => console.error('Postgres pool error:', err.message));
  return {
    kind: 'postgres',
    ...fromPgClient(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(fromPgClient(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

type PgliteLike = Pick<PGlite, 'query' | 'exec'>;

function fromPglite(c: PgliteLike): Queryable {
  return {
    async query<T>(sql: string, params?: unknown[]) {
      return (await c.query<T>(sql, params)).rows;
    },
    async run(sql, params) {
      return (await c.query(sql, params)).affectedRows ?? 0;
    },
    async exec(sql) {
      await c.exec(sql);
    },
  };
}

/** Embedded Postgres (WASM) for local development and tests: no server to install. */
export async function pglite(dir: string): Promise<DB> {
  if (dir !== 'memory') fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir === 'memory' ? undefined : dir);
  return {
    kind: 'pglite',
    ...fromPglite(db),
    tx: (fn) => db.transaction((t) => fn(fromPglite(t))),
    close: () => db.close(),
  };
}

export function openDb(config: Pick<Config, 'databaseUrl' | 'pgliteDir'>): Promise<DB> {
  return config.databaseUrl
    ? Promise.resolve(postgres(config.databaseUrl))
    : pglite(config.pgliteDir);
}

export const nowIso = (): string => new Date().toISOString();
