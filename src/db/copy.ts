import { one, type DB, type Queryable } from './connection.js';
import { migrate } from './migrate.js';

/**
 * Tables copied, parents before children so foreign keys are satisfied. Sessions are left out:
 * visitors and the admin simply sign in again on the new database.
 */
export const COPY_TABLES = [
  'profile',
  'courses',
  'files',
  'file_blobs',
  'materials',
  'announcements',
  'admins',
] as const;

/** Uploaded file bytes can be large, so they are copied one row at a time instead of all at once. */
const ONE_ROW_AT_A_TIME = new Set<string>(['file_blobs']);

/** Columns filled by GENERATED ALWAYS AS IDENTITY; their sequence is moved past the copied ids. */
const IDENTITY_COLUMNS: Record<string, string> = { admins: 'id' };

export type CopyCounts = Record<string, number>;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function count(q: Queryable, table: string): Promise<number> {
  const row = await one<{ n: number | string }>(q, `SELECT count(*) AS n FROM ${quote(table)}`);
  return Number(row?.n ?? 0);
}

async function appliedMigrations(db: DB): Promise<string[]> {
  const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return rows.map((r) => r.name);
}

async function insertRow(q: Queryable, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  const overriding = IDENTITY_COLUMNS[table] ? ' OVERRIDING SYSTEM VALUE' : '';
  await q.run(
    `INSERT INTO ${quote(table)} (${cols.map(quote).join(', ')})${overriding}
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    cols.map((c) => row[c]),
  );
}

/** Row counts per table in `db`, for the dry run and the final check. */
export async function tableCounts(db: Queryable): Promise<CopyCounts> {
  const counts: CopyCounts = {};
  for (const t of COPY_TABLES) counts[t] = await count(db, t);
  return counts;
}

/**
 * Copies all site content from `source` into `target`, in one transaction on the target:
 * either everything is copied or nothing is.
 *
 * Refuses when the two databases are on different migrations (a different schema), or when the
 * target already has content, so it can never overwrite a database that is in use.
 */
export async function copyDatabase(source: DB, target: DB): Promise<CopyCounts> {
  await migrate(target);
  const [from, to] = [await appliedMigrations(source), await appliedMigrations(target)];
  if (from.join() !== to.join()) {
    throw new Error(
      `Schemas differ. Source migrations: ${from.join(', ') || 'none'}; ` +
        `target migrations: ${to.join(', ') || 'none'}. Deploy the same code version to both first.`,
    );
  }
  const notEmpty = [];
  for (const t of COPY_TABLES) if ((await count(target, t)) > 0) notEmpty.push(t);
  if (notEmpty.length) {
    throw new Error(`Target is not empty (${notEmpty.join(', ')}). Refusing to overwrite it.`);
  }

  await target.tx(async (q) => {
    for (const table of COPY_TABLES) {
      if (ONE_ROW_AT_A_TIME.has(table)) {
        const ids = await source.query<{ id: string }>(
          `SELECT id FROM ${quote(table)} ORDER BY id`,
        );
        for (const { id } of ids) {
          const row = await one<Record<string, unknown>>(
            source,
            `SELECT * FROM ${quote(table)} WHERE id = $1`,
            [id],
          );
          if (row) await insertRow(q, table, row);
        }
      } else {
        for (const row of await source.query<Record<string, unknown>>(
          `SELECT * FROM ${quote(table)}`,
        )) {
          await insertRow(q, table, row);
        }
      }
      const idCol = IDENTITY_COLUMNS[table];
      if (idCol) {
        // Next id after the copied ones; is_called=false makes an empty table start at 1.
        await q.query(
          `SELECT setval(pg_get_serial_sequence($1, $2),
                  COALESCE((SELECT max(${quote(idCol)}) FROM ${quote(table)}), 0) + 1, false)`,
          [table, idCol],
        );
      }
    }
  });

  const [copied, expected] = [await tableCounts(target), await tableCounts(source)];
  for (const t of COPY_TABLES) {
    if (copied[t] !== expected[t]) {
      throw new Error(`Row count mismatch in ${t}: source ${expected[t]}, target ${copied[t]}.`);
    }
  }
  return copied;
}
