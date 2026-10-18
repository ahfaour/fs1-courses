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

/** Search results across courses: newest first. */
const BY_DATE = 'ORDER BY m.material_date DESC NULLS LAST, m.created_at DESC';
/** Within a course: the order the instructor set with the ↑ / ↓ buttons. */
const BY_POSITION = 'ORDER BY m.position, m.created_at';

/** Next free position at the end of a section. */
const END_OF = (course: string, section: string) =>
  `(SELECT COALESCE(MAX(x.position), -1) + 1 FROM materials x WHERE x.course_id = ${course} AND x.section = ${section})`;

export function listForCourse(db: Queryable, courseId: string): Promise<Material[]> {
  return db.query<Material>(
    `SELECT ${COLUMNS} FROM materials m LEFT JOIN files f ON f.id = m.file_id
     WHERE m.course_id = $1 ${BY_POSITION}`,
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
     ${BY_DATE}
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
       (id, course_id, section, title, note, material_date, url, file_id, created_at, updated_at, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, ${END_OF('$2', '$3')})`,
    [id, courseId, m.section, m.title, m.note, m.material_date, m.url, m.file_id, nowIso()],
  );
}

export async function updateMaterial(db: Queryable, id: string, m: MaterialInput): Promise<void> {
  await db.run(
    `UPDATE materials u SET section = $2, title = $3, note = $4,
       material_date = $5, url = $6, file_id = $7, updated_at = $8,
       -- moved to another section: goes to the end of it
       position = CASE WHEN u.section = $2 THEN u.position ELSE ${END_OF('u.course_id', '$2')} END
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

/**
 * Moves a material one place up or down within its section and renumbers the section 0, 1, 2…
 * Returns the material's course and section, or undefined if it does not exist.
 */
export function moveMaterial(
  db: DB,
  id: string,
  direction: 'up' | 'down',
): Promise<{ course_id: string; section: string } | undefined> {
  return db.tx(async (q) => {
    const m = await one<{ course_id: string; section: string }>(
      q,
      'SELECT course_id, section FROM materials WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!m) return undefined;
    const ids = (
      await q.query<{ id: string }>(
        `SELECT m.id FROM materials m WHERE m.course_id = $1 AND m.section = $2 ${BY_POSITION}`,
        [m.course_id, m.section],
      )
    ).map((r) => r.id);
    const i = ids.indexOf(id);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    for (const [n, mid] of ids.entries()) {
      await q.run('UPDATE materials SET position = $1 WHERE id = $2', [n, mid]);
    }
    return m;
  });
}
