import { nowIso, one, type Queryable } from '../../db/connection.js';

export interface FileRow {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

export async function insertFile(db: Queryable, f: Omit<FileRow, 'created_at'>): Promise<void> {
  await db.run(
    `INSERT INTO files (id, original_name, mime_type, size_bytes, sha256, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [f.id, f.original_name, f.mime_type, f.size_bytes, f.sha256, nowIso()],
  );
}

export function getFile(db: Queryable, id: string): Promise<FileRow | undefined> {
  return one<FileRow>(db, 'SELECT * FROM files WHERE id = $1', [id]);
}

/** Deletes the files row when no material points at it. Returns true if it was deleted. */
export async function deleteFileIfUnreferenced(db: Queryable, fileId: string): Promise<boolean> {
  return (
    (await db.run(
      'DELETE FROM files WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM materials WHERE file_id = $1)',
      [fileId],
    )) > 0
  );
}

export async function allFileIds(db: Queryable): Promise<Set<string>> {
  return new Set((await db.query<{ id: string }>('SELECT id FROM files')).map((r) => r.id));
}

/** files rows no material references, created before `beforeIso`. */
export async function unreferencedFilesBefore(db: Queryable, beforeIso: string): Promise<string[]> {
  return (
    await db.query<{ id: string }>(
      `SELECT f.id FROM files f
       WHERE f.created_at < $1 AND NOT EXISTS (SELECT 1 FROM materials m WHERE m.file_id = f.id)`,
      [beforeIso],
    )
  ).map((r) => r.id);
}
