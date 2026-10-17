import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { FILE_ID_RE } from '../../lib/ids.js';

/**
 * Where uploaded bytes live. Only disk for now; an S3 version would implement the same interface.
 * Every method takes a validated random id, never a user-supplied path.
 */
export interface FileStorage {
  /** Directory multer writes incoming uploads to before they are validated. */
  readonly tempDir: string;
  /** Moves a validated temp upload into place under `id`. */
  put(tempPath: string, id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** null when the file is missing. */
  open(id: string): Promise<{ stream: Readable; size: number } | null>;
  list(): Promise<{ id: string; mtimeMs: number }[]>;
}

function checkId(id: string): string {
  if (!FILE_ID_RE.test(id)) throw new Error('Invalid file id');
  return id;
}

export function diskStorage(dir: string): FileStorage {
  const tempDir = path.join(dir, '.tmp');
  fs.mkdirSync(tempDir, { recursive: true });
  const pathFor = (id: string) => path.join(dir, checkId(id));

  return {
    tempDir,

    async put(tempPath, id) {
      const target = pathFor(id);
      try {
        await fsp.rename(tempPath, target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        await fsp.copyFile(tempPath, target);
        await fsp.rm(tempPath, { force: true });
      }
    },

    async remove(id) {
      await fsp.rm(pathFor(id), { force: true });
    },

    async open(id) {
      const p = pathFor(id);
      try {
        const st = await fsp.stat(p);
        if (!st.isFile()) return null;
        return { stream: fs.createReadStream(p), size: st.size };
      } catch {
        return null;
      }
    },

    async list() {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      const out: { id: string; mtimeMs: number }[] = [];
      for (const e of entries) {
        if (!e.isFile() || !FILE_ID_RE.test(e.name)) continue;
        const st = await fsp.stat(path.join(dir, e.name));
        out.push({ id: e.name, mtimeMs: st.mtimeMs });
      }
      return out;
    },
  };
}

/** Removes a file after the DB transaction committed. Failures are logged and leave an orphan. */
export async function removeQuietly(storage: FileStorage, id: string | null | undefined) {
  if (!id) return;
  try {
    await storage.remove(id);
  } catch (err) {
    console.warn(`Could not delete stored file ${id}; cleanup-orphans will remove it.`, err);
  }
}
