/**
 * Dated backup of everything the site needs: each table as JSON, plus a copy of every uploaded file.
 * Works against the live database and bucket when DATABASE_URL / S3_* are set (e.g. in .env).
 * Keeps the newest 14 backups.
 *   npm run backup [-- --out ./backups]
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { ROOT, loadConfig, loadDotEnv } from '../src/config.js';
import { openDb } from '../src/db/connection.js';
import { pickStorage } from '../src/modules/files/pickStorage.js';

const TABLES = ['profile', 'courses', 'files', 'materials', 'announcements', 'admins'];
const KEEP = 14;

const { values } = parseArgs({ options: { out: { type: 'string', default: 'backups' } } });
const outRoot = path.resolve(ROOT, values.out);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(outRoot, `fs1-${stamp}`);

loadDotEnv();
const config = loadConfig();
const db = await openDb(config);
const { storage } = pickStorage(config, db);

await fsp.mkdir(path.join(dir, 'files'), { recursive: true });
const dump: Record<string, unknown[]> = {};
for (const t of TABLES) dump[t] = await db.query(`SELECT * FROM ${t}`);
await fsp.writeFile(path.join(dir, 'db.json'), JSON.stringify(dump, null, 2));

let copied = 0;
for (const { id } of dump.files as { id: string }[]) {
  const opened = await storage.open(id);
  if (!opened) {
    console.warn(`Missing from storage: ${id}`);
    continue;
  }
  await pipeline(opened.stream, fs.createWriteStream(path.join(dir, 'files', id)));
  copied++;
}
await db.close();

const old = (await fsp.readdir(outRoot))
  .filter((n) => n.startsWith('fs1-'))
  .sort()
  .reverse();
for (const name of old.slice(KEEP)) await fsp.rm(path.join(outRoot, name), { recursive: true });

console.log(`Backup written to ${dir} (${copied} file(s)).`);
