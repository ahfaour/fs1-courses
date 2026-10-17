import { nowIso, stmt, type DB } from '../../db/connection.js';

export interface FileRow {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

export function insertFile(db: DB, f: Omit<FileRow, 'created_at'>): void {
  stmt(
    db,
    `INSERT INTO files (id, original_name, mime_type, size_bytes, sha256, created_at)
     VALUES (@id, @original_name, @mime_type, @size_bytes, @sha256, @created_at)`,
  ).run({ ...f, created_at: nowIso() });
}

export function getFile(db: DB, id: string): FileRow | undefined {
  return stmt(db, 'SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
}

/** Deletes the files row when no material points at it. Returns true if it was deleted. */
export function deleteFileIfUnreferenced(db: DB, fileId: string): boolean {
  return (
    stmt(
      db,
      'DELETE FROM files WHERE id = ? AND NOT EXISTS (SELECT 1 FROM materials WHERE file_id = ?)',
    ).run(fileId, fileId).changes > 0
  );
}

export function allFileIds(db: DB): Set<string> {
  return new Set((stmt(db, 'SELECT id FROM files').all() as { id: string }[]).map((r) => r.id));
}

/** files rows no material references, created before `beforeIso`. */
export function unreferencedFilesBefore(db: DB, beforeIso: string): string[] {
  return (
    stmt(
      db,
      `SELECT f.id FROM files f
       WHERE f.created_at < ? AND NOT EXISTS (SELECT 1 FROM materials m WHERE m.file_id = f.id)`,
    ).all(beforeIso) as { id: string }[]
  ).map((r) => r.id);
}
