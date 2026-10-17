import { nowIso, one, type DB, type Queryable } from '../../db/connection.js';
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

const ORDER = 'ORDER BY m.material_date DESC NULLS LAST, m.created_at DESC';

export function listForCourse(db: Queryable, courseId: string): Promise<Material[]> {
  return db.query<Material>(
    `SELECT ${COLUMNS} FROM materials m LEFT JOIN files f ON f.id = m.file_id
     WHERE m.course_id = $1 ${ORDER}`,
    [courseId],
  );
}

export function getMaterial(db: Queryable, id: string): Promise<Material | undefined> {
  return one<Material>(
    db,
    `SELECT ${COLUMNS} FROM materials m LEFT JOIN files f ON f.id = m.file_id WHERE m.id = $1`,
    [id],
  );
}

/** Escapes LIKE wildcards so '%' and '_' in a query match literally. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Case-insensitive match on title, note and course name. */
export function searchMaterials(db: Queryable, q: string, limit = 200): Promise<SearchHit[]> {
  return db.query<SearchHit>(
    `SELECT ${COLUMNS}, c.name AS course_name, c.color_index
     FROM materials m
     JOIN courses c ON c.id = m.course_id
     LEFT JOIN files f ON f.id = m.file_id
     WHERE m.title ILIKE $1 ESCAPE '\\' OR m.note ILIKE $1 ESCAPE '\\'
        OR c.name ILIKE $1 ESCAPE '\\'
     ${ORDER}
     LIMIT $2`,
    [`%${escapeLike(q)}%`, limit],
  );
}

export async function insertMaterial(
  db: Queryable,
  id: string,
  courseId: string,
  m: MaterialInput,
): Promise<void> {
  await db.run(
    `INSERT INTO materials
       (id, course_id, section, title, note, material_date, url, file_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
    [id, courseId, m.section, m.title, m.note, m.material_date, m.url, m.file_id, nowIso()],
  );
}

export async function updateMaterial(db: Queryable, id: string, m: MaterialInput): Promise<void> {
  await db.run(
    `UPDATE materials SET section = $2, title = $3, note = $4,
       material_date = $5, url = $6, file_id = $7, updated_at = $8
     WHERE id = $1`,
    [id, m.section, m.title, m.note, m.material_date, m.url, m.file_id, nowIso()],
  );
}

/** Deletes the material. Returns the stored file id to remove from storage, if it is now unreferenced. */
export function deleteMaterial(db: DB, id: string): Promise<string | null> {
  return db.tx(async (q) => {
    const row = await one<{ file_id: string | null }>(
      q,
      'SELECT file_id FROM materials WHERE id = $1',
      [id],
    );
    await q.run('DELETE FROM materials WHERE id = $1', [id]);
    return row?.file_id && (await deleteFileIfUnreferenced(q, row.file_id)) ? row.file_id : null;
  });
}
