import { nowIso, stmt, type DB } from '../../db/connection.js';

export interface Announcement {
  id: string;
  course_id: string | null;
  body: string;
  posted_on: string;
  course_name: string | null;
  color_index: number | null;
}

const SELECT = `SELECT a.id, a.course_id, a.body, a.posted_on, c.name AS course_name, c.color_index
  FROM announcements a LEFT JOIN courses c ON c.id = a.course_id`;

/** Newest first. */
export function listAnnouncements(db: DB): Announcement[] {
  return stmt(db, `${SELECT} ORDER BY a.posted_on DESC, a.created_at DESC`).all() as Announcement[];
}

export function getAnnouncement(db: DB, id: string): Announcement | undefined {
  return stmt(db, `${SELECT} WHERE a.id = ?`).get(id) as Announcement | undefined;
}

export function insertAnnouncement(
  db: DB,
  id: string,
  a: { course_id: string | null; body: string; posted_on: string },
): void {
  stmt(
    db,
    `INSERT INTO announcements (id, course_id, body, posted_on, created_at)
     VALUES (@id, @course_id, @body, @posted_on, @created_at)`,
  ).run({ ...a, id, created_at: nowIso() });
}

export function deleteAnnouncement(db: DB, id: string): boolean {
  return stmt(db, 'DELETE FROM announcements WHERE id = ?').run(id).changes > 0;
}
