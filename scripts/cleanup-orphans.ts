/**
 * Removes, when older than 24 h:
 *   - files on disk that have no `files` row (e.g. a disk delete that ran before a failed commit),
 *   - `files` rows that no material references, and their bytes,
 *   - leftover temp uploads.
 *   npm run cleanup-orphans [-- --dry-run]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, loadDotEnv } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import {
  allFileIds,
  deleteFileIfUnreferenced,
  unreferencedFilesBefore,
} from '../src/modules/files/queries.js';
import { diskStorage } from '../src/modules/files/storage.js';

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
const dry = values['dry-run'];
const DAY = 24 * 60 * 60 * 1000;
const cutoff = Date.now() - DAY;

loadDotEnv();
const config = loadConfig();
const db = openDb(config.databasePath);
migrate(db);
const storage = diskStorage(config.uploadDir);
const act = dry ? 'Would remove' : 'Removed';
let count = 0;

// 1. files rows nobody references
for (const id of unreferencedFilesBefore(db, new Date(cutoff).toISOString())) {
  if (!dry && !deleteFileIfUnreferenced(db, id)) continue;
  if (!dry) await storage.remove(id);
  console.log(`${act} unreferenced file ${id}`);
  count++;
}

// 2. bytes on disk with no files row
const known = allFileIds(db);
for (const f of await storage.list()) {
  if (known.has(f.id) || f.mtimeMs > cutoff) continue;
  if (!dry) await storage.remove(f.id);
  console.log(`${act} orphan on disk ${f.id}`);
  count++;
}

// 3. abandoned temp uploads
for (const name of await fs.readdir(storage.tempDir)) {
  const p = path.join(storage.tempDir, name);
  const st = await fs.stat(p);
  if (st.mtimeMs > cutoff) continue;
  if (!dry) await fs.rm(p, { force: true, recursive: true });
  console.log(`${act} temp upload ${name}`);
  count++;
}

console.log(count ? `${count} item(s) ${dry ? 'to clean' : 'cleaned'}.` : 'Nothing to clean.');
db.close();
