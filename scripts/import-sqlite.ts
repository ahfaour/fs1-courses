/**
 * One-time move of the content from the first version's SQLite database (data/site.db) and its
 * uploads folder into the current database: profile, courses, materials, announcements and files.
 * Admin accounts and sessions are not copied (create the admin with create-admin).
 *
 * The target's content is REPLACED. Without --yes it only shows what it would do.
 *   npm run import-sqlite                 # dry run
 *   npm run import-sqlite -- --yes        # do it
 * Options: --from data/site.db  --uploads data/uploads
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { ROOT, loadConfig, loadDotEnv } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { randomId } from '../src/lib/ids.js';
import { pickStorage } from '../src/modules/files/pickStorage.js';
import { removeQuietly } from '../src/modules/files/storage.js';

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: 'data/site.db' },
    uploads: { type: 'string', default: 'data/uploads' },
    yes: { type: 'boolean', default: false },
  },
});
const source = path.resolve(ROOT, values.from);
const uploadsDir = path.resolve(ROOT, values.uploads);
if (!fs.existsSync(source)) {
  console.error(`No SQLite database at ${source}.`);
  process.exit(1);
}

// Columns copied for each table, in insert order (parents before children).
const TABLES = {
  profile: ['id', 'name', 'title', 'affiliation', 'intro', 'email', 'office_hours', 'updated_at'],
  courses: [
    'id',
    'name',
    'code',
    'level',
    'semester',
    'kind',
    'description',
    'topics_json',
    'color_index',
    'sort_order',
    'created_at',
    'updated_at',
  ],
  files: ['id', 'original_name', 'mime_type', 'size_bytes', 'sha256', 'created_at'],
  materials: [
    'id',
    'course_id',
    'section',
    'title',
    'note',
    'material_date',
    'url',
    'file_id',
    'created_at',
    'updated_at',
  ],
  announcements: ['id', 'course_id', 'body', 'posted_on', 'created_at'],
} as const;
type Table = keyof typeof TABLES;
type Row = Record<string, unknown>;

const sqlite = new DatabaseSync(source, { readOnly: true });
const rows = {} as Record<Table, Row[]>;
for (const [t, cols] of Object.entries(TABLES) as [Table, readonly string[]][]) {
  rows[t] = sqlite.prepare(`SELECT ${cols.join(', ')} FROM ${t}`).all() as Row[];
}
sqlite.close();

// A material whose file is missing from the uploads folder cannot be imported as a file.
const fileIds = rows.files.map((f) => String(f.id));
const missing = fileIds.filter((id) => !fs.existsSync(path.join(uploadsDir, id)));

loadDotEnv();
const config = loadConfig();
const db = await openDb(config);
await migrate(db);
const { storage, where } = pickStorage(config, db);
const target = config.databaseUrl ? 'Postgres (DATABASE_URL)' : `PGlite at ${config.pgliteDir}`;

console.log(`From: ${source}`);
console.log(`To:   ${target}; files to ${where}`);
for (const t of Object.keys(TABLES) as Table[]) {
  const [count] = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${t}`);
  const n = count?.n ?? 0;
  console.log(`  ${t.padEnd(14)} ${String(rows[t].length).padStart(4)} to import, replacing ${n}`);
}
if (missing.length) {
  console.error(`These files are listed in the database but missing from ${uploadsDir}:`);
  for (const id of missing) console.error(`  ${id}`);
  console.error('Nothing was changed.');
  process.exit(1);
}
if (!values.yes) {
  console.log('\nDry run: nothing was changed. Run again with --yes to import.');
  await db.close();
  process.exit(0);
}

const oldFileIds = (await db.query<{ id: string }>('SELECT id FROM files')).map((r) => r.id);

// 1. File bytes first: if this fails, the site's rows are untouched.
for (const id of fileIds) {
  if (oldFileIds.includes(id)) continue; // same file already there from an earlier import
  const temp = path.join(storage.tempDir, randomId());
  await fsp.copyFile(path.join(uploadsDir, id), temp);
  await removeQuietly(storage, id);
  await storage.put(temp, id);
}

// 2. Rows, all or nothing.
await db.tx(async (q) => {
  await q.run('DELETE FROM materials');
  await q.run('DELETE FROM announcements');
  await q.run('DELETE FROM courses');
  await q.run('DELETE FROM files');
  await q.run('DELETE FROM profile');
  for (const [t, cols] of Object.entries(TABLES) as [Table, readonly string[]][]) {
    const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`;
    for (const r of rows[t])
      await q.run(
        sql,
        cols.map((c) => r[c] ?? null),
      );
  }
});

// 3. Bytes of the target's previous files that are no longer used.
for (const id of oldFileIds) if (!fileIds.includes(id)) await removeQuietly(storage, id);

await db.close();
console.log('\nImport done. Sign in and check the site.');
