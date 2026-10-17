import { nowIso, stmt, type DB } from '../../db/connection.js';
import { deleteFileIfUnreferenced } from '../files/queries.js';
import type { SectionKey } from './sections.js';

export interface Material {
  id: string;
  course_id: string;
  section: SectionKey;
  title: string;
  note: string;
  material_date: string | null;
  url: string | null;
  file_id: string | null;
  original_name: string | null;
  mime_type: string | null;
  updated_at: string;
}

export interface SearchHit extends Material {
  course_name: string;
  color_index: number;
}

export interface MaterialInput {
  section: SectionKey;
  title: string;
  note: string;
  material_date: string | null;
  url: string | null;
  file_id: string | null;
}

const COLUMNS = `m.id, m.course_id, m.section, m.title, m.note, m.material_date, m.url, m.file_id,
  m.updated_at, f.original_name, f.mime_type`;

const ORDER = 'ORDER BY m.material_date IS NULL, m.material_date DESC, m.created_at DESC';

export function listForCourse(db: DB, courseId: string): Material[] {
  return stmt(
    db,
    `SELECT ${COLUMNS} FROM materials m LEFT JOIN files f ON f.id = m.file_id
     WHERE m.course_id = ? ${ORDER}`,
  ).all(courseId) as Material[];
}

export function getMaterial(db: DB, id: string): Material | undefined {
  return stmt(
    db,
    `SELECT ${COLUMNS} FROM materials m LEFT JOIN files f ON f.id = m.file_id WHERE m.id = ?`,
  ).get(id) as Material | undefined;
}

/** Escapes LIKE wildcards so '%' and '_' in a query match literally. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Case-insensitive (ASCII) match on title, note and course name. */
export function searchMaterials(db: DB, q: string, limit = 200): SearchHit[] {
  return stmt(
    db,
    `SELECT ${COLUMNS}, c.name AS course_name, c.color_index
     FROM materials m
     JOIN courses c ON c.id = m.course_id
     LEFT JOIN files f ON f.id = m.file_id
     WHERE m.title LIKE @like ESCAPE '\\' OR m.note LIKE @like ESCAPE '\\'
        OR c.name LIKE @like ESCAPE '\\'
     ${ORDER}
     LIMIT @limit`,
  ).all({ like: `%${escapeLike(q)}%`, limit }) as SearchHit[];
}

export function insertMaterial(db: DB, id: string, courseId: string, m: MaterialInput): void {
  const now = nowIso();
  stmt(
    db,
    `INSERT INTO materials
       (id, course_id, section, title, note, material_date, url, file_id, created_at, updated_at)
     VALUES (@id, @course_id, @section, @title, @note, @material_date, @url, @file_id, @now, @now)`,
  ).run({ ...m, id, course_id: courseId, now });
}

export function updateMaterial(db: DB, id: string, m: MaterialInput): void {
  stmt(
    db,
    `UPDATE materials SET section = @section, title = @title, note = @note,
       material_date = @material_date, url = @url, file_id = @file_id, updated_at = @now
     WHERE id = @id`,
  ).run({ ...m, id, now: nowIso() });
}

/** Deletes the material. Returns the stored file id to remove from disk, if it is now unreferenced. */
export function deleteMaterial(db: DB, id: string): string | null {
  return db.transaction(() => {
    const row = stmt(db, 'SELECT file_id FROM materials WHERE id = ?').get(id) as
      { file_id: string | null } | undefined;
    stmt(db, 'DELETE FROM materials WHERE id = ?').run(id);
    return row?.file_id && deleteFileIfUnreferenced(db, row.file_id) ? row.file_id : null;
  })();
}
