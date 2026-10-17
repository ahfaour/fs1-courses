import { nowIso, one, type Queryable } from '../../db/connection.js';

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
export function listAnnouncements(db: Queryable): Promise<Announcement[]> {
  return db.query<Announcement>(`${SELECT} ORDER BY a.posted_on DESC, a.created_at DESC`);
}

export function getAnnouncement(db: Queryable, id: string): Promise<Announcement | undefined> {
  return one<Announcement>(db, `${SELECT} WHERE a.id = $1`, [id]);
}

export async function insertAnnouncement(
  db: Queryable,
  id: string,
  a: { course_id: string | null; body: string; posted_on: string },
): Promise<void> {
  await db.run(
    `INSERT INTO announcements (id, course_id, body, posted_on, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, a.course_id, a.body, a.posted_on, nowIso()],
  );
}

export async function deleteAnnouncement(db: Queryable, id: string): Promise<boolean> {
  return (await db.run('DELETE FROM announcements WHERE id = $1', [id])) > 0;
}
