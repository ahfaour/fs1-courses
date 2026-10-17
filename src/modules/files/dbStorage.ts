import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { nowIso, one, type DB } from '../../db/connection.js';
import { FILE_ID_RE } from '../../lib/ids.js';
import type { FileStorage } from './storage.js';

/**
 * Uploads kept in the database itself (table `file_blobs`), so a host with no persistent disk
 * needs nothing but Postgres. Each file is read into memory whole, so keep MAX_UPLOAD_MB modest.
 */
export function dbStorage(db: DB): FileStorage {
  const tempDir = path.join(os.tmpdir(), 'fs1-uploads');
  fs.mkdirSync(tempDir, { recursive: true });

  const checkId = (id: string) => {
    if (!FILE_ID_RE.test(id)) throw new Error('Invalid file id');
    return id;
  };

  return {
    tempDir,

    async put(tempPath, id) {
      const data = await fsp.readFile(tempPath);
      await db.run('INSERT INTO file_blobs (id, data, created_at) VALUES ($1, $2, $3)', [
        checkId(id),
        data,
        nowIso(),
      ]);
      await fsp.rm(tempPath, { force: true });
    },

    async remove(id) {
      await db.run('DELETE FROM file_blobs WHERE id = $1', [checkId(id)]);
    },

    async open(id) {
      const row = await one<{ data: Uint8Array }>(db, 'SELECT data FROM file_blobs WHERE id = $1', [
        checkId(id),
      ]);
      if (!row) return null;
      const buf = Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength);
      return { stream: Readable.from([buf]), size: buf.length };
    },

    async list() {
      const rows = await db.query<{ id: string; created_at: string }>(
        'SELECT id, created_at FROM file_blobs',
      );
      return rows.map((r) => ({ id: r.id, mtimeMs: Date.parse(r.created_at) }));
    },
  };
}
