import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MIGRATIONS_DIR, loadConfig, loadDotEnv } from '../config.js';
import { nowIso, openDb, type DB } from './connection.js';

/** Applies numbered .sql files from src/db/migrations that have not run yet. Returns the names applied. */
export function migrate(db: DB, dir = MIGRATIONS_DIR): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const done = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  const applied: string[] = [];
  for (const name of files) {
    if (done.has(name)) continue;
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        name,
        nowIso(),
      );
    })();
    applied.push(name);
  }
  return applied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadDotEnv();
  const config = loadConfig();
  const db = openDb(config.databasePath);
  const applied = migrate(db);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
  db.close();
}
