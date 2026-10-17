import { nowIso, one, type Queryable } from '../../db/connection.js';

export interface Profile {
  name: string;
  title: string;
  affiliation: string;
  intro: string;
  email: string;
  office_hours: string;
  updated_at: string;
}

const EMPTY: Profile = {
  name: '',
  title: '',
  affiliation: '',
  intro: '',
  email: '',
  office_hours: '',
  updated_at: '',
};

export async function getProfile(db: Queryable): Promise<Profile> {
  const row = await one<Profile>(
    db,
    'SELECT name, title, affiliation, intro, email, office_hours, updated_at FROM profile WHERE id = 1',
  );
  return row ?? EMPTY;
}

export async function hasProfile(db: Queryable): Promise<boolean> {
  return !!(await one(db, 'SELECT 1 FROM profile WHERE id = 1'));
}

export async function saveProfile(db: Queryable, p: Omit<Profile, 'updated_at'>): Promise<void> {
  await db.run(
    `INSERT INTO profile (id, name, title, affiliation, intro, email, office_hours, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, title = excluded.title,
       affiliation = excluded.affiliation, intro = excluded.intro, email = excluded.email,
       office_hours = excluded.office_hours, updated_at = excluded.updated_at`,
    [p.name, p.title, p.affiliation, p.intro, p.email, p.office_hours, nowIso()],
  );
}
