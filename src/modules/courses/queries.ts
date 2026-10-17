import { nowIso, stmt, type DB } from '../../db/connection.js';
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
         (SELECT COUNT(*) FROM materials m WHERE m.course_id = c.id) AS material_count,
         (SELECT MAX(m.material_date) FROM materials m WHERE m.course_id = c.id) AS last_material_date
  FROM courses c`;

/** Courses first, then programs, each by sort_order then name. */
export function listCourses(db: DB): Course[] {
  const rows = stmt(
    db,
    `${SELECT} ORDER BY CASE c.kind WHEN 'course' THEN 0 ELSE 1 END, c.sort_order, c.name`,
  ).all() as CourseRow[];
  return rows.map(toCourse);
}

export function getCourse(db: DB, id: string): Course | undefined {
  const row = stmt(db, `${SELECT} WHERE c.id = ?`).get(id) as CourseRow | undefined;
  return row && toCourse(row);
}

export function courseExists(db: DB, id: string): boolean {
  return !!stmt(db, 'SELECT 1 FROM courses WHERE id = ?').get(id);
}

export function nextSortOrder(db: DB): number {
  const r = stmt(db, 'SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM courses').get() as {
    n: number;
  };
  return r.n;
}

export function countCourses(db: DB): number {
  return (stmt(db, 'SELECT COUNT(*) AS n FROM courses').get() as { n: number }).n;
}

const params = (id: string, { topics, ...c }: CourseInput) => ({
  ...c,
  id,
  topics_json: JSON.stringify(topics),
});

export function insertCourse(db: DB, id: string, c: CourseInput, ignoreExisting = false): void {
  const now = nowIso();
  stmt(
    db,
    `INSERT ${ignoreExisting ? 'OR IGNORE' : ''} INTO courses
       (id, name, code, level, semester, kind, description, topics_json, color_index, sort_order, created_at, updated_at)
     VALUES (@id, @name, @code, @level, @semester, @kind, @description, @topics_json, @color_index, @sort_order, @now, @now)`,
  ).run({ ...params(id, c), now });
}

export function updateCourse(db: DB, id: string, c: CourseInput): void {
  stmt(
    db,
    `UPDATE courses SET name = @name, code = @code, level = @level, semester = @semester,
       kind = @kind, description = @description, topics_json = @topics_json,
       color_index = @color_index, sort_order = @sort_order, updated_at = @now
     WHERE id = @id`,
  ).run({ ...params(id, c), now: nowIso() });
}

/** Deletes the course (materials and announcements cascade). Returns ids of stored files no longer referenced. */
export function deleteCourse(db: DB, id: string): string[] {
  return db.transaction(() => {
    const fileIds = (
      stmt(
        db,
        'SELECT DISTINCT file_id FROM materials WHERE course_id = ? AND file_id IS NOT NULL',
      ).all(id) as { file_id: string }[]
    ).map((r) => r.file_id);
    stmt(db, 'DELETE FROM courses WHERE id = ?').run(id);
    return fileIds.filter((fid) => deleteFileIfUnreferenced(db, fid));
  })();
}

/** Most recent change to anything students see, for the footer. */
export function lastUpdated(db: DB): string | null {
  const r = stmt(
    db,
    `SELECT MAX(t) AS t FROM (
       SELECT MAX(updated_at) AS t FROM materials
       UNION ALL SELECT MAX(created_at) FROM announcements
       UNION ALL SELECT MAX(updated_at) FROM courses
       UNION ALL SELECT MAX(updated_at) FROM profile)`,
  ).get() as { t: string | null };
  return r.t;
}
