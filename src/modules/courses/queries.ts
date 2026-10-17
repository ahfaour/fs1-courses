import { nowIso, one, type DB, type Queryable } from '../../db/connection.js';
import { deleteFileIfUnreferenced } from '../files/queries.js';

export interface Course {
  id: string;
  name: string;
  code: string;
  level: string;
  semester: string;
  kind: 'course' | 'program';
  description: string;
  topics: string[];
  color_index: number;
  sort_order: number;
  material_count: number;
  last_material_date: string | null;
}

export type CourseInput = Omit<Course, 'id' | 'material_count' | 'last_material_date'>;

interface CourseRow extends Omit<Course, 'topics'> {
  topics_json: string;
}

function parseTopics(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

const toCourse = ({ topics_json, ...row }: CourseRow): Course => ({
  ...row,
  topics: parseTopics(topics_json),
});

const SELECT = `
  SELECT c.id, c.name, c.code, c.level, c.semester, c.kind, c.description, c.topics_json,
         c.color_index, c.sort_order,
         (SELECT COUNT(*)::int FROM materials m WHERE m.course_id = c.id) AS material_count,
         (SELECT MAX(m.material_date) FROM materials m WHERE m.course_id = c.id) AS last_material_date
  FROM courses c`;

/** Courses first, then programs, each by sort_order then name. */
export async function listCourses(db: Queryable): Promise<Course[]> {
  const rows = await db.query<CourseRow>(
    `${SELECT} ORDER BY CASE c.kind WHEN 'course' THEN 0 ELSE 1 END, c.sort_order, c.name`,
  );
  return rows.map(toCourse);
}

export async function getCourse(db: Queryable, id: string): Promise<Course | undefined> {
  const row = await one<CourseRow>(db, `${SELECT} WHERE c.id = $1`, [id]);
  return row && toCourse(row);
}

export async function courseExists(db: Queryable, id: string): Promise<boolean> {
  return !!(await one(db, 'SELECT 1 FROM courses WHERE id = $1', [id]));
}

export async function nextSortOrder(db: Queryable): Promise<number> {
  const r = await one<{ n: number }>(
    db,
    'SELECT (COALESCE(MAX(sort_order), -1) + 1)::int AS n FROM courses',
  );
  return r?.n ?? 0;
}

export async function countCourses(db: Queryable): Promise<number> {
  return (await one<{ n: number }>(db, 'SELECT COUNT(*)::int AS n FROM courses'))?.n ?? 0;
}

const values = (id: string, { topics, ...c }: CourseInput) => [
  id,
  c.name,
  c.code,
  c.level,
  c.semester,
  c.kind,
  c.description,
  JSON.stringify(topics),
  c.color_index,
  c.sort_order,
  nowIso(),
];

export async function insertCourse(
  db: Queryable,
  id: string,
  c: CourseInput,
  ignoreExisting = false,
): Promise<void> {
  await db.run(
    `INSERT INTO courses
       (id, name, code, level, semester, kind, description, topics_json, color_index, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     ${ignoreExisting ? 'ON CONFLICT (id) DO NOTHING' : ''}`,
    values(id, c),
  );
}

export async function updateCourse(db: Queryable, id: string, c: CourseInput): Promise<void> {
  await db.run(
    `UPDATE courses SET name = $2, code = $3, level = $4, semester = $5,
       kind = $6, description = $7, topics_json = $8,
       color_index = $9, sort_order = $10, updated_at = $11
     WHERE id = $1`,
    values(id, c),
  );
}

/** Deletes the course (materials and announcements cascade). Returns ids of stored files no longer referenced. */
export function deleteCourse(db: DB, id: string): Promise<string[]> {
  return db.tx(async (q) => {
    const fileIds = (
      await q.query<{ file_id: string }>(
        'SELECT DISTINCT file_id FROM materials WHERE course_id = $1 AND file_id IS NOT NULL',
        [id],
      )
    ).map((r) => r.file_id);
    await q.run('DELETE FROM courses WHERE id = $1', [id]);
    const gone: string[] = [];
    for (const fid of fileIds) if (await deleteFileIfUnreferenced(q, fid)) gone.push(fid);
    return gone;
  });
}

/** Most recent change to anything students see, for the footer. */
export async function lastUpdated(db: Queryable): Promise<string | null> {
  const r = await one<{ t: string | null }>(
    db,
    `SELECT MAX(t) AS t FROM (
       SELECT MAX(updated_at) AS t FROM materials
       UNION ALL SELECT MAX(created_at) FROM announcements
       UNION ALL SELECT MAX(updated_at) FROM courses
       UNION ALL SELECT MAX(updated_at) FROM profile) AS changes`,
  );
  return r?.t ?? null;
}
